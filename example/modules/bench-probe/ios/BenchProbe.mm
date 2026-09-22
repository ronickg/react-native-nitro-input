#import "BenchProbe.h"

#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>
#import <mach/mach.h>
#import <mach/thread_info.h>
#import <pthread.h>
#import <sys/utsname.h>

#import <algorithm>
#import <atomic>
#import <cmath>
#import <mutex>
#import <vector>

static NSString *BenchJSON(id object) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:object options:0 error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
}

static double BenchPercentile(const std::vector<double> &sorted, double p) {
  if (sorted.empty()) return 0;
  size_t i = std::min(sorted.size() - 1, (size_t)std::floor(p * sorted.size()));
  return sorted[i];
}

/**
 * The frame meter is a CADisplayLink on the main run loop: it fires once per
 * display refresh as long as the main thread gets to service it, so a gap of
 * several refresh intervals is a frame the main thread missed. The link's
 * targetTimestamp gives the interval the display was actually running at, so
 * a 120 Hz ProMotion panel and a 60 Hz one count dropped frames the same way.
 * This sees in-process stalls only; see BENCHMARKS.md for the render-server
 * cross-check with Instruments.
 */
@implementation BenchProbe {
  CADisplayLink *_link;
  std::mutex _mutex;
  std::vector<double> _gaps;      // ms between consecutive frames
  std::vector<double> _expected;  // the interval the display link expected for that gap
  CFTimeInterval _lastTimestamp;
  CFTimeInterval _lastExpected;
  std::atomic<bool> _running;
  uint64_t _mainThreadId;
  NSInteger _maxFps;
}

RCT_EXPORT_MODULE()

+ (BOOL)requiresMainQueueSetup {
  return NO;
}

- (instancetype)init {
  if (self = [super init]) {
    _running = false;
    _mainThreadId = 0;
    _maxFps = 0;
    dispatch_async(dispatch_get_main_queue(), ^{
      uint64_t tid = 0;
      pthread_threadid_np(NULL, &tid);
      self->_mainThreadId = tid;
      self->_maxFps = UIScreen.mainScreen.maximumFramesPerSecond;
    });
  }
  return self;
}

- (NSString *)getDeviceInfo {
  struct utsname u;
  uname(&u);
  NSProcessInfo *info = NSProcessInfo.processInfo;
#ifdef DEBUG
  BOOL debug = YES;
#else
  BOOL debug = NO;
#endif
  return BenchJSON(@{
    @"platform" : @"ios",
    @"model" : [NSString stringWithUTF8String:u.machine] ?: @"",
    @"name" : UIDevice.currentDevice.name ?: @"",
    @"os" : UIDevice.currentDevice.systemVersion ?: @"",
    @"refreshRate" : @(_maxFps ?: UIScreen.mainScreen.maximumFramesPerSecond),
    @"cpuCores" : @(info.activeProcessorCount),
    @"lowPowerMode" : @(info.isLowPowerModeEnabled),
    @"thermal" : [self thermalState],
    @"debug" : @(debug),
  });
}

- (NSString *)getLaunchPlan {
  NSString *encoded = NSProcessInfo.processInfo.environment[@"BENCH_PLAN"];
  if (encoded.length == 0) return @"";
  NSData *data = [[NSData alloc] initWithBase64EncodedString:encoded
                                                     options:NSDataBase64DecodingIgnoreUnknownCharacters];
  NSString *plan = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
  if (plan.length > 0) [self keepAwake];
  return plan ?: @"";
}

- (NSString *)thermalState {
  switch (NSProcessInfo.processInfo.thermalState) {
    case NSProcessInfoThermalStateNominal: return @"nominal";
    case NSProcessInfoThermalStateFair: return @"fair";
    case NSProcessInfoThermalStateSerious: return @"serious";
    case NSProcessInfoThermalStateCritical: return @"critical";
  }
  return @"unknown";
}

- (NSString *)sample {
  NSMutableArray *threads = [NSMutableArray new];
  thread_act_array_t list = NULL;
  mach_msg_type_number_t count = 0;
  if (task_threads(mach_task_self(), &list, &count) == KERN_SUCCESS) {
    for (mach_msg_type_number_t i = 0; i < count; i++) {
      thread_extended_info_data_t ext;
      mach_msg_type_number_t extCount = THREAD_EXTENDED_INFO_COUNT;
      thread_identifier_info_data_t ident;
      mach_msg_type_number_t identCount = THREAD_IDENTIFIER_INFO_COUNT;
      if (thread_info(list[i], THREAD_EXTENDED_INFO, (thread_info_t)&ext, &extCount) == KERN_SUCCESS &&
          thread_info(list[i], THREAD_IDENTIFIER_INFO, (thread_info_t)&ident, &identCount) == KERN_SUCCESS) {
        // pth_user_time / pth_system_time are nanoseconds of run time so far.
        double cpuMs = (double)(ext.pth_user_time + ext.pth_system_time) / 1e6;
        NSString *name = [NSString stringWithUTF8String:ext.pth_name] ?: @"";
        BOOL isMain = _mainThreadId != 0 ? ident.thread_id == _mainThreadId : i == 0;
        [threads addObject:@{
          @"id" : @(ident.thread_id),
          @"name" : name,
          @"main" : @(isMain),
          @"cpuMs" : @(cpuMs),
        }];
      }
      mach_port_deallocate(mach_task_self(), list[i]);
    }
    vm_deallocate(mach_task_self(), (vm_address_t)list, count * sizeof(thread_t));
  }
  double rssMb = 0;
  task_vm_info_data_t vm;
  mach_msg_type_number_t vmCount = TASK_VM_INFO_COUNT;
  if (task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&vm, &vmCount) == KERN_SUCCESS) {
    rssMb = (double)vm.phys_footprint / (1024.0 * 1024.0);
  }
  return BenchJSON(@{
    @"wallMs" : @(CACurrentMediaTime() * 1000.0),
    @"rssMb" : @(rssMb),
    @"threads" : threads,
  });
}

/** A plan runs for minutes with nobody touching the screen; auto-lock would end it. */
- (void)keepAwake {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIApplication.sharedApplication.idleTimerDisabled = YES;
  });
}

- (void)startFrames {
  [self keepAwake];
  dispatch_async(dispatch_get_main_queue(), ^{
    [self->_link invalidate];
    {
      std::lock_guard<std::mutex> guard(self->_mutex);
      self->_gaps.clear();
      self->_expected.clear();
    }
    self->_lastTimestamp = 0;
    self->_lastExpected = 0;
    self->_running = true;
    self->_link = [CADisplayLink displayLinkWithTarget:self selector:@selector(onFrame:)];
    // A ProMotion panel runs at 120 Hz only while something asks for it; a
    // display link left at its default follows whatever rate the panel is at,
    // which is 60 when nothing else asks. Ask for the panel's maximum, so
    // "every frame" means the same thing on every device.
    NSInteger maxFps = UIScreen.mainScreen.maximumFramesPerSecond;
    if (@available(iOS 15.0, *)) {
      if (maxFps > 60) self->_link.preferredFrameRateRange = CAFrameRateRangeMake(maxFps, maxFps, maxFps);
    }
    [self->_link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
  });
}

- (void)onFrame:(CADisplayLink *)link {
  if (!_running) return;
  CFTimeInterval timestamp = link.timestamp;
  CFTimeInterval expected = link.targetTimestamp - timestamp;
  if (_lastTimestamp > 0) {
    std::lock_guard<std::mutex> guard(_mutex);
    _gaps.push_back((timestamp - _lastTimestamp) * 1000.0);
    _expected.push_back(_lastExpected * 1000.0);
  }
  _lastTimestamp = timestamp;
  _lastExpected = expected;
}

- (NSString *)stopFrames {
  _running = false;
  std::vector<double> gaps;
  std::vector<double> expected;
  {
    std::lock_guard<std::mutex> guard(_mutex);
    gaps = _gaps;
    expected = _expected;
  }
  CADisplayLink *link = _link;
  _link = nil;
  dispatch_async(dispatch_get_main_queue(), ^{
    [link invalidate];
  });

  double seconds = 0;
  double dropped = 0;
  long longFrames = 0;
  for (size_t i = 0; i < gaps.size(); i++) {
    double e = expected[i] > 0 ? expected[i] : 1000.0 / 60.0;
    seconds += gaps[i] / 1000.0;
    if (gaps[i] > 1.5 * e) dropped += std::round(gaps[i] / e) - 1;
    if (gaps[i] > 2.5 * e) longFrames++;
  }
  std::vector<double> sorted = gaps;
  std::sort(sorted.begin(), sorted.end());
  std::vector<double> sortedExpected = expected;
  std::sort(sortedExpected.begin(), sortedExpected.end());
  double expectedMedian = BenchPercentile(sortedExpected, 0.5);
  return BenchJSON(@{
    @"frames" : @(gaps.empty() ? 0 : gaps.size() + 1),
    @"seconds" : @(seconds),
    @"fps" : @(seconds > 0 ? gaps.size() / seconds : 0),
    @"hz" : @(expectedMedian > 0 ? std::round(1000.0 / expectedMedian) : 0),
    @"dropped" : @(dropped),
    @"long" : @(longFrames),
    @"p50" : @(BenchPercentile(sorted, 0.5)),
    @"p95" : @(BenchPercentile(sorted, 0.95)),
    @"p99" : @(BenchPercentile(sorted, 0.99)),
    @"max" : @(sorted.empty() ? 0 : sorted.back()),
  });
}

- (void)report:(NSString *)line {
  // devicectl `process launch --console` streams stdout to the host.
  fprintf(stdout, "BENCH %s\n", line.UTF8String);
  fflush(stdout);
  NSLog(@"BENCH %@", line);
  NSString *dir = NSSearchPathForDirectoriesInDomains(NSDocumentDirectory, NSUserDomainMask, YES).firstObject;
  NSString *path = [dir stringByAppendingPathComponent:@"bench-results.ndjson"];
  if (![NSFileManager.defaultManager fileExistsAtPath:path]) {
    [NSFileManager.defaultManager createFileAtPath:path contents:nil attributes:nil];
  }
  NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:path];
  [handle seekToEndOfFile];
  [handle writeData:[[line stringByAppendingString:@"\n"] dataUsingEncoding:NSUTF8StringEncoding]];
  [handle closeFile];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeBenchProbeSpecJSI>(params);
}

@end
