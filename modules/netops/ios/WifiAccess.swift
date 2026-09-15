import Foundation
import Network
import NetworkExtension
import CoreLocation

/**
 * Wi-Fi capability for iOS (M5 parity, M8 implementation).
 *
 * Three honest translations of the Android half:
 *
 * 1. **Permission = CoreLocation.** iOS gates SSID/BSSID behind location
 *    authorisation (plus the `com.apple.developer.networking.wifi-info`
 *    entitlement), so the `wifiInfo` scope maps to that. The status shape is
 *    identical to Android's, which is what lets `PermissionsCapability` and the
 *    Wi-Fi screen stay platform-agnostic.
 * 2. **Fields iOS does not expose stay null.** `NEHotspotNetwork` gives SSID,
 *    BSSID and a 0–1 signal *quality*; it gives no frequency, no dBm and no link
 *    speed. Inventing a dBm from the quality would be a lie, so those keys are
 *    explicitly `null` and the UI shows "unavailable" (§6.4).
 * 3. **Transports come from `NWPathMonitor`, which needs no permission**, so a
 *    build without the entitlement still reports how the device is connected.
 */
enum WifiAccess {
  /** Current authorisation state, in the shared permission shape. */
  static func currentPermission(completion: @escaping ([String: Any]) -> Void) {
    onMain {
      completion(status(for: locationAuthorization()))
    }
  }

  /**
   * Ask for authorisation, resolving when the user answers (or immediately when
   * the answer is already known).
   *
   * `CLLocationManager` is main-thread-only, and its delegate fires once as soon
   * as it is set — hence the manager lives in a small object that is retained
   * until the promise is resolved and ignores the not-determined callback.
   */
  static func requestPermission(completion: @escaping ([String: Any]) -> Void) {
    onMain {
      let requester = PermissionRequester(completion: completion)
      PermissionRequester.current = requester
      requester.start()
    }
  }

  /**
   * A Wi-Fi snapshot. Never fails: a build without the entitlement (or without
   * location authorisation) resolves with null identity fields and real
   * transports.
   */
  static func currentInfo(completion: @escaping ([String: Any]) -> Void) {
    // Main thread because of `CLLocationManager` below (see currentPermission).
    onMain {
      currentInfoOnMain(completion: completion)
    }
  }

  private static func currentInfoOnMain(completion: @escaping ([String: Any]) -> Void) {
    transports { transportInfo in
      var info = transportInfo
      info["ssid"] = NSNull()
      info["bssid"] = NSNull()
      // No public iOS API exposes these; null is the honest answer (see file
      // header). The gateway would need the default route (getifaddrs does not
      // carry it) and the resolver list lives behind dns_configuration_copy,
      // which is not public API — so neither is guessed.
      info["frequencyMHz"] = NSNull()
      info["rssi"] = NSNull()
      info["linkSpeedMbps"] = NSNull()
      info["gateway"] = NSNull()
      info["dnsServers"] = []

      guard locationAuthorization().isAuthorized else {
        // Without authorisation `NEHotspotNetwork` cannot return anything, and
        // asking would only risk a promise that never resolves.
        completion(info)
        return
      }

      var settled = false
      let settle: ([String: Any]) -> Void = { final in
        guard !settled else { return }
        settled = true
        completion(final)
      }

      // Safety net: if the entitlement is missing, `fetchCurrent` is documented
      // to return nil — but a promise that never resolves would hang the Wi-Fi
      // screen, so it is bounded here too.
      DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(2)) {
        settle(info)
      }

      NEHotspotNetwork.fetchCurrent { network in
        var withIdentity = info
        if let network {
          withIdentity["ssid"] = network.ssid
          withIdentity["bssid"] = network.bssid.isEmpty ? NSNull() : network.bssid
        }
        settle(withIdentity)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private static func onMain(_ work: @escaping () -> Void) {
    if Thread.isMainThread {
      work()
    } else {
      DispatchQueue.main.async(execute: work)
    }
  }

  private static func locationAuthorization() -> CLAuthorizationStatus {
    CLLocationManager().authorizationStatus
  }

  /** CoreLocation status → the shape `PermissionsService` expects everywhere. */
  private static func status(for authorization: CLAuthorizationStatus) -> [String: Any] {
    switch authorization {
    case .authorizedAlways, .authorizedWhenInUse:
      return ["granted": true, "canAskAgain": false, "status": "granted"]
    case .notDetermined:
      return ["granted": false, "canAskAgain": true, "status": "undetermined"]
    case .denied, .restricted:
      return ["granted": false, "canAskAgain": false, "status": "denied"]
    @unknown default:
      return ["granted": false, "canAskAgain": false, "status": "unavailable"]
    }
  }

  /** Current transports. `.other` is how iOS presents a tunnel/VPN interface. */
  private static func transports(completion: @escaping ([String: Any]) -> Void) {
    let monitor = NWPathMonitor()
    monitor.pathUpdateHandler = { path in
      monitor.cancel()
      completion([
        "transportWifi": path.usesInterfaceType(.wifi),
        "transportCellular": path.usesInterfaceType(.cellular),
        "transportVpn": path.usesInterfaceType(.other),
        "transportEthernet": path.usesInterfaceType(.wiredEthernet),
      ])
    }
    monitor.start(queue: DispatchQueue(label: "netops.wifi.path"))
  }
}

private extension CLAuthorizationStatus {
  var isAuthorized: Bool {
    self == .authorizedAlways || self == .authorizedWhenInUse
  }
}

/** Retained only while a permission request is outstanding. */
final class PermissionRequester: NSObject, CLLocationManagerDelegate {
  static var current: PermissionRequester?

  private let manager = CLLocationManager()
  private let completion: ([String: Any]) -> Void
  private var resolved = false

  init(completion: @escaping ([String: Any]) -> Void) {
    self.completion = completion
    super.init()
  }

  func start() {
    manager.delegate = self
    if manager.authorizationStatus == .notDetermined {
      manager.requestWhenInUseAuthorization()
    } else {
      // The delegate callback fires immediately with the known status; there is
      // nothing to ask, so answer now.
      finish()
    }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    if manager.authorizationStatus != .notDetermined {
      finish()
    }
  }

  private func finish() {
    guard !resolved else { return }
    resolved = true
    let status = manager.authorizationStatus
    let shape: [String: Any]
    switch status {
    case .authorizedAlways, .authorizedWhenInUse:
      shape = ["granted": true, "canAskAgain": false, "status": "granted"]
    case .notDetermined:
      shape = ["granted": false, "canAskAgain": true, "status": "undetermined"]
    case .denied, .restricted:
      shape = ["granted": false, "canAskAgain": false, "status": "denied"]
    @unknown default:
      shape = ["granted": false, "canAskAgain": false, "status": "unavailable"]
    }
    completion(shape)
    PermissionRequester.current = nil
  }
}
