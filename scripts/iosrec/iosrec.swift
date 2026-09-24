import AVFoundation
import CoreMediaIO
import Foundation

let logPath = "/tmp/iosrec.log"
func log(_ s: String) {
    let line = (s + "\n").data(using: .utf8)!
    FileHandle.standardError.write(line)
    if let h = FileHandle(forWritingAtPath: logPath) { h.seekToEndOfFile(); h.write(line); try? h.close() }
    else { try? line.write(to: URL(fileURLWithPath: logPath)) }
}

/// CoreMediaIO hides connected-iOS-device screen sources unless the process opts
/// in. This is the same switch QuickTime flips before it lists an iPhone.
func allowScreenCaptureDevices() {
    var address = CMIOObjectPropertyAddress(
        mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
        mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
        mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
    var yes: UInt32 = 1
    CMIOObjectSetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &address, 0, nil,
                              UInt32(MemoryLayout<UInt32>.size), &yes)
}

/// Counts frames from the source, to tell "no stream" from "can't write".
final class FrameCounter: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    var frames = 0
    var size = ""
    func captureOutput(_ o: AVCaptureOutput, didOutput b: CMSampleBuffer, from c: AVCaptureConnection) {
        frames += 1
        if let f = CMSampleBufferGetFormatDescription(b) {
            let d = CMVideoFormatDescriptionGetDimensions(f); size = "\(d.width)x\(d.height)"
        }
    }
}

final class Recorder: NSObject, AVCaptureFileOutputRecordingDelegate {
    let session = AVCaptureSession()
    let output = AVCaptureMovieFileOutput()
    var done = false
    var failure: Error?

    func devices() -> [AVCaptureDevice] {
        let types: [AVCaptureDevice.DeviceType] = [.external]
        return AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .muxed, position: .unspecified).devices
             + AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .unspecified).devices
    }

    func start(match: String, to url: URL) throws {
        // The screen source can take several seconds to be published after
        // allowScreenCaptureDevices(), and a paired iPhone's Continuity Camera
        // ("…'s iPhone Camera") is listed too: it matches "iPhone" first and
        // records black at 1080p. Wait for a matching device that is not a camera.
        var all = devices()
        var dev: AVCaptureDevice?
        let until = Date().addingTimeInterval(10)
        while dev == nil && Date() < until {
            all = devices()
            dev = all.first(where: { $0.localizedName.contains(match) && !$0.localizedName.hasSuffix("Camera") })
            if dev == nil { RunLoop.current.run(until: Date().addingTimeInterval(0.25)) }
        }
        log("devices: \(all.map { $0.localizedName })")
        guard let dev else {
            throw NSError(domain: "iosrec", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "no capture device matching \(match)"])
        }
        log("using: \(dev.localizedName)")
        session.beginConfiguration()
        session.sessionPreset = .high
        let input = try AVCaptureDeviceInput(device: dev)
        guard session.canAddInput(input) else { throw NSError(domain: "iosrec", code: 2) }
        session.addInput(input)
        guard session.canAddOutput(output) else { throw NSError(domain: "iosrec", code: 3) }
        session.addOutput(output)
        session.commitConfiguration()
        // The iPhone screen source is muxed; the audio track is dead weight for a
        // silent UI demo and a stalled audio connection can end the recording.
        // Disabling it made the iPhone 13 Pro Max's recording fail (-11805) at the
        // end; keep it unless IOSREC_AUDIO=off. The encoder drops audio anyway.
        if ProcessInfo.processInfo.environment["IOSREC_AUDIO"] == "off" {
            for c in output.connections where c.inputPorts.contains(where: { $0.mediaType == .audio }) {
                c.isEnabled = false
            }
        }
        if ProcessInfo.processInfo.environment["IOSREC_PROBE"] != nil {
            session.removeOutput(output)
            let data = AVCaptureVideoDataOutput()
            let counter = FrameCounter()
            data.setSampleBufferDelegate(counter, queue: DispatchQueue(label: "frames"))
            session.addOutput(data)
            session.startRunning()
            RunLoop.current.run(until: Date().addingTimeInterval(4))
            log("probe: \(counter.frames) frames in 4 s, \(counter.size), formats \(dev.formats.count), active \(dev.activeFormat)")
            exit(0)
        }
        session.startRunning()
        // The iPhone screen source publishes its format a beat after the session
        // starts; starting the file output before that fails with -11805.
        var waited = 0.0
        while !session.isRunning && waited < 5 {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1)); waited += 0.1
        }
        // Then wait for the video connection itself to go live: on a phone's first
        // capture with this Mac that takes several seconds, and a fixed pause
        // started the file output too early (-11805) every time.
        var live = 0.0
        while live < 15 && !(output.connection(with: .video)?.isActive ?? false) {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1)); live += 0.1
        }
        log("video connection active after \(live) s")
        RunLoop.current.run(until: Date().addingTimeInterval(1.0))
        self.url = url
        output.startRecording(to: url, recordingDelegate: self)
    }

    var url: URL?
    var attempts = 0

    var stopping = false
    func stop() { stopping = true; output.stopRecording() }

    func fileOutput(_ o: AVCaptureFileOutput, didFinishRecordingTo url: URL,
                    from: [AVCaptureConnection], error: Error?) {
        if let error {
            // -11805 at the very start means the stream was not flowing yet: try again.
            let started = (error as NSError).userInfo[AVErrorRecordingSuccessfullyFinishedKey] as? Bool ?? false
            if !started && attempts < 4, let url = self.url, !stopping {
                attempts += 1
                log("retrying start (\(attempts)) after: \(error.localizedDescription)")
                RunLoop.current.run(until: Date().addingTimeInterval(1.5))
                output.startRecording(to: url, recordingDelegate: self)
                return
            }
            failure = error; log("error: \(error)")
        }
        session.stopRunning()
        done = true
    }
}

let args = CommandLine.arguments
guard args.count >= 4 else { log("usage: iosrec <device-substring> <seconds> <out.mov>"); exit(2) }
let match = args[1]
let seconds = Double(args[2]) ?? 10
let url = URL(fileURLWithPath: args[3])
try? FileManager.default.removeItem(at: url)

// Ask for camera access (an iOS screen source counts as one) and block until the
// user answers, so the TCC prompt resolves before we touch the device.
if AVCaptureDevice.authorizationStatus(for: .video) != .authorized {
    let sem = DispatchSemaphore(value: 0)
    AVCaptureDevice.requestAccess(for: .video) { _ in sem.signal() }
    while sem.wait(timeout: .now() + 0.1) == .timedOut {
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
}
log("auth: \(AVCaptureDevice.authorizationStatus(for: .video).rawValue) (3=authorized)")
guard AVCaptureDevice.authorizationStatus(for: .video) == .authorized else {
    log("camera access not granted"); exit(3)
}

// This runs as a background (LSUIElement) app, so App Nap will throttle it and
// the capture stops delivering frames after a few seconds. Hold an activity
// assertion for the whole recording.
let activity = ProcessInfo.processInfo.beginActivity(
    options: [.userInitiatedAllowingIdleSystemSleep, .latencyCritical],
    reason: "recording the connected iPhone screen")

allowScreenCaptureDevices()
// The DAL plugin needs a beat to publish the newly-allowed screen devices.
Thread.sleep(forTimeInterval: 1.5)

let rec = Recorder()
do { try rec.start(match: match, to: url) } catch { log("failed: \(error)"); exit(1) }

let deadline = Date().addingTimeInterval(seconds)
while Date() < deadline { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
rec.stop()
while !rec.done { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
ProcessInfo.processInfo.endActivity(activity)
if rec.failure != nil { exit(4) }
log("wrote \(url.path)")
