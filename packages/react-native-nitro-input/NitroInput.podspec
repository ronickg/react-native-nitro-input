require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroInput"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported, :visionos => 1.0 }
  s.source       = { :git => "https://github.com/ronickg/react-native-nitro-rolling-number.git", :tag => "nitro-input-v#{s.version}" }

  s.source_files = [
    # Implementation (Swift)
    "ios/**/*.{swift}",
    # Autolinking/Registration (Objective-C++)
    "ios/**/*.{m,mm}",
    # Implementation (C++ objects)
    "cpp/**/*.{hpp,cpp}",
  ]

  # The shared C++ engines and formatter are public headers so the pod's Swift
  # sources can call them directly through Swift/C++ interop (enabled by Nitro below).
  s.public_header_files = ["cpp/**/*.hpp"]
  # The engines' unit tests build as a host executable (`bun run test:cpp`).
  s.exclude_files = ["cpp/__tests__/**"]

  # Worklets are optional: with react-native-worklets in the app, `transform`
  # and worklet callbacks run synchronously on the UI thread.
  worklets_package = begin
    `cd "#{Pod::Config.instance.installation_root}" && node --print "require.resolve('react-native-worklets/package.json')" 2>/dev/null`.strip
  rescue StandardError
    ""
  end
  has_worklets = !worklets_package.empty? && File.exist?(worklets_package)
  if has_worklets
    Pod::UI.puts "[NitroInput] react-native-worklets found, worklet support enabled"
    s.dependency 'RNWorklets'
    s.pod_target_xcconfig = {
      "GCC_PREPROCESSOR_DEFINITIONS" => "$(inherited) MORPH_INPUT_WORKLETS=1",
      "HEADER_SEARCH_PATHS" => "$(inherited) \"$(PODS_ROOT)/Headers/Public/RNWorklets\"",
    }
  end

  load 'nitrogen/generated/ios/NitroInput+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
