package expo.modules.vpninterceptor

import android.content.Context
import android.util.Base64
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.asn1.x509.BasicConstraints
import org.bouncycastle.asn1.x509.Extension
import org.bouncycastle.asn1.x509.GeneralName
import org.bouncycastle.asn1.x509.GeneralNames
import org.bouncycastle.asn1.x509.KeyUsage
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter
import org.bouncycastle.cert.jcajce.JcaX509ExtensionUtils
import org.bouncycastle.cert.jcajce.JcaX509v3CertificateBuilder
import org.bouncycastle.jce.provider.BouncyCastleProvider
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder
import java.io.File
import java.math.BigInteger
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Security
import java.security.cert.X509Certificate
import java.util.Date
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext

/**
 * CertificateAuthority
 *
 * Generates and persists a local root CA, then mints per-host leaf certificates
 * on demand so the MITM proxy can present a trusted-looking certificate for any
 * host the user is inspecting. The user installs the root CA once (see
 * [caCertificatePem] / KeyChain install intent in the module).
 *
 * Keys never leave the device; the keystore lives in the app's private files dir.
 */
class CertificateAuthority(context: Context) {

  companion object {
    private const val KEYSTORE_FILE = "netpulse_ca.p12"
    private const val KEYSTORE_PASSWORD = "netpulse-local-ca"
    private const val CA_ALIAS = "netpulse-root-ca"
    private const val KEY_SIZE = 2048
    private const val SIG_ALG = "SHA256withRSA"

    init {
      // Register BouncyCastle as a provider (named "BC"). Safe to call repeatedly.
      if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) == null) {
        Security.addProvider(BouncyCastleProvider())
      }
    }
  }

  private val keystoreFile = File(context.filesDir, KEYSTORE_FILE)

  private val caCert: X509Certificate
  private val caKey: PrivateKey

  // Cache one SSLContext per host so repeated connections reuse the leaf cert.
  private val sslContextCache = ConcurrentHashMap<String, SSLContext>()

  init {
    val (cert, key) = loadOrCreateCa()
    caCert = cert
    caKey = key
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** PEM-encoded root CA certificate for the user to install/trust. */
  fun caCertificatePem(): String = toPem("CERTIFICATE", caCert.encoded)

  /** DER bytes of the root CA (used by KeyChain.createInstallIntent). */
  fun caCertificateDer(): ByteArray = caCert.encoded

  /**
   * An SSLContext whose server certificate is a freshly-minted leaf for [host],
   * signed by our root CA. Used in server mode on the intercepted TLS socket.
   */
  fun serverSslContext(host: String): SSLContext =
    sslContextCache.getOrPut(host) { buildServerSslContext(host) }

  // ---------------------------------------------------------------------------
  // CA lifecycle
  // ---------------------------------------------------------------------------

  private fun loadOrCreateCa(): Pair<X509Certificate, PrivateKey> {
    if (keystoreFile.exists()) {
      try {
        val ks = KeyStore.getInstance("PKCS12")
        keystoreFile.inputStream().use { ks.load(it, KEYSTORE_PASSWORD.toCharArray()) }
        val cert = ks.getCertificate(CA_ALIAS) as X509Certificate
        val key = ks.getKey(CA_ALIAS, KEYSTORE_PASSWORD.toCharArray()) as PrivateKey
        return cert to key
      } catch (_: Exception) {
        // Corrupt/old keystore — regenerate.
        keystoreFile.delete()
      }
    }
    val generated = generateCa()
    persistCa(generated.first, generated.second)
    return generated
  }

  private fun persistCa(cert: X509Certificate, key: PrivateKey) {
    val ks = KeyStore.getInstance("PKCS12")
    ks.load(null, null)
    ks.setKeyEntry(CA_ALIAS, key, KEYSTORE_PASSWORD.toCharArray(), arrayOf(cert))
    keystoreFile.outputStream().use { ks.store(it, KEYSTORE_PASSWORD.toCharArray()) }
  }

  private fun generateCa(): Pair<X509Certificate, PrivateKey> {
    val keyPair = newKeyPair()
    val now = System.currentTimeMillis()
    val notBefore = Date(now - 24L * 60 * 60 * 1000) // 1 day skew
    val notAfter = Date(now + 3650L * 24 * 60 * 60 * 1000) // ~10 years
    val name = X500Name("CN=NetPulse Inspector Root CA,O=NetPulse,OU=Debug")

    val builder = JcaX509v3CertificateBuilder(
      name,
      BigInteger.valueOf(now),
      notBefore,
      notAfter,
      name,
      keyPair.public
    )
    val extUtils = JcaX509ExtensionUtils()
    builder.addExtension(Extension.basicConstraints, true, BasicConstraints(true))
    builder.addExtension(
      Extension.keyUsage,
      true,
      KeyUsage(KeyUsage.keyCertSign or KeyUsage.cRLSign or KeyUsage.digitalSignature)
    )
    builder.addExtension(
      Extension.subjectKeyIdentifier,
      false,
      extUtils.createSubjectKeyIdentifier(keyPair.public)
    )

    val signer = JcaContentSignerBuilder(SIG_ALG)
      .setProvider(BouncyCastleProvider.PROVIDER_NAME)
      .build(keyPair.private)
    val holder = builder.build(signer)
    val cert = JcaX509CertificateConverter()
      .setProvider(BouncyCastleProvider.PROVIDER_NAME)
      .getCertificate(holder)
    return cert to keyPair.private
  }

  // ---------------------------------------------------------------------------
  // Leaf certificates
  // ---------------------------------------------------------------------------

  private fun buildServerSslContext(host: String): SSLContext {
    val leafPair = newKeyPair()
    val leafCert = generateLeaf(host, leafPair)

    val ks = KeyStore.getInstance("PKCS12")
    ks.load(null, null)
    ks.setKeyEntry(
      "leaf",
      leafPair.private,
      KEYSTORE_PASSWORD.toCharArray(),
      arrayOf(leafCert, caCert)
    )

    val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
    kmf.init(ks, KEYSTORE_PASSWORD.toCharArray())

    val ctx = SSLContext.getInstance("TLS")
    ctx.init(kmf.keyManagers, null, null)
    return ctx
  }

  private fun generateLeaf(host: String, leafPair: KeyPair): X509Certificate {
    val now = System.currentTimeMillis()
    val notBefore = Date(now - 24L * 60 * 60 * 1000)
    val notAfter = Date(now + 825L * 24 * 60 * 60 * 1000) // 825 days (max trusted)
    val subject = X500Name("CN=$host,O=NetPulse Inspector")

    val builder = JcaX509v3CertificateBuilder(
      X500Name(caCert.subjectX500Principal.name),
      BigInteger.valueOf(now).add(BigInteger.valueOf(host.hashCode().toLong() and 0xffffL)),
      notBefore,
      notAfter,
      subject,
      leafPair.public
    )
    builder.addExtension(Extension.basicConstraints, false, BasicConstraints(false))

    val sanType = if (isIpAddress(host)) GeneralName.iPAddress else GeneralName.dNSName
    val san = GeneralNames(GeneralName(sanType, host))
    builder.addExtension(Extension.subjectAlternativeName, false, san)

    val signer = JcaContentSignerBuilder(SIG_ALG)
      .setProvider(BouncyCastleProvider.PROVIDER_NAME)
      .build(caKey)
    val holder = builder.build(signer)
    return JcaX509CertificateConverter()
      .setProvider(BouncyCastleProvider.PROVIDER_NAME)
      .getCertificate(holder)
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private fun newKeyPair(): KeyPair {
    val gen = KeyPairGenerator.getInstance("RSA")
    gen.initialize(KEY_SIZE)
    return gen.generateKeyPair()
  }

  private fun isIpAddress(host: String): Boolean =
    host.matches(Regex("^\\d{1,3}(\\.\\d{1,3}){3}$")) || host.contains(":")

  private fun toPem(type: String, der: ByteArray): String {
    val b64 = Base64.encodeToString(der, Base64.NO_WRAP)
    val body = b64.chunked(64).joinToString("\n")
    return "-----BEGIN $type-----\n$body\n-----END $type-----\n"
  }
}
