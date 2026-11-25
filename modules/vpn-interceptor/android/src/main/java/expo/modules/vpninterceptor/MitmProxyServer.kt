package expo.modules.vpninterceptor

import android.util.Log
import java.io.BufferedInputStream
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.io.PushbackInputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLException
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * MitmProxyServer
 *
 * Intercepts HTTP/HTTPS and emits each transaction to JS. Connections reach it
 * two ways:
 *
 *  1. As a classic HTTP proxy on 127.0.0.1 (apps that honor the system proxy;
 *     plain requests with absolute URIs and CONNECT tunnels).
 *  2. Via [handleTunneled], called by [Socks5Server] for every TCP flow the
 *     tun2socks engine reconstructs (transparent capture). The first byte is
 *     sniffed to tell TLS, HTTP and anything else apart.
 *
 * HTTPS is intercepted with a per-host leaf certificate from [ca]; the client
 * must trust the NetPulse root CA. Only HTTP/1.1 is offered (no ALPN h2).
 *
 * Certificate pinning: when a client rejects our certificate the handshake
 * fails; that host is then remembered in [bypassHosts] and relayed untouched, so
 * the app keeps working (its traffic simply is not decrypted).
 */
class MitmProxyServer(
  private val ca: CertificateAuthority,
  private val protect: (Socket) -> Unit,
  private val attribution: () -> Pair<String, String>,
  private val onTransaction: (Map<String, Any?>) -> Unit,
) {
  companion object {
    private const val TAG = "NetPulseProxy"
    private const val SOCKET_TIMEOUT_MS = 30_000
    private const val FIRST_BYTE_TIMEOUT_MS = 3_000
    private const val MAX_TLS_RECORD = 16_384 + 2_048
  }

  private val executor = Executors.newCachedThreadPool()
  private val idSeq = AtomicLong(0)
  private var serverSocket: ServerSocket? = null

  @Volatile
  private var running = false

  /** Hosts whose TLS handshake with our CA failed (likely pinned): relay only. */
  private val bypassHosts = ConcurrentHashMap.newKeySet<String>()

  // Trust-all upstream context (inspection tool; we are the client here).
  private val upstreamFactory: SSLSocketFactory by lazy {
    val ctx = SSLContext.getInstance("TLS")
    ctx.init(null, arrayOf<TrustManager>(TrustAll), java.security.SecureRandom())
    ctx.socketFactory
  }

  /** Binds to an ephemeral loopback port and starts accepting. Returns the port. */
  fun start(): Int {
    val socket = ServerSocket()
    socket.reuseAddress = true
    socket.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0))
    serverSocket = socket
    running = true
    executor.submit { acceptLoop(socket) }
    Log.i(TAG, "MITM proxy listening on 127.0.0.1:${socket.localPort}")
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
      executor.submit { handleClient(client) }
    }
  }

  private fun handleClient(client: Socket) {
    try {
      client.soTimeout = SOCKET_TIMEOUT_MS
      val input = BufferedInputStream(client.getInputStream())
      val first = HttpIo.readMessage(input, isRequest = true) ?: return
      val method = first.startLine.substringBefore(' ').uppercase()
      if (method == "CONNECT") {
        handleConnect(client, first)
      } else {
        handlePlainHttp(client, input, first)
      }
    } catch (e: Exception) {
      Log.d(TAG, "client error: ${e.message}")
    } finally {
      try {
        client.close()
      } catch (_: Exception) {
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Transparent (tun2socks) connections
  // ---------------------------------------------------------------------------

  /**
   * Handles one TCP flow delivered by [Socks5Server] after its handshake.
   * [host] is the SOCKS destination: a domain name (mapdns) or an IP literal.
   * The caller closes [client] when this returns.
   */
  fun handleTunneled(client: Socket, host: String, port: Int) {
    val raw = client.getInputStream()

    // Classify by the first client byte. Server-first protocols never send one,
    // so a short timeout falls through to a plain relay.
    client.soTimeout = FIRST_BYTE_TIMEOUT_MS
    val first = try {
      raw.read()
    } catch (_: SocketTimeoutException) {
      NO_BYTE
    }
    client.soTimeout = SOCKET_TIMEOUT_MS
    if (first == -1) return

    val firstBytes = if (first >= 0) byteArrayOf(first.toByte()) else null
    if (first == NO_BYTE || bypassHosts.contains(host)) {
      relay(client, raw, host, port, firstBytes)
      return
    }

    when {
      first == 0x16 -> {
        val record = readTlsRecord(raw, first)
        val certHost = TlsSni.parse(record) ?: host
        val tls = acceptTls(client, host, certHost, port, record) ?: return
        serveTls(tls, host, certHost, port)
      }
      isHttpStart(first) -> {
        val pushback = PushbackInputStream(raw, 1)
        pushback.unread(first)
        val input = BufferedInputStream(pushback, 16_384)
        val message = HttpIo.readMessage(input, isRequest = true) ?: return
        handlePlainHttp(client, input, message, host to port)
      }
      else -> relay(client, raw, host, port, firstBytes)
    }
  }

  private fun isHttpStart(b: Int): Boolean =
    b == 'G'.code || b == 'P'.code || b == 'H'.code || b == 'D'.code ||
      b == 'O'.code || b == 'T'.code || b == 'C'.code

  private fun readTlsRecord(input: InputStream, firstByte: Int): ByteArray {
    val header = ByteArray(5)
    header[0] = firstByte.toByte()
    readFully(input, header, 1, 4)
    val length = ((header[3].toInt() and 0xff) shl 8) or (header[4].toInt() and 0xff)
    if (length <= 0 || length > MAX_TLS_RECORD) throw IOException("bad TLS record length $length")
    val record = ByteArray(5 + length)
    System.arraycopy(header, 0, record, 0, 5)
    readFully(input, record, 5, length)
    return record
  }

  private fun readFully(input: InputStream, buffer: ByteArray, offset: Int, length: Int) {
    var read = 0
    while (read < length) {
      val n = input.read(buffer, offset + read, length - read)
      if (n < 0) throw EOFException()
      read += n
    }
  }

  /** Copies bytes both ways between the client and an upstream host, untouched. */
  private fun relay(client: Socket, clientIn: InputStream, host: String, port: Int, firstBytes: ByteArray?) {
    val upstream = openUpstream(host, port, tls = false)
    upstream.soTimeout = 0
    client.soTimeout = 0
    try {
      val upstreamOut = upstream.getOutputStream()
      if (firstBytes != null) {
        upstreamOut.write(firstBytes)
        upstreamOut.flush()
      }
      executor.submit {
        pump(clientIn, upstreamOut)
        try {
          upstream.shutdownOutput()
        } catch (_: Exception) {
        }
      }
      pump(upstream.getInputStream(), client.getOutputStream())
    } finally {
      upstream.closeQuietly()
    }
  }

  private fun pump(input: InputStream, output: OutputStream) {
    val buffer = ByteArray(16_384)
    try {
      while (true) {
        val n = input.read(buffer)
        if (n < 0) break
        output.write(buffer, 0, n)
        output.flush()
      }
    } catch (_: Exception) {
      // Peer closed or the session was torn down.
    }
  }

  // ---------------------------------------------------------------------------
  // Plain HTTP
  // ---------------------------------------------------------------------------

  /**
   * [fixedDest] is set for transparent connections, where the request target is
   * origin-form and the real destination comes from the SOCKS request.
   */
  private fun handlePlainHttp(
    client: Socket,
    input: InputStream,
    first: HttpIo.Message,
    fixedDest: Pair<String, Int>? = null,
  ) {
    var request: HttpIo.Message = first
    val out = client.getOutputStream()
    var upstream: Socket? = null
    var upIn: InputStream? = null
    var upOut: OutputStream? = null
    var currentHostPort: String? = null

    try {
      while (true) {
        val (method, target, version) = parseRequestLine(request.startLine)
        val url = absoluteUrl(target, request.header("Host") ?: fixedDest?.first, "http")
        val hostPort = fixedDest ?: hostPortOf(url, 80)
        val host = hostPort.first
        val port = hostPort.second

        if (currentHostPort != "$host:$port" || upstream == null) {
          upstream?.closeQuietly()
          upstream = openUpstream(host, port, tls = false)
          upIn = BufferedInputStream(upstream.getInputStream())
          upOut = upstream.getOutputStream()
          currentHostPort = "$host:$port"
        }

        // Rewrite absolute target to origin form for the upstream.
        val originTarget = toOriginForm(target)
        val forward = request.copy(startLine = "$method $originTarget $version")
        val started = System.currentTimeMillis()
        HttpIo.writeMessage(upOut!!, forward, asForwardRequest = true)

        val response = HttpIo.readMessage(upIn!!, isRequest = false)
        if (response == null) {
          upstream.closeQuietly()
          upstream = null
          break
        }
        HttpIo.writeMessage(out, response, asForwardRequest = false)
        emit(
          scheme = "http", host = host, port = port, version = version,
          request = request, response = response, startedAt = started
        )

        val keepClient = HttpIo.isKeepAlive(request, version) &&
          HttpIo.isKeepAlive(response, response.startLine.substringBefore(' '))
        if (!keepClient) break
        request = HttpIo.readMessage(input, isRequest = true) ?: break
      }
    } finally {
      upstream?.closeQuietly()
    }
  }

  // ---------------------------------------------------------------------------
  // HTTPS via CONNECT (system-proxy path)
  // ---------------------------------------------------------------------------

  private fun handleConnect(client: Socket, connect: HttpIo.Message) {
    val hostPort = connect.startLine.split(" ").getOrNull(1) ?: return
    val host = hostPort.substringBefore(':')
    val port = hostPort.substringAfter(':', "443").toIntOrNull() ?: 443

    // Tell the client the tunnel is open, then start TLS as the "server".
    client.getOutputStream().apply {
      write("HTTP/1.1 200 Connection Established\r\n\r\n".toByteArray())
      flush()
    }

    if (bypassHosts.contains(host)) {
      relay(client, client.getInputStream(), host, port, null)
      return
    }
    val tls = acceptTls(client, host, host, port, null) ?: return
    serveTls(tls, host, host, port)
  }

  /**
   * Performs the server side of the TLS handshake with the client using a leaf
   * certificate for [certHost]. [consumed] holds bytes already read from the
   * socket (the ClientHello when sniffed in tunnel mode). Returns null when the
   * client rejects our certificate, after marking the host for bypass.
   */
  private fun acceptTls(
    client: Socket,
    bypassKey: String,
    certHost: String,
    port: Int,
    consumed: ByteArray?,
  ): SSLSocket? {
    val factory = ca.serverSslContext(certHost).socketFactory
    // Android has no public API to feed already-read bytes into a TLS server
    // socket, so when the ClientHello was sniffed we run TLS over a loopback pipe
    // that replays those bytes first.
    val source: Socket = if (consumed != null) pipeWithPrefix(client, consumed) else client
    val tls = factory.createSocket(source, certHost, port, true) as SSLSocket
    tls.useClientMode = false
    return try {
      tls.startHandshake()
      tls
    } catch (e: SSLException) {
      Log.i(TAG, "TLS handshake rejected for $certHost (${e.message}); relaying this host untouched from now on")
      bypassHosts.add(bypassKey)
      bypassHosts.add(certHost)
      try {
        tls.close()
      } catch (_: Exception) {
      }
      null
    }
  }

  /**
   * Returns a loopback socket whose input starts with [prefix] and then carries
   * everything [client] sends; bytes written to it go back to [client]. The pumps
   * end when either side closes.
   */
  private fun pipeWithPrefix(client: Socket, prefix: ByteArray): Socket {
    val loopback = InetAddress.getByName("127.0.0.1")
    ServerSocket(0, 1, loopback).use { listener ->
      val near = Socket(loopback, listener.localPort)
      val far = listener.accept()
      executor.submit {
        try {
          val out = near.getOutputStream()
          out.write(prefix)
          out.flush()
        } catch (_: Exception) {
        }
        pump(client.getInputStream(), near.getOutputStream())
        try {
          near.shutdownOutput()
        } catch (_: Exception) {
        }
      }
      executor.submit {
        pump(near.getInputStream(), client.getOutputStream())
        try {
          near.close()
        } catch (_: Exception) {
        }
      }
      return far
    }
  }

  private fun serveTls(tls: SSLSocket, connectHost: String, sniHost: String, port: Int) {
    val clientIn = BufferedInputStream(tls.inputStream)
    val clientOut = tls.outputStream

    var upstream: SSLSocket? = null
    var upIn: InputStream? = null
    var upOut: OutputStream? = null

    try {
      while (true) {
        val request = HttpIo.readMessage(clientIn, isRequest = true) ?: break
        val (method, target, version) = parseRequestLine(request.startLine)

        if (upstream == null) {
          upstream = openUpstreamTls(connectHost, sniHost, port)
          upIn = BufferedInputStream(upstream.inputStream)
          upOut = upstream.outputStream
        }

        val started = System.currentTimeMillis()
        val forward = request.copy(startLine = "$method ${toOriginForm(target)} $version")
        HttpIo.writeMessage(upOut!!, forward, asForwardRequest = true)

        val response = HttpIo.readMessage(upIn!!, isRequest = false)
        if (response == null) break
        HttpIo.writeMessage(clientOut, response, asForwardRequest = false)

        emit(
          scheme = "https", host = sniHost, port = port, version = version,
          request = request, response = response, startedAt = started
        )

        val keepAlive = HttpIo.isKeepAlive(request, version) &&
          HttpIo.isKeepAlive(response, response.startLine.substringBefore(' '))
        if (!keepAlive) break
      }
    } catch (e: Exception) {
      Log.d(TAG, "tls tunnel error for $sniHost: ${e.message}")
    } finally {
      upstream?.closeQuietly()
      try {
        tls.close()
      } catch (_: Exception) {
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Upstream sockets (protected so they bypass the VPN)
  // ---------------------------------------------------------------------------

  private fun openUpstream(host: String, port: Int, tls: Boolean): Socket {
    val raw = Socket()
    protect(raw)
    raw.connect(InetSocketAddress(host, port), SOCKET_TIMEOUT_MS)
    raw.soTimeout = SOCKET_TIMEOUT_MS
    return raw
  }

  /** Connects to [connectHost] but presents [sniHost] as the TLS server name. */
  private fun openUpstreamTls(connectHost: String, sniHost: String, port: Int): SSLSocket {
    val raw = Socket()
    protect(raw)
    raw.connect(InetSocketAddress(connectHost, port), SOCKET_TIMEOUT_MS)
    raw.soTimeout = SOCKET_TIMEOUT_MS
    val tls = upstreamFactory.createSocket(raw, sniHost, port, true) as SSLSocket
    tls.useClientMode = true
    tls.startHandshake()
    return tls
  }

  // ---------------------------------------------------------------------------
  // Emit a TrafficEntry-shaped map
  // ---------------------------------------------------------------------------

  private fun emit(
    scheme: String,
    host: String,
    port: Int,
    version: String,
    request: HttpIo.Message,
    response: HttpIo.Message,
    startedAt: Long,
  ) {
    val (method, target, _) = parseRequestLine(request.startLine)
    val fullUrl = absoluteUrl(target, request.header("Host") ?: host, scheme)
    val path = pathOf(fullUrl)
    val (sourceApp, sourceLabel) = attribution()
    val statusCode = HttpIo.statusCode(response.startLine)
    val statusText = response.startLine.split(" ", limit = 3).getOrNull(2) ?: ""

    val entry = mapOf(
      "id" to "evt_${startedAt}_${idSeq.incrementAndGet()}",
      "startedAt" to startedAt,
      "durationMs" to (System.currentTimeMillis() - startedAt),
      "sourceApp" to sourceApp,
      "sourceAppLabel" to sourceLabel,
      "host" to host,
      "path" to path,
      "scheme" to scheme,
      "tlsDecrypted" to (scheme == "https"),
      "request" to mapOf(
        "method" to method,
        "url" to fullUrl,
        "httpVersion" to version,
        "headers" to headerMaps(request.headers),
        "queryParams" to queryParams(fullUrl),
        "body" to bodyMap(request.body, request.header("Content-Type")),
      ),
      "response" to mapOf(
        "statusCode" to statusCode,
        "statusText" to statusText,
        "headers" to headerMaps(response.headers),
        "body" to bodyMap(response.body, response.header("Content-Type")),
      ),
    )
    try {
      onTransaction(entry)
    } catch (e: Exception) {
      Log.w(TAG, "emit failed", e)
    }
  }

  // ---------------------------------------------------------------------------
  // Parsing helpers
  // ---------------------------------------------------------------------------

  private fun parseRequestLine(line: String): Triple<String, String, String> {
    val parts = line.split(" ")
    val method = parts.getOrNull(0) ?: "GET"
    val target = parts.getOrNull(1) ?: "/"
    val version = parts.getOrNull(2) ?: "HTTP/1.1"
    return Triple(method, target, version)
  }

  private fun absoluteUrl(target: String, host: String?, scheme: String): String {
    if (target.startsWith("http://") || target.startsWith("https://")) return target
    val h = host ?: ""
    return "$scheme://$h$target"
  }

  private fun toOriginForm(target: String): String {
    if (!target.startsWith("http://") && !target.startsWith("https://")) return target
    val afterScheme = target.substringAfter("://")
    val slash = afterScheme.indexOf('/')
    return if (slash == -1) "/" else afterScheme.substring(slash)
  }

  private fun hostPortOf(url: String, defaultPort: Int): Pair<String, Int> {
    val afterScheme = url.substringAfter("://")
    val authority = afterScheme.substringBefore('/')
    val host = authority.substringBefore(':')
    val port = authority.substringAfter(':', defaultPort.toString()).toIntOrNull() ?: defaultPort
    return host to port
  }

  private fun pathOf(url: String): String {
    val afterScheme = url.substringAfter("://")
    val slash = afterScheme.indexOf('/')
    val path = if (slash == -1) "/" else afterScheme.substring(slash)
    return path.substringBefore('#')
  }

  private fun queryParams(url: String): List<Map<String, String>> {
    val query = url.substringAfter('?', "").substringBefore('#')
    if (query.isEmpty()) return emptyList()
    return query.split('&').mapNotNull { kv ->
      if (kv.isEmpty()) return@mapNotNull null
      val name = kv.substringBefore('=')
      val value = kv.substringAfter('=', "")
      mapOf("name" to urlDecode(name), "value" to urlDecode(value))
    }
  }

  private fun urlDecode(s: String): String = try {
    java.net.URLDecoder.decode(s, "UTF-8")
  } catch (_: Exception) {
    s
  }

  private fun headerMaps(headers: List<Pair<String, String>>): List<Map<String, String>> =
    headers.map { mapOf("name" to it.first, "value" to it.second) }

  private fun bodyMap(body: ByteArray, contentType: String?): Map<String, Any?> {
    val mime = contentType?.substringBefore(';')?.trim() ?: ""
    val texty = mime.isEmpty() ||
      mime.contains("json") || mime.contains("text") || mime.contains("xml") ||
      mime.contains("form-urlencoded") || mime.contains("javascript")
    if (body.isEmpty()) {
      return mapOf("kind" to "none", "text" to "", "mimeType" to mime, "sizeBytes" to 0)
    }
    if (!texty) {
      return mapOf(
        "kind" to "binary",
        "text" to "",
        "mimeType" to mime,
        "sizeBytes" to body.size,
      )
    }
    val kind = if (mime.contains("json")) "json"
    else if (mime.contains("form-urlencoded")) "form"
    else "text"
    return mapOf(
      "kind" to kind,
      "text" to String(body, Charsets.UTF_8),
      "mimeType" to mime,
      "sizeBytes" to body.size,
    )
  }

  private fun Socket.closeQuietly() {
    try {
      close()
    } catch (_: Exception) {
    }
  }

  private object TrustAll : X509TrustManager {
    override fun checkClientTrusted(chain: Array<out java.security.cert.X509Certificate>?, authType: String?) {}
    override fun checkServerTrusted(chain: Array<out java.security.cert.X509Certificate>?, authType: String?) {}
    override fun getAcceptedIssuers(): Array<java.security.cert.X509Certificate> = emptyArray()
  }
}

/** Sentinel for "the client sent nothing before the peek timeout". */
private const val NO_BYTE = -2
