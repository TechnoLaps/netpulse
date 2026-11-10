package expo.modules.vpninterceptor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * NetPulseVpnService
 *
 * A local-only VpnService. It establishes a tun interface that captures IP
 * packets from the selected apps, then hands them to a userspace network stack
 * + local MITM proxy which reconstructs HTTP(S) transactions. Each completed
 * transaction is emitted to JS via the module's event emitter.
 *
 * This file is intentionally a working skeleton:
 *   - The VpnService lifecycle, per-app routing (addAllowedApplication), the tun
 *     fd and the foreground notification are fully wired.
 *   - The packet pump loop is stubbed with clear TODOs where a tun2socks bridge
 *     (e.g. hev-socks5-tunnel / badvpn) plus a local MITM proxy (e.g. an embedded
 *     mitmproxy/Little Proxy with a user-installed CA) are integrated.
 *
 * IMPORTANT: Decrypting HTTPS from third-party apps requires the user to install
 * and trust NetPulse's CA certificate, and apps that use certificate pinning
 * will refuse the MITM cert. This tool is intended for inspecting the user's own
 * device traffic for development and authorized security testing only.
 */
class NetPulseVpnService : VpnService() {

  companion object {
    private const val TAG = "NetPulseVpn"
    const val ACTION_START = "expo.modules.vpninterceptor.START"
    const val ACTION_STOP = "expo.modules.vpninterceptor.STOP"
    const val EXTRA_ALLOWED_PACKAGES = "allowedPackages"

    private const val NOTIF_CHANNEL = "netpulse_vpn"
    private const val NOTIF_ID = 0x4E50 // "NP"

    // Virtual addresses for the tun interface (RFC 5737 / private range).
    private const val TUN_ADDRESS = "10.1.10.1"
    private const val TUN_PREFIX = 32
    private const val TUN_ROUTE = "0.0.0.0"
    private const val TUN_MTU = 1500

    // The module registers a lambda here so the service can push events to JS.
    @Volatile
    private var emitter: ((String, Map<String, Any?>) -> Unit)? = null

    fun bindEmitter(fn: (String, Map<String, Any?>) -> Unit) {
      emitter = fn
    }

    private fun emit(event: String, body: Map<String, Any?>) {
      emitter?.invoke(event, body)
    }
  }

  private var tunInterface: ParcelFileDescriptor? = null
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private var captureJob: Job? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopCapture()
        return START_NOT_STICKY
      }
      ACTION_START -> {
        val allowed = intent.getStringArrayListExtra(EXTRA_ALLOWED_PACKAGES) ?: arrayListOf()
        startForegroundNotice()
        startCapture(allowed)
      }
    }
    return START_STICKY
  }

  private fun startCapture(allowedPackages: List<String>) {
    emit(VpnInterceptorModule.EVENT_STATUS, mapOf("state" to "preparing"))

    val builder = Builder()
      .setSession("NetPulse Inspector")
      .setMtu(TUN_MTU)
      .addAddress(TUN_ADDRESS, TUN_PREFIX)
      .addRoute(TUN_ROUTE, 0)
      // Keep DNS working through the tunnel.
      .addDnsServer("1.1.1.1")

    // -- Per-app filtering: only route the selected packages ------------------
    // addAllowedApplication() restricts the VPN to ONLY these apps. If none are
    // specified we fall back to capturing all apps except ourselves.
    if (allowedPackages.isNotEmpty()) {
      for (pkg in allowedPackages) {
        try {
          builder.addAllowedApplication(pkg)
        } catch (e: PackageManager.NameNotFoundException) {
          Log.w(TAG, "Package not installed, skipping: $pkg")
        }
      }
    } else {
      // Never capture our own traffic (avoid loops).
      try {
        builder.addDisallowedApplication(packageName)
      } catch (e: PackageManager.NameNotFoundException) {
        Log.w(TAG, "Could not exclude self", e)
      }
    }

    val tun = builder.establish()
    if (tun == null) {
      emit(
        VpnInterceptorModule.EVENT_STATUS,
        mapOf("state" to "error", "message" to "establish() returned null (consent missing?)")
      )
      stopSelf()
      return
    }
    tunInterface = tun
    emit(VpnInterceptorModule.EVENT_STATUS, mapOf("state" to "running"))

    captureJob = scope.launch {
      runPacketPump(tun)
    }
  }

  /**
   * The packet pump. Reads IP packets from the tun fd and feeds them to the
   * userspace stack + local proxy.
   *
   * TODO (real interception):
   *   1. Start a local SOCKS/HTTP proxy bound to 127.0.0.1:<port>.
   *   2. Bridge the tun fd to that proxy with a tun2socks implementation
   *      (hev-socks5-tunnel via JNI, or badvpn-tun2socks). protect() the proxy's
   *      upstream sockets so they bypass the VPN and reach the network.
   *   3. In the proxy, terminate TLS using a locally-generated CA that the user
   *      has installed + trusted, parse the HTTP request/response, then forward.
   *   4. For each completed transaction, build the TrafficEntry map below and
   *      call emitTransaction(entry).
   */
  private suspend fun runPacketPump(tun: ParcelFileDescriptor) {
    val input = java.io.FileInputStream(tun.fileDescriptor)
    val packet = ByteArray(TUN_MTU)
    try {
      while (scope.isActive) {
        val length = input.read(packet)
        if (length > 0) {
          // TODO: hand `packet[0 until length]` to tun2socks.
          // The demo build does not forward packets; it relies on the JS-side
          // Simulation Mode to populate the UI. See class doc.
        }
      }
    } catch (e: Exception) {
      Log.e(TAG, "Packet pump stopped", e)
    } finally {
      input.close()
    }
  }

  /**
   * Helper the proxy layer calls once it has reconstructed a full HTTP
   * transaction. Shapes the payload to match the JS `TrafficEntry` type.
   */
  @Suppress("unused")
  fun emitTransaction(
    id: String,
    startedAt: Long,
    durationMs: Long,
    sourceApp: String,
    sourceAppLabel: String,
    scheme: String,
    host: String,
    path: String,
    method: String,
    url: String,
    requestHeaders: List<Pair<String, String>>,
    requestBody: String,
    responseStatus: Int,
    responseStatusText: String,
    responseHeaders: List<Pair<String, String>>,
    responseBody: String,
    tlsDecrypted: Boolean
  ) {
    fun headers(list: List<Pair<String, String>>) =
      list.map { mapOf("name" to it.first, "value" to it.second) }

    fun body(text: String, mime: String) = mapOf(
      "kind" to if (mime.contains("json")) "json" else "text",
      "text" to text,
      "mimeType" to mime,
      "sizeBytes" to text.toByteArray().size
    )

    val entry = mapOf(
      "id" to id,
      "startedAt" to startedAt,
      "durationMs" to durationMs,
      "sourceApp" to sourceApp,
      "sourceAppLabel" to sourceAppLabel,
      "host" to host,
      "path" to path,
      "scheme" to scheme,
      "tlsDecrypted" to tlsDecrypted,
      "request" to mapOf(
        "method" to method,
        "url" to url,
        "headers" to headers(requestHeaders),
        "queryParams" to emptyList<Any>(),
        "body" to body(requestBody, "application/json")
      ),
      "response" to mapOf(
        "statusCode" to responseStatus,
        "statusText" to responseStatusText,
        "headers" to headers(responseHeaders),
        "body" to body(responseBody, "application/json")
      )
    )
    emit(VpnInterceptorModule.EVENT_TRANSACTION, mapOf("payload" to entry))
  }

  private fun stopCapture() {
    captureJob?.cancel()
    captureJob = null
    try {
      tunInterface?.close()
    } catch (_: Exception) {
    }
    tunInterface = null
    emit(VpnInterceptorModule.EVENT_STATUS, mapOf("state" to "stopped"))
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun startForegroundNotice() {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        NOTIF_CHANNEL,
        "NetPulse capture",
        NotificationManager.IMPORTANCE_LOW
      )
      manager.createNotificationChannel(channel)
    }
    val notification: Notification = Notification.Builder(this, NOTIF_CHANNEL)
      .setContentTitle("NetPulse Inspector")
      .setContentText("Capturing API traffic from selected apps")
      .setSmallIcon(android.R.drawable.ic_menu_view)
      .setOngoing(true)
      .build()
    startForeground(NOTIF_ID, notification)
  }

  override fun onDestroy() {
    scope.cancel()
    super.onDestroy()
  }

  override fun onRevoke() {
    // User revoked VPN permission from system settings.
    stopCapture()
    super.onRevoke()
  }
}
