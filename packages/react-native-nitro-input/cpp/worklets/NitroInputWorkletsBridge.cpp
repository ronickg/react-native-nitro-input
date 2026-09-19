//
//  NitroInputWorkletsBridge.cpp
//  NitroInput
//

#include "NitroInputWorkletsBridge.hpp"
#include "NitroInputWorkletsBridgeJSI.hpp"

#if MORPH_INPUT_WORKLETS

#include <jsi/jsi.h>
#include <worklets/Compat/Holders.h>
#include <worklets/WorkletRuntime/WorkletRuntime.h>

#include <memory>
#include <mutex>

namespace margelo::nitro::nitroinput::nitroinputworklets {

namespace {

using facebook::jsi::JSError;
using facebook::jsi::JSIException;
using facebook::jsi::Object;
using facebook::jsi::Runtime;
using facebook::jsi::String;
using facebook::jsi::Value;

/// The map JS keeps on the UI runtime: id -> worklet wrapper.
constexpr auto kRegistry = "__nitroInputWorklets";

std::mutex gMutex;
std::shared_ptr<worklets::WorkletRuntime> gRuntime;

std::shared_ptr<worklets::WorkletRuntime> runtime() {
  std::lock_guard<std::mutex> lock(gMutex);
  return gRuntime;
}

/// The registered wrapper for `id`, or undefined.
Value lookup(Runtime& rt, int id) {
  const Value registry = rt.global().getProperty(rt, kRegistry);
  if (!registry.isObject()) return Value::undefined();
  Object map = registry.asObject(rt);
  const Value get = map.getProperty(rt, "get");
  if (!get.isObject() || !get.asObject(rt).isFunction(rt)) return Value::undefined();
  return get.asObject(rt).asFunction(rt).callWithThis(rt, map, Value(id));
}

void logError(Runtime& rt, const std::string& message) {
  try {
    auto console = rt.global().getPropertyAsObject(rt, "console");
    console.getPropertyAsFunction(rt, "error").call(rt, String::createFromUtf8(rt, "[NitroInput] worklet threw: " + message));
  } catch (const JSIException&) {
    // console may not exist on the worklet runtime.
  }
}

} // namespace

bool isAvailable() {
  return true;
}

bool isReady() {
  return runtime() != nullptr;
}

bool installRuntime(Runtime& rt, const Value& holder) {
  if (!holder.isObject()) return false;
  Object object = holder.asObject(rt);
  if (!object.hasNativeState(rt)) return false;
  auto state = std::dynamic_pointer_cast<worklets::WorkletRuntimeHolder>(object.getNativeState(rt));
  if (!state || !state->runtime_) return false;
  std::lock_guard<std::mutex> lock(gMutex);
  gRuntime = state->runtime_;
  return true;
}

TransformResult runTransform(int id, const std::string& text, const std::string& previousText, int selectionStart,
                             int selectionEnd, int previousSelectionStart, int previousSelectionEnd) {
  TransformResult none{false, "", 0, 0};
  auto ui = runtime();
  if (!ui || id <= 0) return none;
  return ui->runSync([&](Runtime& rt) -> TransformResult {
    try {
      const Value fn = lookup(rt, id);
      if (!fn.isObject() || !fn.asObject(rt).isFunction(rt)) return none;
      const Value result = fn.asObject(rt).asFunction(rt).call(
          rt, String::createFromUtf8(rt, text), String::createFromUtf8(rt, previousText), Value(selectionStart),
          Value(selectionEnd), Value(previousSelectionStart), Value(previousSelectionEnd));
      if (!result.isObject()) return none;
      Object object = result.asObject(rt);
      const Value newText = object.getProperty(rt, "text");
      const Value start = object.getProperty(rt, "selectionStart");
      const Value end = object.getProperty(rt, "selectionEnd");
      if (!newText.isString()) return none;
      TransformResult out;
      out.applied = true;
      out.text = newText.asString(rt).utf8(rt);
      out.selectionStart = start.isNumber() ? static_cast<int>(start.asNumber()) : -1;
      out.selectionEnd = end.isNumber() ? static_cast<int>(end.asNumber()) : out.selectionStart;
      return out;
    } catch (const JSError& error) {
      logError(rt, error.getMessage());
    } catch (const JSIException& error) {
      logError(rt, error.what());
    }
    return none;
  });
}

void runChangeText(int id, const std::string& text) {
  auto ui = runtime();
  if (!ui || id <= 0) return;
  ui->runSync([&](Runtime& rt) {
    try {
      const Value fn = lookup(rt, id);
      if (fn.isObject() && fn.asObject(rt).isFunction(rt)) {
        fn.asObject(rt).asFunction(rt).call(rt, String::createFromUtf8(rt, text));
      }
    } catch (const JSError& error) {
      logError(rt, error.getMessage());
    } catch (const JSIException& error) {
      logError(rt, error.what());
    }
  });
}

void runChangeValue(int id, double value) {
  auto ui = runtime();
  if (!ui || id <= 0) return;
  ui->runSync([&](Runtime& rt) {
    try {
      const Value fn = lookup(rt, id);
      if (fn.isObject() && fn.asObject(rt).isFunction(rt)) {
        fn.asObject(rt).asFunction(rt).call(rt, Value(value));
      }
    } catch (const JSError& error) {
      logError(rt, error.getMessage());
    } catch (const JSIException& error) {
      logError(rt, error.what());
    }
  });
}

} // namespace margelo::nitro::nitroinput::nitroinputworklets

#else // MORPH_INPUT_WORKLETS

namespace margelo::nitro::nitroinput::nitroinputworklets {

bool isAvailable() {
  return false;
}

bool isReady() {
  return false;
}

bool installRuntime(facebook::jsi::Runtime&, const facebook::jsi::Value&) {
  return false;
}

TransformResult runTransform(int, const std::string&, const std::string&, int, int, int, int) {
  return TransformResult{false, "", 0, 0};
}

void runChangeText(int, const std::string&) {}

void runChangeValue(int, double) {}

} // namespace margelo::nitro::nitroinput::nitroinputworklets

#endif // MORPH_INPUT_WORKLETS
