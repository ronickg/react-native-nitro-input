require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "BenchProbe"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/ronickg/react-native-nitro-input"
  s.license      = "MIT"
  s.authors      = "Ronald Goedeke"
  s.platforms    = { :ios => "16.4" }
  s.source       = { :git => "https://github.com/ronickg/react-native-nitro-input.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm}"

  install_modules_dependencies(s)
end
