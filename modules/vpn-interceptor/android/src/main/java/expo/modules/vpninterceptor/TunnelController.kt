package expo.modules.vpninterceptor

import android.os.ParcelFileDescriptor
import android.util.Log

/**
 * TunnelController
 *
 * Integration seam for transparent capture (tun2socks mode).
 *
 * The current capture path (NetPulseVpnService.setHttpProxy) only reaches apps
 * that honor the system HTTP proxy. To also capture proxy-ignoring apps, the VPN
 * must route all TCP through a userspace network stack that converts the tun
 * device's IP packets into SOCKS connections, which a local SOCKS5 server then
 * hands to the MITM logic.
 *
 * That userspace stack is a native (C) engine — e.g. hev-socks5-tunnel or
 * badvpn-tun2socks — bundled as a prebuilt .so or built from source via the NDK.
 * Sourcing it is a deliberate choice (binary trust, licensing, CI build time),
 * so the engine is NOT wired in yet. An implementation plugs in behind this
 * interface:
 *
 *   tun fd  ──►  [native tun2socks engine]  ──►  127.0.0.1:socksPort (SOCKS5)
 *                                                      │
 *                                                      ▼
 *                                              local SOCKS5 server
 *                                                      │
 *                                                      ▼
 *                                              MitmProxyServer logic
 *
 * Until an engine is provided, [NoopTunnelController] is used and the service
 * stays on the setHttpProxy path.
 */
interface TunnelController {
  /** True when a real native tun2socks engine is bundled and usable. */
  val isEngineAvailable: Boolean

  /**
   * Begin converting packets from [tunFd] into SOCKS5 connections targeting
   * 127.0.0.1:[socksPort]. The implementation owns the engine lifecycle.
   */
  fun start(tunFd: ParcelFileDescriptor, socksPort: Int)

  /** Stop the engine and release the tun fd handling. */
  fun stop()
}

/** Default: no native engine bundled. The service falls back to proxy mode. */
object NoopTunnelController : TunnelController {
  private const val TAG = "NetPulseTunnel"
  override val isEngineAvailable: Boolean = false

  override fun start(tunFd: ParcelFileDescriptor, socksPort: Int) {
    Log.i(TAG, "tun2socks engine not bundled; using setHttpProxy capture instead.")
  }

  override fun stop() {}
}
