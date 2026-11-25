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
 * aimed at the local [Socks5Server].
 *
 * DNS is answered by the engine itself (mapdns): each lookup gets a fake address
 * from a private pool, and when the app connects to it the engine sends the
 * original domain name in the SOCKS5 request. That is how the interceptor learns
 * hostnames without parsing DNS.
 */
class HevTunnelController(private val context: Context) : TunnelController {

  companion object {
    private const val TAG = "NetPulseTunnel"
    const val TUNNEL_MTU = 8500
    const val TUNNEL_ADDRESS = "198.18.0.1"
    const val DNS_ADDRESS = "198.18.0.2"
  }

  override val isEngineAvailable: Boolean
    get() = try {
      // Touching the class runs System.loadLibrary in its static initializer.
      Class.forName("hev.htproxy.TProxyService")
      true
    } catch (e: Throwable) {
      Log.w(TAG, "tun2socks engine not loadable: ${e.message}")
      false
    }

  override fun start(tunFd: ParcelFileDescriptor, socksPort: Int): Boolean {
    val config = File(context.cacheDir, "hev-tunnel.yml")
    config.writeText(buildConfig(socksPort))
    // The engine uses the fd but does not close it; the service closes the PFD.
    val started = try {
      TProxyService.TProxyStartService(config.absolutePath, tunFd.fd)
    } catch (e: Throwable) {
      Log.e(TAG, "tun2socks start failed", e)
      false
    }
    Log.i(TAG, "tun2socks started=$started socksPort=$socksPort")
    return started
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
      mtu: $TUNNEL_MTU
      ipv4: $TUNNEL_ADDRESS
    socks5:
      port: $socksPort
      address: 127.0.0.1
      udp: 'udp'
    mapdns:
      address: $DNS_ADDRESS
      port: 53
      network: 100.64.0.0
      netmask: 255.192.0.0
      cache-size: 10000
    misc:
      log-level: warn
    """.trimIndent()
}
