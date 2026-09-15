import Darwin
import Foundation

/**
 * The device's own IPv4 subnet (M7 parity, M8 implementation).
 *
 * The LAN screen offers "scan my network" without asking the user to type a
 * CIDR, so this reports the first site-local IPv4 interface that is up and not
 * loopback — the same rule the Kotlin half applies with
 * `NetworkInterface`/`isSiteLocalAddress`.
 *
 * Returns `nil` when there is nothing usable (no association, airplane mode),
 * which the capability surfaces as `NOT_FOUND` and the screen turns into a
 * hint; it never guesses a network to sweep.
 */
enum LocalSubnet {
  static func read() -> [String: Any]? {
    var interfaces: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&interfaces) == 0, let first = interfaces else { return nil }
    defer { freeifaddrs(interfaces) }

    var current: UnsafeMutablePointer<ifaddrs>? = first
    while let interface = current?.pointee {
      defer { current = interface.ifa_next }
      guard let address = interface.ifa_addr, address.pointee.sa_family == UInt8(AF_INET) else {
        continue
      }
      let flags = Int32(interface.ifa_flags)
      guard flags & IFF_UP == IFF_UP, flags & IFF_LOOPBACK != IFF_LOOPBACK else { continue }
      guard
        let host = ipv4String(address),
        isSiteLocal(host),
        let prefix = prefixLength(interface.ifa_netmask)
      else { continue }
      return ["address": host, "prefixLength": prefix]
    }
    return nil
  }

  private static func ipv4String(_ address: UnsafeMutablePointer<sockaddr>) -> String? {
    var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
    return address.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { pointer -> String? in
      var raw = pointer.pointee.sin_addr
      guard inet_ntop(AF_INET, &raw, &buffer, socklen_t(buffer.count)) != nil else { return nil }
      return String(cString: buffer)
    }
  }

  /** Leading 1 bits of the netmask — the prefix length, without a lookup table. */
  private static func prefixLength(_ mask: UnsafeMutablePointer<sockaddr>?) -> Int? {
    guard let mask, mask.pointee.sa_family == UInt8(AF_INET) else { return nil }
    return mask.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { pointer -> Int in
      let value = UInt32(bigEndian: pointer.pointee.sin_addr.s_addr)
      return value.leadingZeroBitCount
    }
  }

  /** RFC 1918 ranges, matching `InetAddress.isSiteLocalAddress` on Android. */
  private static func isSiteLocal(_ address: String) -> Bool {
    let octets = address.split(separator: ".").compactMap { UInt8($0) }
    guard octets.count == 4 else { return false }
    switch (octets[0], octets[1]) {
    case (10, _): return true
    case (172, 16...31): return true
    case (192, 168): return true
    default: return false
    }
  }
}
