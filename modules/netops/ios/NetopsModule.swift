import ExpoModulesCore
import Foundation

/**
 * netops — the project's one local Expo module (plan §8; ADR trail M5+).
 *
 * Swift half of the Kotlin module (plan §6.3.2: written alongside, even
 * before a device can run it, so the API never grows Kotlin-shaped).
 *
 * iOS reality for each function (plan §15):
 *  - Wi-Fi SSID/BSSID need the location permission *plus* the
 *    com.apple.developer.networking.wifi-info entitlement; everything here
 *    returns optionals and the UI renders "unavailable" rows (§6.4).
 *  - ICMP echo needs raw sockets: implemented with a SimplePing-style flow
 *    when the capability ships on iOS; until then isReachable reports
 *    false and the UI stays on its honest "best-effort" label (D4).
 *  - TLS chain capture (M6, #42): URLSession exposes the full trust chain
 *    via the server trust challenge (SecTrustCopyCertificateChain). The
 *    capture is display-only (§16.7) — it never alters validation for any
 *    other request.
 */
public class NetopsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("Netops")

    AsyncFunction("getWifiPermissions") { promise in
      promise.resolve([
        "granted": false,
        "canAskAgain": false,
        "status": "unavailable",
      ])
    }

    AsyncFunction("requestWifiPermissions") { promise in
      promise.resolve([
        "granted": false,
        "canAskAgain": false,
        "status": "unavailable",
      ])
    }

    AsyncFunction("getWifiInfo") { promise in
      // NEHotspotNetwork (current SSID) requires the wifi-info entitlement
      // and returns nil without it — modeled here as "no info", which the
      // UI renders as explicit unavailable rows rather than blanks.
      promise.resolve(nil)
    }

    AsyncFunction("isReachable") { (host: String, timeoutMs: Int, promise: Promise) in
      // Best-effort only on iOS until a SimplePing-style capability lands
      // (plan §15 note 4). Never throw: unreachable is a value.
      promise.resolve(["reachable": false, "error": "not implemented on this platform"])
    }

    AsyncFunction("getTlsInfo") { (host: String, port: Int, timeoutMs: Int, promise: Promise) in
      // M8 groundwork: real chain capture will open a URLSession challenge
      // and copy SecTrust's chain (SecTrustCopyCertificateChain), mapping
      // each SecCertificate to the same shape the Kotlin half resolves.
      // Until the iOS device work lands, the honest answer is the error
      // value — the tool degrades instead of pretending.
      promise.resolve(["error": "TLS inspection is not available on this platform yet"])
    }
  }
}
