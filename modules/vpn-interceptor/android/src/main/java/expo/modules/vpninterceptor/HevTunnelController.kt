package expo.modules.vpninterceptor

import android.content.Context
import android.os.ParcelFileDescriptor
import android.util.Log
import hev.htproxy.TProxyService
import java.io.File

/**
 * HevTunnelController
 *
 * TunnelController backed by the hev-socks5-tunnel native engine (ndk-build from
 * source). It converts the VPN tun device's IP packets into SOCKS5 connections
 * aimed at a local SOCKS5 server on 127.0.0.1:[socksPort], which the MITM layer
 * then terminates.
 *
 * The engine runs on its own native thread; TProxyStartService returns once it
 * is up. The YAML config points it at the local SOCKS5 server.
 */
class HevTunnelController(private val context: Context) : TunnelController {

  companion object {
    private const val TAG = "NetPulseTunnel"
  }

  override val isEngineAvailable: Boolean
    get() = try {
      // Touching the class triggers System.loadLibrary in its static init.
      Class.forName("hev.htproxy.TProxyService")
      true
    } catch (e: Throwable) {
      Log.w(TAG, "tun2socks engine not loadable: ${e.message}")
      false
    }

  override fun start(tunFd: ParcelFileDescriptor, socksPort: Int) {
    val cfg = File(context.cacheDir, "hev-tunnel.yml")
    cfg.writeText(buildConfig(socksPort))
    // hev takes ownership of the fd; detach so the PFD doesn't close it.
    val fd = tunFd.detachFd()
    val ok = TProxyService.TProxyStartService(cfg.absolutePath, fd)
    Log.i(TAG, "tun2socks started=$ok socksPort=$socksPort")
  }

  override fun stop() {
    try {
      TProxyService.TProxyStopService()
    } catch (e: Throwable) {
      Log.w(TAG, "tun2socks stop failed: ${e.message}")
    }
  }

  private fun buildConfig(socksPort: Int): String =
    """
    tunnel:
      mtu: 8500
      ipv4: 198.18.0.1
    socks5:
      port: $socksPort
      address: 127.0.0.1
      udp: 'udp'
    misc:
      log-level: warn
    """.trimIndent()
}
