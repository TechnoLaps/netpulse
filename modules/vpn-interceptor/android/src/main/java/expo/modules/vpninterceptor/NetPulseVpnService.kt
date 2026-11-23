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
 * A local-only VpnService used purely to (1) scope capture to the selected apps
 * via addAllowedApplication and (2) point those apps' system HTTP proxy at the
 * in-process [MitmProxyServer] on 127.0.0.1 (API 29+ setHttpProxy).
 *
 * The proxy terminates HTTP and (with the user-installed root CA) HTTPS, parses
 * each transaction and emits it to JS. Upstream sockets are protect()ed so they
 * bypass the tunnel. We deliberately route only a tiny unused subnet so that
 * non-proxied traffic (UDP, proxy-ignoring apps) keeps flowing normally and the
 * device's connectivity is never black-holed.
 *
 * Limitations (surfaced in the UI): only apps that honor the system proxy are
 * captured; certificate-pinned connections will fail the MITM; HTTP/2 is
 * downgraded to HTTP/1.1. Transparent capture of pinned/proxy-ignoring apps
 * requires a userspace TCP/IP stack (tun2socks), which is out of scope here.
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

    private const val TUN_ADDRESS = "10.1.10.1"
    private const val TUN_ROUTE = "10.1.10.0" // unused subnet; keeps connectivity intact
    private const val TUN_PREFIX = 24
    private const val TUN_MTU = 1500

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
  private var ca: CertificateAuthority? = null
  private var allowedPackages: List<String> = emptyList()
  private var allowedLabels: List<String> = emptyList()

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
      val port = server.start()
      proxy = server

      val builder = Builder()
        .setSession("NetPulse Inspector")
        .setMtu(TUN_MTU)
        .addAddress(TUN_ADDRESS, TUN_PREFIX)
        .addRoute(TUN_ROUTE, TUN_PREFIX)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        builder.setHttpProxy(ProxyInfo.buildDirectProxy("127.0.0.1", port))
      } else {
        emit(
          VpnInterceptorModule.EVENT_STATUS,
          mapOf("state" to "error", "message" to "Requires Android 10+ (system HTTP proxy)")
        )
      }

      applyAppFilter(builder)

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
      emit(VpnInterceptorModule.EVENT_STATUS, mapOf("state" to "running", "proxyPort" to port))
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
    try {
      proxy?.stop()
    } catch (_: Exception) {
    }
    proxy = null
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

  override fun onRevoke() {
    stopCapture()
    super.onRevoke()
  }

  override fun onDestroy() {
    try {
      proxy?.stop()
    } catch (_: Exception) {
    }
    super.onDestroy()
  }
}
