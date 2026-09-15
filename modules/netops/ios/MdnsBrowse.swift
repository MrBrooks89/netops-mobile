import Darwin
import Foundation

/**
 * Bonjour/mDNS discovery for iOS (M7 parity, M8 implementation; plan #45).
 *
 * The **same ten service types** Android browses (guarded by
 * `src/platform/mdnsServiceTypes.test.ts` against `app.json`'s
 * `NSBonjourServices` and the Kotlin list) and the same JSON shape, so
 * `lanDiscovery` merges identical results on both platforms.
 *
 * Two platform differences are deliberate and documented:
 *  - **No multicast lock.** That is an Android concept; iOS's Bonjour stack is
 *    managed by the system, and `NWBrowser`/`NetServiceBrowser` need no
 *    entitlement — only the declared service types (ADR-010).
 *  - **`NetServiceBrowser` rather than `NWBrowser`.** `NWBrowser` is the modern
 *    API but hands back an unresolved endpoint: getting an address from it means
 *    opening a TCP connection to every discovered device, which a discovery tool
 *    should not do unprompted. `NetService` resolves names to addresses without
 *    touching the device, so it is the better fit here even though it is
 *    deprecated in iOS 17 — the deprecation is noted as M9 work, and the
 *    contract this returns is unchanged either way.
 *
 * Failure is a value: nothing found is `available: true` with no services;
 * a browse that could not start at all is `available: false` with a reason, and
 * the LAN screen then says "TCP sweep only" (M7 acceptance).
 */
enum MdnsBrowse {
  /**
   * Keep in sync with `MDNS_SERVICE_TYPES` (Kotlin) and
   * `ios.infoPlist.NSBonjourServices` — the drift guard fails otherwise.
   */
  static let serviceTypes = [
    "_http._tcp",
    "_https._tcp",
    "_ipp._tcp",
    "_printer._tcp",
    "_googlecast._tcp",
    "_airplay._tcp",
    "_raop._tcp",
    "_ssh._tcp",
    "_smb._tcp",
    "_workstation._tcp",
  ]

  static func browse(windowMs: Int, completion: @escaping ([String: Any]) -> Void) {
    let collector = MdnsCollector(serviceTypes: serviceTypes, windowMs: windowMs, completion: completion)
    collector.start()
  }
}

final class MdnsCollector: NSObject, NetServiceBrowserDelegate, NetServiceDelegate {
  private let serviceTypes: [String]
  private let windowMs: Int
  private let completion: ([String: Any]) -> Void

  private var browsers: [NetServiceBrowser] = []
  private var resolving: [NetService] = []
  private var services: [[String: Any]] = []
  private var seen = Set<String>()
  private var failedSearches = 0
  private var finished = false

  init(serviceTypes: [String], windowMs: Int, completion: @escaping ([String: Any]) -> Void) {
    self.serviceTypes = serviceTypes
    self.windowMs = windowMs
    self.completion = completion
    super.init()
  }

  func start() {
    onMain { [weak self] in
      guard let self else { return }
      for type in self.serviceTypes {
        let browser = NetServiceBrowser()
        browser.delegate = self
        browser.schedule(in: RunLoop.main, forMode: .default)
        browser.searchForServices(ofType: type, inDomain: "local.")
        self.browsers.append(browser)
      }
      DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(self.windowMs)) {
        self.finish()
      }
    }
  }

  // MARK: - NetServiceBrowserDelegate

  func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
    let key = "\(service.name)|\(service.type)"
    guard !seen.contains(key) else { return }
    seen.insert(key)
    service.delegate = self
    resolving.append(service)
    // Resolution is what turns a Bonjour name into an address; it does not
    // contact the device itself.
    service.resolve(withTimeout: Double(windowMs) / 1000.0)
  }

  func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
    failedSearches += 1
  }

  // MARK: - NetServiceDelegate

  func netServiceDidResolveAddress(_ sender: NetService) {
    let addresses = (sender.addresses ?? []).compactMap { ipv4String($0) }
    guard !addresses.isEmpty else { return }
    let host = sender.hostName?.hasSuffix(".") == true
      ? String(sender.hostName!.dropLast())
      : sender.hostName
    let name = host?.replacingOccurrences(of: ".local", with: "") ?? sender.name
    services.append([
      "name": name,
      "host": host ?? NSNull(),
      "addresses": addresses,
      "port": sender.port > 0 ? sender.port : NSNull(),
      "serviceType": sender.type.hasSuffix(".") ? String(sender.type.dropLast()) : sender.type,
    ])
  }

  func netService(_ sender: NetService, didNotResolve errorDict: [String: NSNumber]) {
    // A service that will not resolve contributes nothing; the TCP sweep may
    // still find the device.
  }

  // MARK: - Internals

  private func finish() {
    guard !finished else { return }
    finished = true
    onMain { [weak self] in
      guard let self else { return }
      for browser in self.browsers {
        browser.stop()
        browser.remove(from: RunLoop.main, forMode: .default)
      }
    }

    let started = browsers.count - failedSearches
    var result: [String: Any] = ["services": services, "available": started > 0]
    if started <= 0 {
      result["reason"] = "mDNS discovery could not start"
    }
    completion(result)
  }

  private func onMain(_ work: @escaping () -> Void) {
    if Thread.isMainThread {
      work()
    } else {
      DispatchQueue.main.async(execute: work)
    }
  }

  /** sockaddr bytes → dotted-quad, IPv4 only (the model is IPv4, like Android). */
  private func ipv4String(_ data: Data) -> String? {
    var storage = sockaddr_storage()
    guard data.count <= MemoryLayout<sockaddr_storage>.size else { return nil }
    data.withUnsafeBytes { buffer in
      guard let base = buffer.baseAddress else { return }
      memcpy(&storage, base, data.count)
    }
    guard storage.ss_family == sa_family_t(AF_INET) else { return nil }

    var text = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
    return withUnsafePointer(to: &storage) { pointer -> String? in
      pointer.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { address -> String? in
        var raw = address.pointee.sin_addr
        guard inet_ntop(AF_INET, &raw, &text, socklen_t(text.count)) != nil else { return nil }
        return String(cString: text)
      }
    }
  }
}
