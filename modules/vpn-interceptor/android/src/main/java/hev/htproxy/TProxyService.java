package hev.htproxy;

/**
 * JNI binding for the hev-socks5-tunnel native library (built from source via
 * ndk-build; see modules/vpn-interceptor/android/src/main/jni).
 *
 * src/hev-jni.c in that library registers its natives to this exact class and
 * package on load (JNI_OnLoad → FindClass("hev/htproxy/TProxyService") →
 * RegisterNatives). The package, class name and method signatures below must
 * match the library's defaults (PKGNAME=hev/htproxy, CLSNAME=TProxyService)
 * exactly, so do not rename them.
 */
public final class TProxyService {
  private TProxyService() {}

  static {
    System.loadLibrary("hev-socks5-tunnel");
  }

  /** Start the tunnel: reads YAML at config_path and takes ownership of fd. */
  public static native boolean TProxyStartService(String config_path, int fd);

  /** Stop the tunnel and release the tun fd. */
  public static native boolean TProxyStopService();

  /** Whether the tunnel is currently running. */
  public static native boolean TProxyIsRunning();

  /** [tx_packets, tx_bytes, rx_packets, rx_bytes]. */
  public static native long[] TProxyGetStats();
}
