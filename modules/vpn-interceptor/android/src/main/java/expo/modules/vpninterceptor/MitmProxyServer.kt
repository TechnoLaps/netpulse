package expo.modules.vpninterceptor

import android.util.Log
import java.io.BufferedInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/**
 * MitmProxyServer
 *
 * A local HTTP/HTTPS proxy bound to 127.0.0.1. The VpnService points the
 * selected apps' system HTTP proxy here (see NetPulseVpnService). For each
 * connection it parses the HTTP(S) exchange, forwards it upstream, and emits a
 * TrafficEntry-shaped map to JS.
 *
 * HTTPS is intercepted with a per-host leaf certificate from [ca]; the client
 * must trust the NetPulse root CA. Only HTTP/1.1 is offered (no ALPN/h2), and
 * upstream TLS is validated leniently to maximize capture coverage.
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
  }

  private val executor = Executors.newCachedThreadPool()
  private val idSeq = AtomicLong(0)
  private var serverSocket: ServerSocket? = null

  @Volatile
  private var running = false

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
  // Plain HTTP (request target is an absolute URI via the proxy)
  // ---------------------------------------------------------------------------

  private fun handlePlainHttp(client: Socket, input: InputStream, first: HttpIo.Message) {
    var request: HttpIo.Message = first
    val out = client.getOutputStream()
    var upstream: Socket? = null
    var upIn: InputStream? = null
    var upOut: OutputStream? = null
    var currentHostPort: String? = null

    try {
      while (true) {
        val (method, target, version) = parseRequestLine(request.startLine)
        val url = absoluteUrl(target, request.header("Host"), "http")
        val hostPort = hostPortOf(url, 80)
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
          upstream.closeQuietly(); upstream = null
          break
        }
        HttpIo.writeMessage(out, response, asForwardRequest = false)
        emit(scheme = "http", host = host, port = port, version = version,
          request = request, response = response, startedAt = started)

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
  // HTTPS via CONNECT (TLS interception)
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

    val serverCtx = ca.serverSslContext(host)
    val tlsClient = (serverCtx.socketFactory.createSocket(
      client, host, port, true
    ) as SSLSocket).apply {
      useClientMode = false
      // Offer only HTTP/1.1 (no ALPN h2) so our parser applies.
    }
    tlsClient.startHandshake()

    val clientIn = BufferedInputStream(tlsClient.inputStream)
    val clientOut = tlsClient.outputStream

    var upstream: SSLSocket? = null
    var upIn: InputStream? = null
    var upOut: OutputStream? = null

    try {
      while (true) {
        val request = HttpIo.readMessage(clientIn, isRequest = true) ?: break
        val (method, target, version) = parseRequestLine(request.startLine)

        if (upstream == null) {
          upstream = openUpstreamTls(host, port)
          upIn = BufferedInputStream(upstream.inputStream)
          upOut = upstream.outputStream
        }

        val started = System.currentTimeMillis()
        val forward = request.copy(startLine = "$method ${toOriginForm(target)} $version")
        HttpIo.writeMessage(upOut!!, forward, asForwardRequest = true)

        val response = HttpIo.readMessage(upIn!!, isRequest = false)
        if (response == null) break
        HttpIo.writeMessage(clientOut, response, asForwardRequest = false)

        emit(scheme = "https", host = host, port = port, version = version,
          request = request, response = response, startedAt = started)

        val keepAlive = HttpIo.isKeepAlive(request, version) &&
          HttpIo.isKeepAlive(response, response.startLine.substringBefore(' '))
        if (!keepAlive) break
      }
    } catch (e: Exception) {
      Log.d(TAG, "tls tunnel error for $host: ${e.message}")
    } finally {
      upstream?.closeQuietly()
      try {
        tlsClient.close()
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

  private fun openUpstreamTls(host: String, port: Int): SSLSocket {
    val raw = Socket()
    protect(raw)
    raw.connect(InetSocketAddress(host, port), SOCKET_TIMEOUT_MS)
    raw.soTimeout = SOCKET_TIMEOUT_MS
    val tls = upstreamFactory.createSocket(raw, host, port, true) as SSLSocket
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
    val fullUrl = absoluteUrl(target, request.header("Host"), scheme)
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
