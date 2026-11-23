package expo.modules.vpninterceptor

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream

/**
 * HttpIo
 *
 * Minimal, forgiving HTTP/1.x reader/serializer used by the MITM proxy. It
 * parses a request/response head plus body (Content-Length, chunked, or
 * read-until-close) and can re-serialize a message for forwarding.
 *
 * Bodies are materialized into a ByteArray so they can both be forwarded and
 * surfaced to the inspector. Chunked bodies are de-chunked and re-sent with an
 * explicit Content-Length; Accept-Encoding is stripped from forwarded requests
 * so responses arrive uncompressed and human-readable.
 */
object HttpIo {

  private const val CR = '\r'.code
  private const val LF = '\n'.code

  data class Message(
    val startLine: String,
    val headers: MutableList<Pair<String, String>>,
    val body: ByteArray,
  ) {
    fun header(name: String): String? =
      headers.firstOrNull { it.first.equals(name, ignoreCase = true) }?.second

    fun removeHeader(name: String) =
      headers.removeAll { it.first.equals(name, ignoreCase = true) }

    fun setHeader(name: String, value: String) {
      removeHeader(name)
      headers.add(name to value)
    }
  }

  /** Reads one HTTP message head + body. Returns null at clean EOF. */
  fun readMessage(input: InputStream, isRequest: Boolean): Message? {
    val startLine = readLine(input) ?: return null
    if (startLine.isEmpty()) return null

    val headers = mutableListOf<Pair<String, String>>()
    while (true) {
      val line = readLine(input) ?: break
      if (line.isEmpty()) break
      val idx = line.indexOf(':')
      if (idx <= 0) continue
      val name = line.substring(0, idx).trim()
      val value = line.substring(idx + 1).trim()
      headers.add(name to value)
    }

    val msg = Message(startLine, headers, ByteArray(0))
    val body = readBody(input, msg, isRequest)
    return msg.copy(body = body)
  }

  private fun readBody(input: InputStream, msg: Message, isRequest: Boolean): ByteArray {
    val te = msg.header("Transfer-Encoding")
    if (te != null && te.contains("chunked", ignoreCase = true)) {
      return readChunked(input)
    }
    val cl = msg.header("Content-Length")?.trim()?.toLongOrNull()
    if (cl != null) {
      return readExactly(input, cl)
    }
    // No explicit length: requests have no body; responses read until close
    // (the proxy only does this for responses without keep-alive).
    if (isRequest) return ByteArray(0)
    val status = statusCodeOf(msg.startLine)
    if (status == 204 || status == 304 || (status in 100..199)) return ByteArray(0)
    val conn = msg.header("Connection")
    return if (conn != null && conn.equals("close", ignoreCase = true)) {
      input.readBytes()
    } else {
      ByteArray(0)
    }
  }

  private fun readChunked(input: InputStream): ByteArray {
    val out = ByteArrayOutputStream()
    while (true) {
      val sizeLine = readLine(input) ?: break
      val size = sizeLine.substringBefore(';').trim().toIntOrNull(16) ?: break
      if (size == 0) {
        // Consume trailing headers until blank line.
        while (true) {
          val t = readLine(input) ?: break
          if (t.isEmpty()) break
        }
        break
      }
      out.write(readExactly(input, size.toLong()))
      readLine(input) // trailing CRLF after chunk data
    }
    return out.toByteArray()
  }

  private fun readExactly(input: InputStream, length: Long): ByteArray {
    val out = ByteArrayOutputStream()
    val buf = ByteArray(8192)
    var remaining = length
    while (remaining > 0) {
      val toRead = minOf(buf.size.toLong(), remaining).toInt()
      val n = input.read(buf, 0, toRead)
      if (n == -1) break
      out.write(buf, 0, n)
      remaining -= n
    }
    return out.toByteArray()
  }

  /** Reads a line terminated by LF (CRLF tolerated), returned without the EOL. */
  private fun readLine(input: InputStream): String? {
    val out = ByteArrayOutputStream()
    var sawAny = false
    while (true) {
      val b = input.read()
      if (b == -1) return if (sawAny) out.toString("ISO-8859-1") else null
      sawAny = true
      if (b == LF) break
      if (b == CR) continue
      out.write(b)
    }
    return out.toString("ISO-8859-1")
  }

  private fun statusCodeOf(statusLine: String): Int =
    statusLine.split(" ").getOrNull(1)?.toIntOrNull() ?: 0

  /**
   * Serializes [msg] for forwarding. When [asForwardRequest] is true, strips
   * Accept-Encoding (so responses are uncompressed) and rewrites the body
   * framing to an explicit Content-Length.
   */
  fun writeMessage(out: OutputStream, msg: Message, asForwardRequest: Boolean) {
    val headers = msg.headers.toMutableList()
    headers.removeAll { it.first.equals("Transfer-Encoding", ignoreCase = true) }
    headers.removeAll { it.first.equals("Content-Length", ignoreCase = true) }
    if (asForwardRequest) {
      headers.removeAll { it.first.equals("Accept-Encoding", ignoreCase = true) }
    }
    if (msg.body.isNotEmpty() || bodyAllowed(msg.startLine)) {
      headers.add("Content-Length" to msg.body.size.toString())
    }

    val sb = StringBuilder()
    sb.append(msg.startLine).append("\r\n")
    for ((n, v) in headers) sb.append(n).append(": ").append(v).append("\r\n")
    sb.append("\r\n")
    out.write(sb.toString().toByteArray(Charsets.ISO_8859_1))
    if (msg.body.isNotEmpty()) out.write(msg.body)
    out.flush()
  }

  private fun bodyAllowed(startLine: String): Boolean {
    // Always emit Content-Length: 0 for requests with methods that may carry a
    // body even when empty is harmless; keep it simple and only when non-empty.
    return false
  }

  fun statusCode(statusLine: String): Int = statusCodeOf(statusLine)

  fun isKeepAlive(msg: Message, httpVersion: String): Boolean {
    val conn = msg.header("Connection")?.lowercase()
    if (conn != null) {
      if (conn.contains("close")) return false
      if (conn.contains("keep-alive")) return true
    }
    return httpVersion.endsWith("1.1")
  }
}
