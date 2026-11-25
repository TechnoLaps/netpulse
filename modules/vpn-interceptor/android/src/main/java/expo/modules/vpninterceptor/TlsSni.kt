package expo.modules.vpninterceptor

/**
 * TlsSni
 *
 * Extracts the Server Name Indication (SNI) hostname from a raw TLS record that
 * contains a ClientHello. Used in tunnel mode so the intercepting certificate is
 * minted for the name the app actually asked for, even when the SOCKS5 request
 * only carried an IP address.
 */
object TlsSni {

  /** [record] is the full TLS record, including the 5-byte record header. */
  fun parse(record: ByteArray): String? {
    try {
      // Record header: type(1)=0x16 handshake, version(2), length(2).
      // Handshake header: type(1)=0x01 ClientHello, length(3).
      if (record.size < 44 || u8(record, 0) != 0x16 || u8(record, 5) != 0x01) return null

      var p = 5 + 4 // past record header + handshake header
      p += 2 + 32 // client version + random
      p += 1 + u8(record, p) // session id
      p += 2 + u16(record, p) // cipher suites
      p += 1 + u8(record, p) // compression methods
      val extensionsLength = u16(record, p)
      p += 2
      val end = minOf(record.size, p + extensionsLength)

      while (p + 4 <= end) {
        val type = u16(record, p)
        val length = u16(record, p + 2)
        p += 4
        if (type == 0x0000) {
          // server_name extension: list length(2), name type(1), name length(2), name
          val nameType = u8(record, p + 2)
          val nameLength = u16(record, p + 3)
          if (nameType == 0 && p + 5 + nameLength <= end) {
            return String(record, p + 5, nameLength, Charsets.US_ASCII)
          }
          return null
        }
        p += length
      }
    } catch (_: IndexOutOfBoundsException) {
      // Truncated or malformed hello; fall back to the SOCKS destination.
    }
    return null
  }

  private fun u8(b: ByteArray, i: Int): Int = b[i].toInt() and 0xff

  private fun u16(b: ByteArray, i: Int): Int = (u8(b, i) shl 8) or u8(b, i + 1)
}
