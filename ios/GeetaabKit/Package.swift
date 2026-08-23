// swift-tools-version: 5.9
import PackageDescription

// The engine is split so the part that decides what a recording contains can be
// tested anywhere Swift runs, not only on a Mac with a simulator. GeetaabCore
// touches no Apple framework and no I/O; GeetaabAudio is the part that must.
let package = Package(
  name: "GeetaabKit",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [
    .library(name: "GeetaabCore", targets: ["GeetaabCore"]),
    .library(name: "GeetaabAudio", targets: ["GeetaabAudio"]),
  ],
  targets: [
    .target(name: "GeetaabCore"),
    .target(name: "GeetaabAudio", dependencies: ["GeetaabCore"]),
    .testTarget(
      name: "GeetaabCoreTests",
      dependencies: ["GeetaabCore"],
      resources: [.copy("Golden")]
    ),
  ]
)
