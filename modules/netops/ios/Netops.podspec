require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'Netops'
  s.version        = package['version']
  s.summary         = package['description']
  # CocoaPods rejects a description equal to the summary, so this adds the one
  # thing the summary cannot say: both platform halves share a JSON contract.
  s.description     = "#{package['description']} The Kotlin and Swift halves resolve the same shapes, so the TypeScript surface is one contract."
  s.license         = package['license']
  # Required for podspec validation; the first iOS build ever run (M8, CI)
  # failed here because these were missing (see docs/M8_VERIFICATION.md).
  s.authors         = package['author']
  s.homepage        = package['homepage']
  s.source          = { :git => package['repository']['url'], :tag => s.version.to_s }

  s.platforms      = {
    :ios => '16.4'
  }
  s.swift_version  = '5.9'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = "**/*.{h,m,swift}"
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
