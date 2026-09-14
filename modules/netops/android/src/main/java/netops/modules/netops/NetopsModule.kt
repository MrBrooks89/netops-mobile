package netops.modules.netops

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.interfaces.permissions.Permissions
import java.net.InetAddress
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * netops — the project's one local Expo module (plan §8; ADR trail M5+).
 *
 * Surface (mirrored by the Swift half):
 *  - getWifiPermissions / requestWifiPermissions: typed permission flow
 *    (plan §6.3.4). Resolves {granted, canAskAgain, status} — the same
 *    shape PermissionsService hands back, so JS gets one convention.
 *  - getWifiInfo: null-safe WifiManager/ConnectivityManager mapping. Every
 *    field is nullable: Android gates SSID/BSSID behind location permission
 *    + enabled Location Services; the UI renders explicit "unavailable"
 *    rows rather than blank ones (plan §6.4).
 *  - isReachable: ICMP best-effort reachability via
 *    InetAddress.isReachable (D4: honest "best-effort" label in the UI;
 *    TCP ping is the default, never this).
 */
class NetopsModule : Module() {
  private val wifiPermissions = arrayOf(
    Manifest.permission.ACCESS_FINE_LOCATION,
    Manifest.permission.ACCESS_COARSE_LOCATION,
  )

  override fun definition() = ModuleDefinition {
    Name("Netops")

    AsyncFunction("getWifiPermissions") { promise: Promise ->
      resolvePermissions(appContext.permissions, promise)
    }

    AsyncFunction("requestWifiPermissions") { promise: Promise ->
      val permissions = appContext.permissions
      if (permissions == null) {
        promise.resolve(unavailablePermissionStatus())
        return@AsyncFunction
      }
      Permissions.askForPermissionsWithPermissionsManager(permissions, promise, *wifiPermissions)
    }

    AsyncFunction("getWifiInfo") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      promise.resolve(readWifiInfo(context))
    }

    AsyncFunction("isReachable") { host: String, timeoutMs: Int, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          val address = withContext(Dispatchers.IO) { InetAddress.getByName(host) }
          val reachable = withContext(Dispatchers.IO) { address.isReachable(timeoutMs) }
          promise.resolve(mapOf("reachable" to reachable))
        } catch (e: Exception) {
          promise.resolve(mapOf("reachable" to false, "error" to (e.message ?: e.toString())))
        }
      }
    }
  }

  private fun resolvePermissions(permissions: Permissions?, promise: Promise) {
    if (permissions == null) {
      promise.resolve(unavailablePermissionStatus())
      return
    }
    Permissions.getPermissionsWithPermissionsManager(permissions, promise, *wifiPermissions)
  }

  private fun unavailablePermissionStatus(): Map<String, Any?> = mapOf(
    "granted" to false,
    "canAskAgain" to false,
    "status" to "unavailable",
  )

  /** Null-safe Wi-Fi/Connectivity read; every key optional (see class doc). */
  @SuppressLint("MissingPermission") // runtime-gated by the permission flow in JS; reads degrade to nulls
  private fun readWifiInfo(context: Context): Map<String, Any?>? {
    try {
      val appContext = context.applicationContext
      val wifiManager = appContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
        ?: return null
      val connectivityManager =
        appContext.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
          ?: return null

      val wifiInfo: WifiInfo? = try {
        @Suppress("DEPRECATION")
        wifiManager.connectionInfo
      } catch (e: Exception) {
        null
      }

      // SSID is location-gated: Android hands back "<unknown ssid>" when the
      // permission is missing or Location Services is off. Normalize to null
      // so the UI shows an explicit "unavailable" row (plan §6.4).
      val ssid: String? = wifiInfo?.ssid?.let { raw ->
        if (raw.contains("<unknown ssid>") || raw.isBlank()) null
        else raw.removeSurrounding("\"")
      }
      val bssid: String? = wifiInfo?.bssid?.let { raw ->
        if (raw.isBlank() || raw == "02:00:00:00:00:00") null else raw
      }
      val frequencyMHz: Int? = wifiInfo?.frequency?.takeIf { it > 0 }
      val rssi: Int? = wifiInfo?.rssi?.takeIf { it != 0 }
      val linkSpeedMbps: Int? = wifiInfo?.linkSpeed?.takeIf { it > 0 }

      val capabilities: NetworkCapabilities? = try {
        connectivityManager.activeNetwork?.let { connectivityManager.getNetworkCapabilities(it) }
      } catch (e: Exception) {
        null
      }

      return mapOf(
        "ssid" to ssid,
        "bssid" to bssid,
        "frequencyMHz" to frequencyMHz,
        "rssi" to rssi,
        "linkSpeedMbps" to linkSpeedMbps,
        "transportWifi" to (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true),
        "transportCellular" to (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true),
        "transportVpn" to (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_VPN) == true),
        "transportEthernet" to (capabilities?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true),
      )
    } catch (e: Exception) {
      return null
    }
  }
}
