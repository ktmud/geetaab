import Foundation
import XCTest

/// Reference values dumped by `scripts/golden.mjs` from the TypeScript pipeline.
///
/// The two implementations are meant to be the same algorithm, not merely
/// similar ones, so these tests compare numbers rather than behaviour. Anything
/// that drifts here is a real difference in what a player would be shown.
enum Golden {
  static let root: [String: Any] = {
    guard let url = Bundle.module.url(forResource: "golden", withExtension: "json", subdirectory: "Golden")
      ?? Bundle.module.url(forResource: "golden", withExtension: "json")
    else {
      fatalError("golden.json is missing from the test bundle")
    }
    let data = try! Data(contentsOf: url)
    return try! JSONSerialization.jsonObject(with: data) as! [String: Any]
  }()

  static func object(_ path: String) -> [String: Any] {
    var current: Any = root
    for key in path.split(separator: ".") {
      guard let dict = current as? [String: Any], let next = dict[String(key)] else {
        fatalError("golden.json has no \(path)")
      }
      current = next
    }
    guard let dict = current as? [String: Any] else { fatalError("\(path) is not an object") }
    return dict
  }

  static func doubles(_ path: String) -> [Double] {
    var current: Any = root
    for key in path.split(separator: ".") {
      guard let dict = current as? [String: Any], let next = dict[String(key)] else {
        fatalError("golden.json has no \(path)")
      }
      current = next
    }
    guard let array = current as? [Any] else { fatalError("\(path) is not an array") }
    return array.map { ($0 as? NSNumber)?.doubleValue ?? .nan }
  }

  static func strings(_ path: String) -> [String] {
    var current: Any = root
    for key in path.split(separator: ".") {
      guard let dict = current as? [String: Any], let next = dict[String(key)] else {
        fatalError("golden.json has no \(path)")
      }
      current = next
    }
    guard let array = current as? [Any] else { fatalError("\(path) is not an array") }
    return array.map { $0 as? String ?? "<not a string>" }
  }

  static func number(_ path: String) -> Double {
    var current: Any = root
    for key in path.split(separator: ".") {
      guard let dict = current as? [String: Any], let next = dict[String(key)] else {
        fatalError("golden.json has no \(path)")
      }
      current = next
    }
    guard let n = current as? NSNumber else { fatalError("\(path) is not a number") }
    return n.doubleValue
  }
}

extension [String: Any] {
  func num(_ key: String) -> Double { (self[key] as? NSNumber)?.doubleValue ?? .nan }
  func str(_ key: String) -> String { self[key] as? String ?? "" }
  func ints(_ key: String) -> [Int] {
    (self[key] as? [Any])?.map { ($0 as? NSNumber)?.intValue ?? Int.min } ?? []
  }
  func nums(_ key: String) -> [Double] {
    (self[key] as? [Any])?.map { ($0 as? NSNumber)?.doubleValue ?? .nan } ?? []
  }
}

/// Largest relative difference between two sequences, reported rather than
/// merely asserted so a tightening or loosening of a tolerance is a deliberate
/// decision made against a measurement.
func maxRelative(_ actual: [Double], _ expected: [Double], scale: Double? = nil) -> Double {
  precondition(actual.count == expected.count, "length \(actual.count) vs \(expected.count)")
  let denom = scale ?? max(1e-12, expected.map { abs($0) }.max() ?? 1)
  var worst = 0.0
  for (a, e) in zip(actual, expected) {
    if a.isNaN || e.isNaN { return .infinity }
    worst = max(worst, abs(a - e) / denom)
  }
  return worst
}

func assertClose(
  _ actual: [Double], _ expected: [Double], tolerance: Double, _ label: String,
  file: StaticString = #filePath, line: UInt = #line
) {
  XCTAssertEqual(actual.count, expected.count, "\(label): length", file: file, line: line)
  guard actual.count == expected.count else { return }
  let worst = maxRelative(actual, expected)
  XCTAssertLessThanOrEqual(worst, tolerance, "\(label): worst relative \(worst)", file: file, line: line)
}

func assertClose(
  _ actual: Double, _ expected: Double, tolerance: Double, _ label: String,
  file: StaticString = #filePath, line: UInt = #line
) {
  let denom = max(1e-9, abs(expected))
  let rel = abs(actual - expected) / denom
  XCTAssertLessThanOrEqual(
    rel, tolerance, "\(label): \(actual) vs \(expected), relative \(rel)", file: file, line: line)
}

/// The compact summary `scripts/golden.mjs` writes for arrays too big to store.
struct Digest {
  let length: Int
  let sum: Double
  let sumAbs: Double
  let weighted: Double
  let min: Double
  let max: Double
  let head: [Double]
  let tail: [Double]
  let probes: [Double]

  init(_ dict: [String: Any]) {
    length = Int(dict.num("length"))
    sum = dict.num("sum")
    sumAbs = dict.num("sumAbs")
    weighted = dict.num("weighted")
    min = dict.num("min")
    max = dict.num("max")
    head = dict.nums("head")
    tail = dict.nums("tail")
    probes = dict.nums("probes")
  }

  static func of<T: BinaryFloatingPoint>(_ values: [T]) -> Digest {
    let a = values.map(Double.init)
    var sum = 0.0
    var sumAbs = 0.0
    var weighted = 0.0
    for (i, v) in a.enumerated() {
      sum += v
      sumAbs += abs(v)
      weighted += v * Double((i % 97) + 1)
    }
    var probes: [Double] = []
    let step = Swift.max(1, a.count / 12)
    var i = 0
    while i < a.count && probes.count < 12 {
      probes.append(a[i])
      i += step
    }
    return Digest(
      length: a.count, sum: sum, sumAbs: sumAbs, weighted: weighted,
      min: a.isEmpty ? 0 : a.min()!, max: a.isEmpty ? 0 : a.max()!,
      head: Array(a.prefix(6)), tail: Array(a.suffix(6)), probes: probes)
  }

  private init(
    length: Int, sum: Double, sumAbs: Double, weighted: Double, min: Double, max: Double,
    head: [Double], tail: [Double], probes: [Double]
  ) {
    self.length = length
    self.sum = sum
    self.sumAbs = sumAbs
    self.weighted = weighted
    self.min = min
    self.max = max
    self.head = head
    self.tail = tail
    self.probes = probes
  }
}

func assertDigest(
  _ actual: Digest, _ expected: Digest, tolerance: Double, _ label: String,
  file: StaticString = #filePath, line: UInt = #line
) {
  XCTAssertEqual(actual.length, expected.length, "\(label): length", file: file, line: line)
  guard actual.length == expected.length else { return }
  // The sums run over millions of terms, so they are compared against the
  // magnitude the array actually carries rather than against their own value,
  // which cancellation can drive arbitrarily close to zero.
  let scale = Swift.max(1e-12, expected.sumAbs)
  XCTAssertLessThanOrEqual(
    abs(actual.sum - expected.sum) / scale, tolerance, "\(label): sum", file: file, line: line)
  XCTAssertLessThanOrEqual(
    abs(actual.sumAbs - expected.sumAbs) / scale, tolerance, "\(label): sumAbs", file: file, line: line)
  XCTAssertLessThanOrEqual(
    abs(actual.weighted - expected.weighted) / (scale * 97), tolerance, "\(label): weighted",
    file: file, line: line)
  let peak = Swift.max(abs(expected.min), abs(expected.max), 1e-12)
  XCTAssertLessThanOrEqual(
    abs(actual.min - expected.min) / peak, tolerance, "\(label): min", file: file, line: line)
  XCTAssertLessThanOrEqual(
    abs(actual.max - expected.max) / peak, tolerance, "\(label): max", file: file, line: line)
  assertClose(actual.head, expected.head, tolerance: tolerance, "\(label): head", file: file, line: line)
  assertClose(actual.tail, expected.tail, tolerance: tolerance, "\(label): tail", file: file, line: line)
  assertClose(
    actual.probes, expected.probes, tolerance: tolerance, "\(label): probes", file: file, line: line)
}
