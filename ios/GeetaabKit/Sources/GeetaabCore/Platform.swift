#if canImport(Darwin)
@_exported import Darwin
#elseif canImport(Glibc)
@_exported import Glibc
#elseif canImport(Musl)
@_exported import Musl
#endif

#if canImport(Accelerate)
import Accelerate
#endif

/// Whether this build has a vendor-accelerated FFT behind ``FFT``.
///
/// Exposed so a test can assert the two paths agree rather than silently
/// covering only whichever one it happened to run on.
public let usesAcceleratedFFT: Bool = {
  #if canImport(Accelerate)
  return true
  #else
  return false
  #endif
}()
