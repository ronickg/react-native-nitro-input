require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "NitroMorphInput"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported, :visionos => 1.0 }
  s.source       = { :git => "https://github.com/ronickg/react-native-nitro-rolling-number.git", :tag => "morph-input-v#{s.version}" }

  s.source_files = [
    # Implementation (Swift)
    "ios/**/*.{swift}",
    # Autolinking/Registration (Objective-C++)
    "ios/**/*.{m,mm}",
    # Implementation (C++ objects)
    "cpp/**/*.{hpp,cpp}",
  ]

  # The shared C++ engine and formatter are public headers so the pod's Swift
  # sources can call them directly through Swift/C++ interop (enabled by Nitro below).
  s.public_header_files = ["cpp/**/*.hpp"]
  # The engine's unit tests build as a host executable (`bun run test:cpp`).
  s.exclude_files = ["cpp/__tests__/**"]

  load 'nitrogen/generated/ios/NitroMorphInput+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
