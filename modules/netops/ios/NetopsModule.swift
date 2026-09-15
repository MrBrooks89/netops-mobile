import ExpoModulesCore
import Foundation

/**
 * netops — the project's one local Expo module (plan §8; ADR trail M5+).
 *
 * Swift half of the Kotlin module. Every function resolves the **same JSON
 * shape** the Android half resolves, so the TypeScript surface in
 * `modules/netops/src/NetopsModule.ts` is genuinely one contract and the
 * capability adapters stay platform-agnostic (plan §6.3.2).
 *
 * iOS reality for each function (plan §10, docs/IOS_PARITY.md):
 *  - getWifiPermissions / requestWifiPermissions: the Wi-Fi scope maps to
 *    CoreLocation authorisation, because that is what gates SSID/BSSID on iOS.
 *    Same `{granted, canAskAgain, status}` shape as Android.
 *  - getWifiInfo: `NEHotspotNetwork` (needs the wifi-info entitlement) for
 *    SSID/BSSID; `NWPathMonitor` for transports. Frequency, RSSI and link
 *    speed have no iOS equivalent, so they are honest `null`s and the UI
 *    renders explicit "unavailable" rows (§6.4).
 *  - isReachable: unprivileged ICMP datagram socket (the SimplePing
 *    approach, see IcmpPing.swift). Best-effort reachability, no privileges,
 *    no invented timing (D4).
 *  - getTlsInfo: `URLSession` trust challenge records the chain the server
 *    presents and the system still decides whether to trust it — there is no
 *    validation bypass anywhere in this module (§16.7).
 *  - localSubnet: `getifaddrs` walk for the device's own IPv4 subnet (M7).
 *  - discoverMdns: Bonjour browse + resolve for the same ten service types
 *    Android browses (M7; see MdnsBrowse.swift).
 *
 * None of these throw: an unavailable platform or a denied permission is a
 * value the caller renders (plan §6.4).
 */
public class NetopsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Netops")

    AsyncFunction("getWifiPermissions") { (promise: Promise) in
      WifiAccess.currentPermission { status in
        promise.resolve(status)
      }
    }

    AsyncFunction("requestWifiPermissions") { (promise: Promise) in
      WifiAccess.requestPermission { status in
        promise.resolve(status)
      }
    }

    AsyncFunction("getWifiInfo") { (promise: Promise) in
      WifiAccess.currentInfo { info in
        promise.resolve(info)
      }
    }

    AsyncFunction("isReachable") { (host: String, timeoutMs: Int, promise: Promise) in
      IcmpPing.probe(host: host, timeoutMs: timeoutMs) { result in
        promise.resolve(result)
      }
    }

    AsyncFunction("getTlsInfo") { (host: String, port: Int, timeoutMs: Int, promise: Promise) in
      TlsCapture.capture(host: host, port: port, timeoutMs: timeoutMs) { result in
        promise.resolve(result)
      }
    }

    AsyncFunction("localSubnet") { (promise: Promise) in
      promise.resolve(LocalSubnet.read())
    }

    AsyncFunction("discoverMdns") { (windowMs: Int, promise: Promise) in
      MdnsBrowse.browse(windowMs: windowMs) { result in
        promise.resolve(result)
      }
    }
  }
}
