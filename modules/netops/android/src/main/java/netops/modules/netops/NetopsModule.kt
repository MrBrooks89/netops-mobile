package netops.modules.netops

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.util.Log
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.interfaces.permissions.Permissions
import java.io.BufferedReader
import java.net.Inet4Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.URL
import java.security.KeyStore
import java.security.cert.X509Certificate
import java.text.SimpleDateFormat
import java.util.Collections
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSession
import javax.net.ssl.TrustManager
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
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
 *  - getTlsInfo (M6, plan #42): TLS chain capture for display only
 *    (§16.7) — a custom X509TrustManager records the chain the server
 *    presents, then the connection is discarded. It NEVER validates
 *    anything else, and no global validation bypass exists anywhere.
 *  - localSubnet + discoverMdns (M7, plan #44/#45): the device's own IPv4
 *    subnet, and a best-effort NSD/mDNS browse used as a *second* source
 *    alongside the JS TCP sweep. The multicast lock is held only for the
 *    duration of the browse (see browseMdns).
 */
class NetopsModule : Module() {
  private val wifiPermissions = arrayOf(
    Manifest.permission.ACCESS_FINE_LOCATION,
    Manifest.permission.ACCESS_COARSE_LOCATION,
  )

  private companion object {
    const val TAG = "Netops"
    const val MULTICAST_LOCK_TAG = "netops-mdns"

    /**
     * Service types the mDNS browse listens for. There is no meta-query in
     * `NsdManager` (browsing `_services._dns-sd._udp` is not supported), so
     * the browse uses a curated list of the types that actually show up on a
     * home/office LAN. Anything not listed is still found by the TCP sweep
     * if it has one of the probed ports open.
     */
    val MDNS_SERVICE_TYPES = listOf(
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
    )
  }

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

    AsyncFunction("getTlsInfo") { host: String, port: Int, timeoutMs: Int, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        try {
          promise.resolve(captureTlsInfo(host, port, timeoutMs))
        } catch (e: Exception) {
          promise.resolve(mapOf("error" to (e.message ?: e.toString())))
        }
      }
    }

    AsyncFunction("localSubnet") { promise: Promise ->
      promise.resolve(readLocalSubnet())
    }

    AsyncFunction("discoverMdns") { windowMs: Int, promise: Promise ->
      CoroutineScope(Dispatchers.IO).launch {
        promise.resolve(browseMdns(windowMs))
      }
    }
  }

  /**
   * The device's own IPv4 subnet (M7): the LAN screen offers "scan my
   * network" without asking the user to type a CIDR. Only site-local
   * addresses qualify — a link-local 169.254/16 interface is not a network
   * worth sweeping, and loopback never is.
   */
  private fun readLocalSubnet(): Map<String, Any?>? {
    try {
      for (networkInterface in Collections.list(NetworkInterface.getNetworkInterfaces())) {
        if (!networkInterface.isUp || networkInterface.isLoopback) continue
        for (interfaceAddress in networkInterface.interfaceAddresses) {
          val address = interfaceAddress.address
          if (address is Inet4Address && address.isSiteLocalAddress) {
            return mapOf(
              "address" to address.hostAddress,
              "prefixLength" to interfaceAddress.networkPrefixLength.toInt(),
            )
          }
        }
      }
    } catch (e: Exception) {
      // No usable interface (no association, airplane mode) — null is the answer.
    }
    return null
  }

  /**
   * Best-effort mDNS browse (M7, plan D5 option b). Two rules shape this:
   *
   *  1. **The multicast lock lives only as long as the browse.** It is
   *     acquired immediately before the listeners start and released in the
   *     `finally`, so it is never held while the app sits idle (plan §9).
   *     Logcat lines bracket both halves so the lock's lifetime is
   *     verifiable on a device, not just by code review.
   *  2. **Failure is a value.** No NSD service, a denied multicast lock, or
   *     a listener that refuses to start all end the same way: an
   *     `available: false` result and an empty service list. The TCP sweep
   *     is unaffected (M7 acceptance: mDNS denied ⇒ sweep-only still works).
   *
   * Android 14 (API 34) fills `host`/`hostAddresses` during discovery, so no
   * `resolveService` round-trip is needed. On older releases those fields are
   * null, so entries without an address are dropped — a name we cannot place
   * on the network has nothing to contribute to a host list.
   */
  private suspend fun browseMdns(windowMs: Int): Map<String, Any?> {
    val context = appContext.reactContext
      ?: return mapOf("services" to emptyList<Any>(), "available" to false, "reason" to "no context")
    val nsd = context.getSystemService(Context.NSD_SERVICE) as? NsdManager
      ?: return mapOf("services" to emptyList<Any>(), "available" to false, "reason" to "NSD unavailable")

    val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
    val services = LinkedHashMap<String, Map<String, Any?>>()
    val listeners = mutableListOf<NsdManager.DiscoveryListener>()
    var lock: WifiManager.MulticastLock? = null
    var unavailableReason: String? = null

    try {
      lock = try {
        wifi?.createMulticastLock(MULTICAST_LOCK_TAG)?.apply {
          setReferenceCounted(false)
          acquire()
        }
      } catch (e: SecurityException) {
        // CHANGE_WIFI_MULTICAST_STATE missing or denied: browse without it.
        unavailableReason = "multicast lock not permitted"
        null
      }
      Log.i(TAG, "mDNS browse start (multicast lock ${if (lock != null) "acquired" else "unavailable"})")

      for (serviceType in MDNS_SERVICE_TYPES) {
        val listener = object : NsdManager.DiscoveryListener {
          override fun onStartDiscoveryFailed(type: String, errorCode: Int) {
            Log.i(TAG, "mDNS discovery failed for $type ($errorCode)")
          }

          override fun onStopDiscoveryFailed(type: String, errorCode: Int) {}

          override fun onDiscoveryStarted(type: String) {}

          override fun onDiscoveryStopped(type: String) {}

          override fun onServiceFound(info: NsdServiceInfo) {
            val entry = mapMdnsService(info) ?: return
            services[mdnsKey(entry)] = entry
          }

          override fun onServiceLost(info: NsdServiceInfo) {}
        }
        try {
          nsd.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, listener)
          listeners.add(listener)
        } catch (e: Exception) {
          // One type failing to start must not abort the others.
          Log.i(TAG, "mDNS browse skipped $serviceType: ${e.message}")
        }
      }

      delay(windowMs.toLong())
    } catch (e: Exception) {
      unavailableReason = e.message ?: e.toString()
    } finally {
      for (listener in listeners) {
        try {
          nsd.stopServiceDiscovery(listener)
        } catch (e: Exception) {
          // Already stopped or never started — nothing to do.
        }
      }
      if (lock?.isHeld == true) lock.release()
      Log.i(TAG, "mDNS browse end (multicast lock released)")
    }

    return mapOf(
      "services" to services.values.toList(),
      "available" to (unavailableReason == null),
      "reason" to unavailableReason,
    )
  }

  private fun mdnsKey(entry: Map<String, Any?>): String {
    val addresses = (entry["addresses"] as? List<*>)?.joinToString(",") ?: ""
    return "${entry["name"]}|$addresses|${entry["port"]}"
  }

  /**
   * Map one discovered service, or null when it carries no IPv4 address we
   * could merge into the host list (see browseMdns on API < 34).
   */
  private fun mapMdnsService(info: NsdServiceInfo): Map<String, Any?>? {
    val addresses = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      try {
        info.hostAddresses.filterIsInstance<Inet4Address>().mapNotNull { it.hostAddress }
      } catch (e: Exception) {
        emptyList()
      }
    } else {
      emptyList()
    }
    if (addresses.isEmpty()) return null
    val host = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      info.host?.hostName
    } else {
      null
    }
    return mapOf(
      "name" to (host ?: info.serviceName),
      "host" to host,
      "addresses" to addresses,
      "port" to info.port,
      "serviceType" to info.serviceType,
    )
  }

  /**
   * Capture-only TLS info for the inspector (plan #42, §16.7): the custom
   * trust manager RECORDS the presented chain and accepts the handshake so
   * the negotiated session can be read; the connection is closed
   * immediately after. This accept-or-record instance exists only inside
   * this method and is discarded with it — every other network call in the
   * app (DoH, exports, fetches) keeps full system validation.
   */
  private fun captureTlsInfo(host: String, port: Int, timeoutMs: Int): Map<String, Any?> {
    val captured = mutableListOf<X509Certificate>()

    // Chain-capturing trust manager: records whatever the server presents,
    // leaf first (checkServerTrusted receives it in presented order).
    val captureManager = object : X509TrustManager {
      override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
      override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        captured.addAll(chain)
      }
      override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
    }

    val sslContext = SSLContext.getInstance("TLS")
    sslContext.init(null, arrayOf<TrustManager>(captureManager), null)
    val factory = sslContext.socketFactory

    val socket = factory.createSocket() as javax.net.ssl.SSLSocket
    socket.soTimeout = timeoutMs
    socket.connect(InetSocketAddress(host, port), timeoutMs)
    val handshakeStart = System.currentTimeMillis()
    // SNI + hostname: the presented chain can depend on the name asked for.
    val sslParams = socket.sslParameters
    sslParams.endpointIdentificationAlgorithm = "HTTPS"
    socket.sslParameters = sslParams
    socket.startHandshake()
    val tlsMs = System.currentTimeMillis() - handshakeStart

    val session: SSLSession = socket.session
    val chain = session.peerCertificates.filterIsInstance<X509Certificate>()
    val certificates = (if (chain.isNotEmpty()) chain else captured).mapIndexed { index, cert ->
      mapOf(
        "subject" to cert.subjectX500Principal.name,
        "issuer" to cert.issuerX500Principal.name,
        "sans" to sansOf(cert),
        "notBefore" to isoUtc(cert.notBefore),
        "notAfter" to isoUtc(cert.notAfter),
        "serialNumber" to cert.serialNumber.toString(16),
        "signatureAlgorithm" to cert.sigAlgName,
        "keyInfo" to keyInfoOf(cert),
        "selfSigned" to (cert.subjectX500Principal == cert.issuerX500Principal),
        "position" to index,
      )
    }
    val result = mapOf(
      "host" to host,
      "port" to port,
      "chain" to certificates,
      "tlsVersion" to session.protocol,
      "cipherSuite" to session.cipherSuite,
      "handshakeMs" to tlsMs,
    )
    socket.close()
    return result
  }

  private fun sansOf(cert: X509Certificate): List<String> {
    return try {
      val sanExtension = cert.getSubjectAlternativeNames() ?: return emptyList()
      sanExtension.mapNotNull { entry ->
        // entry[0] is the type (2 = DNS); render DNS names only.
        if (entry.size >= 2 && entry[0] == 2) entry[1]?.toString() else null
      }
    } catch (e: Exception) {
      emptyList()
    }
  }

  private fun isoUtc(date: Date): String {
    val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
    format.timeZone = TimeZone.getTimeZone("UTC")
    return format.format(date)
  }

  private fun keyInfoOf(cert: X509Certificate): String {
    val publicKey = cert.publicKey
    val algorithm = publicKey.algorithm
    val bits = when (publicKey) {
      is java.security.interfaces.RSAPublicKey -> publicKey.modulus.bitLength()
      is java.security.interfaces.ECPublicKey -> publicKey.params.curve.field.fieldSize
      is java.security.interfaces.DSAPublicKey -> publicKey.params.p.bitLength()
      else -> publicKey.encoded?.size?.times(8) ?: 0
    }
    return "$algorithm $bits"
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
