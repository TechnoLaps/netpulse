package expo.modules.vpninterceptor

import android.os.ParcelFileDescriptor
import android.util.Log

/**
 * TunnelController
 *
 * Seam between the VpnService and the native tun2socks engine.
 *
 *   tun fd  ──►  [tun2socks engine]  ──►  127.0.0.1:socksPort (Socks5Server)
 *                                                │
 *                                                ▼
 *                                        MitmProxyServer.handleTunneled
 *
 * [HevTunnelController] is the real implementation (hev-socks5-tunnel, built
 * from source with ndk-build). When the engine library is not bundled, the
 * service falls back to proxy-only capture and [NoopTunnelController] applies.
 */
interface TunnelController {
  /** True when a real native tun2socks engine is bundled and loadable. */
  val isEngineAvailable: Boolean

  /**
   * Begin converting packets from [tunFd] into SOCKS5 connections to
   * 127.0.0.1:[socksPort]. Returns false if the engine failed to start. The
   * caller keeps ownership of [tunFd] and closes it after [stop].
   */
  fun start(tunFd: ParcelFileDescriptor, socksPort: Int): Boolean

  /** Stop the engine. */
  fun stop()
}

/** Default: no native engine bundled. The service falls back to proxy mode. */
object NoopTunnelController : TunnelController {
  private const val TAG = "NetPulseTunnel"
  override val isEngineAvailable: Boolean = false

  override fun start(tunFd: ParcelFileDescriptor, socksPort: Int): Boolean {
    Log.i(TAG, "tun2socks engine not bundled; using setHttpProxy capture instead.")
    return false
  }

  override fun stop() {}
}
