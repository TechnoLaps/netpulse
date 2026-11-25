package expo.modules.vpninterceptor

import android.util.Log
import java.io.EOFException
import java.io.InputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors

/**
 * Socks5Server
 *
 * Minimal loopback SOCKS5 server (CONNECT only, no auth). The tun2socks engine
 * connects here for every TCP flow it reconstructs from the tun device; after the
 * handshake each connection is handed to [MitmProxyServer.handleTunneled], which
 * sniffs the protocol and intercepts HTTP/HTTPS (or relays anything else).
 *
 * UDP ASSOCIATE is refused, so QUIC and other UDP simply fail and apps fall back
 * to TCP. DNS never reaches this server: the engine answers it itself (mapdns).
 */
class Socks5Server(private val mitm: MitmProxyServer) {

  companion object {
    private const val TAG = "NetPulseSocks"
    private const val HANDSHAKE_TIMEOUT_MS = 15_000
  }

  private val executor = Executors.newCachedThreadPool()
  private var serverSocket: ServerSocket? = null

  @Volatile
  private var running = false

  /** Binds to an ephemeral loopback port and starts accepting. Returns the port. */
  fun start(): Int {
    val socket = ServerSocket()
    socket.reuseAddress = true
    socket.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
    serverSocket = socket
    running = true
    executor.submit { acceptLoop(socket) }
    Log.i(TAG, "SOCKS5 listening on 127.0.0.1:${socket.localPort}")
    return socket.localPort
  }

  fun stop() {
    running = false
    try {
      serverSocket?.close()
    } catch (_: Exception) {
    }
    executor.shutdownNow()
  }

  private fun acceptLoop(socket: ServerSocket) {
    while (running) {
      val client = try {
        socket.accept()
      } catch (e: Exception) {
        if (running) Log.w(TAG, "accept failed", e)
        break
      }
      executor.submit { handle(client) }
    }
  }

  private fun handle(client: Socket) {
    try {
      client.soTimeout = HANDSHAKE_TIMEOUT_MS
      val input = client.getInputStream()
      val output = client.getOutputStream()

      // Greeting: VER, NMETHODS, METHODS... -> select "no authentication".
      if (input.read() != 5) return
      val methodCount = input.read()
      if (methodCount < 0) return
      readFully(input, methodCount)
      output.write(byteArrayOf(5, 0))
      output.flush()

      // Request: VER, CMD, RSV, ATYP, DST.ADDR, DST.PORT
      val header = readFully(input, 4)
      if (header[0].toInt() != 5) return
      val command = header[1].toInt()
      val host: String = when (header[3].toInt()) {
        1 -> InetAddress.getByAddress(readFully(input, 4)).hostAddress ?: return
        3 -> {
          val length = input.read()
          if (length < 0) return
          String(readFully(input, length), Charsets.US_ASCII)
        }
        4 -> InetAddress.getByAddress(readFully(input, 16)).hostAddress ?: return
        else -> {
          reply(output, 8) // address type not supported
          return
        }
      }
      val portBytes = readFully(input, 2)
      val port = ((portBytes[0].toInt() and 0xff) shl 8) or (portBytes[1].toInt() and 0xff)

      if (command != 1) {
        reply(output, 7) // command not supported (UDP ASSOCIATE / BIND)
        return
      }
      reply(output, 0)
      mitm.handleTunneled(client, host, port)
    } catch (e: Exception) {
      Log.d(TAG, "connection ended: ${e.message}")
    } finally {
      try {
        client.close()
      } catch (_: Exception) {
      }
    }
  }

  private fun reply(output: java.io.OutputStream, code: Int) {
    output.write(byteArrayOf(5, code.toByte(), 0, 1, 0, 0, 0, 0, 0, 0))
    output.flush()
  }

  private fun readFully(input: InputStream, length: Int): ByteArray {
    val buffer = ByteArray(length)
    var read = 0
    while (read < length) {
      val n = input.read(buffer, read, length - read)
      if (n < 0) throw EOFException()
      read += n
    }
    return buffer
  }
}
