import Darwin
import Foundation

/**
 * ICMP reachability for iOS (M5 parity, M8 implementation; plan D4).
 *
 * iOS has no privileged ping, but since iOS 12 an app may open an
 * **unprivileged ICMP datagram socket** (`SOCK_DGRAM`, `IPPROTO_ICMP`) — the
 * approach Apple's SimplePing sample uses. That is what this is: one echo
 * request, one bounded wait, reachable or not.
 *
 * Two things this deliberately does not do:
 *  - **No timing.** The result carries reachability only, matching Android's
 *    `InetAddress.isReachable`, so the UI keeps its honest "best-effort, no
 *    timing" label. TCP ping remains the default method that reports latency.
 *  - **No retries.** A single probe per call; the ping tool owns the count and
 *    the interval, exactly as it does on Android.
 *
 * Failure modes are values, never throws: an unavailable socket (some
 * sandboxes), an unresolvable host and a silent network all resolve
 * `{reachable: false, error: ...}`. A false negative here is honest; the tool
 * says "best-effort" and offers TCP ping as the reliable path.
 */
enum IcmpPing {
  static func probe(host: String, timeoutMs: Int, completion: @escaping ([String: Any]) -> Void) {
    DispatchQueue.global(qos: .userInitiated).async {
      completion(echo(host: host, timeoutMs: timeoutMs))
    }
  }

  private static func echo(host: String, timeoutMs: Int) -> [String: Any] {
    guard let address = resolveIPv4(host) else {
      return ["reachable": false, "error": "Could not resolve host"]
    }
    defer { freeaddrinfo(address.info) }

    let descriptor = socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP)
    guard descriptor >= 0 else {
      return ["reachable": false, "error": "ICMP socket unavailable"]
    }
    defer { close(descriptor) }

    let identifier = UInt16(truncatingIfNeeded: getpid())
    var packet = echoRequest(identifier: identifier, sequence: 1)
    let sent = packet.withUnsafeBytes { buffer -> Int in
      sendto(
        descriptor,
        buffer.baseAddress,
        buffer.count,
        0,
        address.pointer,
        socklen_t(address.pointer.pointee.sa_len)
      )
    }
    guard sent > 0 else {
      return ["reachable": false, "error": "Could not send ICMP probe"]
    }

    var ready = pollfd(fd: descriptor, events: Int16(POLLIN), revents: 0)
    let waitResult = poll(&ready, 1, Int32(max(1, timeoutMs)))
    if waitResult == 0 {
      return ["reachable": false, "error": "timeout"]
    }
    guard waitResult > 0 else {
      return ["reachable": false, "error": "The probe could not wait for a reply"]
    }

    var reply = [UInt8](repeating: 0, count: 512)
    var source = sockaddr_storage()
    var sourceLength = socklen_t(MemoryLayout<sockaddr_storage>.size)
    let received = withUnsafeMutablePointer(to: &source) { pointer -> Int in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
        reply.withUnsafeMutableBytes { buffer -> Int in
          recvfrom(descriptor, buffer.baseAddress, buffer.count, 0, socketAddress, &sourceLength)
        }
      }
    }
    guard received > 0 else {
      return ["reachable": false, "error": "No reply"]
    }

    // A datagram ICMP socket on Darwin delivers the ICMP message itself (no IP
    // header), so byte 0 is the type: 0 is an echo reply.
    guard reply[0] == 0 else {
      return ["reachable": false, "error": "Unexpected ICMP reply type \(reply[0])"]
    }
    return ["reachable": true]
  }

  /** An IPv4 ICMP echo request with a valid checksum. */
  private static func echoRequest(identifier: UInt16, sequence: UInt16) -> [UInt8] {
    var packet = [UInt8](repeating: 0, count: 16)
    packet[0] = 8 // echo request
    packet[1] = 0 // code
    packet[4] = UInt8(identifier >> 8)
    packet[5] = UInt8(identifier & 0xff)
    packet[6] = UInt8(sequence >> 8)
    packet[7] = UInt8(sequence & 0xff)
    // 8 bytes of payload keep the packet non-trivial for middleboxes that drop
    // empty echoes; the content is irrelevant.
    for index in 8..<packet.count {
      packet[index] = UInt8(index)
    }
    let checksum = internetChecksum(packet)
    packet[2] = UInt8(checksum >> 8)
    packet[3] = UInt8(checksum & 0xff)
    return packet
  }

  /** RFC 1071 one's-complement checksum over 16-bit words. */
  private static func internetChecksum(_ bytes: [UInt8]) -> UInt16 {
    var sum: UInt32 = 0
    var index = 0
    while index + 1 < bytes.count {
      sum += UInt32(bytes[index]) << 8 | UInt32(bytes[index + 1])
      index += 2
    }
    if index < bytes.count {
      sum += UInt32(bytes[index]) << 8
    }
    while sum >> 16 != 0 {
      sum = (sum & 0xffff) + (sum >> 16)
    }
    return UInt16(~sum & 0xffff)
  }

  /** Resolve `host` to an IPv4 `sockaddr`, keeping the `addrinfo` alive. */
  private static func resolveIPv4(_ host: String) -> (info: UnsafeMutablePointer<addrinfo>, pointer: UnsafeMutablePointer<sockaddr>)? {
    var hints = addrinfo(
      ai_flags: 0,
      ai_family: AF_INET,
      ai_socktype: SOCK_DGRAM,
      ai_protocol: IPPROTO_ICMP,
      ai_addrlen: 0,
      ai_canonname: nil,
      ai_addr: nil,
      ai_next: nil
    )
    var info: UnsafeMutablePointer<addrinfo>?
    guard getaddrinfo(host, nil, &hints, &info) == 0, let resolved = info, let address = resolved.pointee.ai_addr else {
      if let info { freeaddrinfo(info) }
      return nil
    }
    return (info: resolved, pointer: address)
  }
}
