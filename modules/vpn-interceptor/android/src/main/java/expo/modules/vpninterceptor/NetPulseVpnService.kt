package expo.modules.vpninterceptor

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ProxyInfo
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import java.net.Socket

/**
 * NetPulseVpnService
 *
 * Scopes capture to the selected apps (addAllowedApplication) and runs one of
 * two capture modes:
 *
 *  - TUNNEL (preferred; Android 10+ with the tun2socks engine bundled):
 *    all traffic from the selected apps is routed into the tun device. The
 *    engine turns it into SOCKS5 connections for [Socks5Server], which hands
 *    them to [MitmProxyServer]. Captures apps that ignore the system proxy.
 *
 *  - PROXY (fallback): only a tiny unused subnet is routed and the apps'
 *    system HTTP proxy is pointed at [MitmProxyServer] (API 29+ setHttpProxy).
 *    Captures only apps that honor the system proxy.
 *
 * In both modes upstream sockets are protect()ed so they bypass the tunnel, and
 * our own app is excluded to avoid loops. TLS is decrypted with the user-installed
 * root CA; hosts that reject it (certificate pinning) are relayed untouched.
 */
class NetPulseVpnService : VpnService() {

  companion object {
    private const val TAG = "NetPulseVpn"
    const val ACTION_START = "expo.modules.vpninterceptor.START"
    const val ACTION_STOP = "expo.modules.vpninterceptor.STOP"
    const val EXTRA_ALLOWED_PACKAGES = "allowedPackages"
    const val EXTRA_ALLOWED_LABELS = "allowedLabels"

    private const val NOTIF_CHANNEL = "netpulse_vpn"
    private const val NOTIF_ID = 0x4E50

    // Proxy-mode tunnel: an unused subnet, so normal connectivity is untouched.
    private const val PROXY_ADDRESS = "10.1.10.1"
    private const val PROXY_ROUTE = "10.1.10.0"
    private const val PROXY_PREFIX = 24
    private const val PROXY_MTU = 1500

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
  private var proxy: MitmProxyServer? = null
  private var socks: Socks5Server? = null
  private var ca: CertificateAuthority? = null
  private var tunnelActive = false
  private var allowedPackages: List<String> = emptyList()
  private var allowedLabels: List<String> = emptyList()

  private val tunnelController: TunnelController by lazy { HevTunnelController(applicationContext) }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopCapture()
        return START_NOT_STICKY
      }
      ACTION_START -> {
        allowedPackages = intent.getStringArrayListExtra(EXTRA_ALLOWED_PACKAGES) ?: arrayListOf()
        allowedLabels = intent.getStringArrayListExtra(EXTRA_ALLOWED_LABELS) ?: arrayListOf()
        startForegroundNotice()
        startCapture()
      }
    }
    return START_STICKY
  }

  private fun startCapture() {
    emit(VpnInterceptorModule.EVENT_STATUS, mapOf("state" to "preparing"))
    try {
      val authority = CertificateAuthority(applicationContext)
      ca = authority

      val server = MitmProxyServer(
        ca = authority,
        protect = { socket: Socket -> this.protect(socket) },
        attribution = { attribution() },
        onTransaction = { entry ->
          emit(VpnInterceptorModule.EVENT_TRANSACTION, mapOf("payload" to entry))
        },
      )
      val proxyPort = server.start()
      proxy = server

      val atLeastQ = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
      val tunnelMode = atLeastQ && tunnelController.isEngineAvailable

      val builder = Builder().setSession("NetPulse Inspector")
      var socksPort = 0

      if (tunnelMode) {
        val socksServer = Socks5Server(server)
        socksPort = socksServer.start()
        socks = socksServer

        builder
          .setMtu(HevTunnelController.TUNNEL_MTU)
          .addAddress(HevTunnelController.TUNNEL_ADDRESS, 32)
          .addRoute("0.0.0.0", 0)
          // DNS is answered by the engine (mapdns) so hostnames reach the SOCKS layer.
          .addDnsServer(HevTunnelController.DNS_ADDRESS)
      } else {
        builder
          .setMtu(PROXY_MTU)
          .addAddress(PROXY_ADDRESS, PROXY_PREFIX)
          .addRoute(PROXY_ROUTE, PROXY_PREFIX)
        if (atLeastQ) {
          builder.setHttpProxy(ProxyInfo.buildDirectProxy("127.0.0.1", proxyPort))
        } else {
          emit(
            VpnInterceptorModule.EVENT_STATUS,
            mapOf("state" to "error", "message" to "Requires Android 10+ (system HTTP proxy)")
          )
        }
      }

      applyAppFilter(builder)

      val tun = builder.establish()
      if (tun == null) {
        emit(
          VpnInterceptorModule.EVENT_STATUS,
          mapOf("state" to "error", "message" to "establish() returned null (consent missing?)")
        )
        stopCapture()
        return
      }
      tunInterface = tun

      if (tunnelMode) {
        if (!tunnelController.start(tun, socksPort)) {
          emit(
            VpnInterceptorModule.EVENT_STATUS,
            mapOf("state" to "error", "message" to "tun2socks engine failed to start")
          )
          stopCapture()
          return
        }
        tunnelActive = true
      }

      emit(
        VpnInterceptorModule.EVENT_STATUS,
        mapOf(
          "state" to "running",
          "mode" to if (tunnelMode) "tunnel" else "proxy",
          "proxyPort" to proxyPort,
        )
      )
    } catch (e: Exception) {
      Log.e(TAG, "startCapture failed", e)
      emit(
        VpnInterceptorModule.EVENT_STATUS,
        mapOf("state" to "error", "message" to (e.message ?: "unknown error"))
      )
      stopCapture()
    }
  }

  private fun applyAppFilter(builder: Builder) {
    if (allowedPackages.isNotEmpty()) {
      for (pkg in allowedPackages) {
        try {
          builder.addAllowedApplication(pkg)
        } catch (e: PackageManager.NameNotFoundException) {
          Log.w(TAG, "Package not installed, skipping: $pkg")
        }
      }
    }
    // Never route our own app through the tunnel (avoid loops).
    try {
      builder.addDisallowedApplication(packageName)
    } catch (e: PackageManager.NameNotFoundException) {
      Log.w(TAG, "Could not exclude self", e)
    }
  }

  /** Attribute captured traffic to the single selected app, or a generic label. */
  private fun attribution(): Pair<String, String> {
    return if (allowedPackages.size == 1) {
      allowedPackages[0] to (allowedLabels.firstOrNull() ?: allowedPackages[0])
    } else {
      "multiple" to "Selected apps"
    }
  }

  private fun stopCapture() {
    if (tunnelActive) {
      tunnelController.stop()
      tunnelActive = false
    }
    try {
      tunInterface?.close()
    } catch (_: Exception) {
    }
    tunInterface = null
    try {
      socks?.stop()
    } catch (_: Exception) {
    }
    socks = null
    try {
      proxy?.stop()
    } catch (_: Exception) {
    }
    proxy = null
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

  override fun onRevoke() {
    stopCapture()
    super.onRevoke()
  }

  override fun onDestroy() {
    if (tunnelActive) {
      tunnelController.stop()
      tunnelActive = false
    }
    try {
      socks?.stop()
    } catch (_: Exception) {
    }
    try {
      proxy?.stop()
    } catch (_: Exception) {
    }
    super.onDestroy()
  }
}
