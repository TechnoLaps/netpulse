package expo.modules.vpninterceptor

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.VpnService
import android.security.KeyChain
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * VpnInterceptorModule
 *
 * Bridges Android's VpnService to the React Native / Expo JS layer.
 *
 * Responsibilities:
 *   - prepare():          launch the system VPN consent dialog
 *   - start(packages):    start NetPulseVpnService, intercepting only `packages`
 *   - stop():             stop the service
 *   - listInstalledApps:  enumerate apps for the Target selector
 *   - onTransaction event: emitted (from NetPulseVpnService) per captured call
 *
 * The heavy lifting (reading the tun ParcelFileDescriptor, running a userspace
 * TCP/IP stack + local MITM proxy, parsing HTTP) lives in NetPulseVpnService.
 */
class VpnInterceptorModule : Module() {

  companion object {
    const val EVENT_TRANSACTION = "onTransaction"
    const val EVENT_STATUS = "onStatus"
    private const val VPN_REQUEST_CODE = 0x7654
  }

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val currentActivity: Activity?
    get() = appContext.currentActivity

  // Holds the pending prepare() promise while the consent Activity is up.
  private var preparePromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("VpnInterceptor")

    Constants(
      "isAvailable" to true
    )

    Events(EVENT_TRANSACTION, EVENT_STATUS)

    // -- Consent -------------------------------------------------------------
    AsyncFunction("prepare") { promise: Promise ->
      val activity = currentActivity
        ?: return@AsyncFunction promise.reject("E_NO_ACTIVITY", "No foreground activity", null)

      val intent = VpnService.prepare(context)
      if (intent == null) {
        // Consent already granted.
        promise.resolve(true)
      } else {
        preparePromise = promise
        activity.startActivityForResult(intent, VPN_REQUEST_CODE)
      }
    }

    // Wire the Activity result back to the pending prepare() promise.
    OnActivityResult { _, payload ->
      if (payload.requestCode == VPN_REQUEST_CODE) {
        val granted = payload.resultCode == Activity.RESULT_OK
        preparePromise?.resolve(granted)
        preparePromise = null
      }
    }

    // -- Session control -----------------------------------------------------
    AsyncFunction("start") { allowedPackages: List<String>, allowedLabels: List<String>, promise: Promise ->
      // Register the emitter first so no early status/transaction event is lost.
      NetPulseVpnService.bindEmitter { name, body -> sendEvent(name, body) }
      val intent = Intent(context, NetPulseVpnService::class.java).apply {
        action = NetPulseVpnService.ACTION_START
        putStringArrayListExtra(
          NetPulseVpnService.EXTRA_ALLOWED_PACKAGES,
          ArrayList(allowedPackages)
        )
        putStringArrayListExtra(
          NetPulseVpnService.EXTRA_ALLOWED_LABELS,
          ArrayList(allowedLabels)
        )
      }
      context.startService(intent)
      promise.resolve(null)
    }

    // -- Root CA (for HTTPS interception) ------------------------------------
    AsyncFunction("getCaCertificatePem") {
      CertificateAuthority(context).caCertificatePem()
    }

    AsyncFunction("installCaCertificate") { promise: Promise ->
      val activity = currentActivity
        ?: return@AsyncFunction promise.reject("E_NO_ACTIVITY", "No foreground activity", null)
      val der = CertificateAuthority(context).caCertificateDer()
      val intent = KeyChain.createInstallIntent().apply {
        putExtra(KeyChain.EXTRA_CERTIFICATE, der)
        putExtra(KeyChain.EXTRA_NAME, "NetPulse Inspector Root CA")
      }
      activity.startActivity(intent)
      promise.resolve(true)
    }

    AsyncFunction("stop") { promise: Promise ->
      val intent = Intent(context, NetPulseVpnService::class.java).apply {
        action = NetPulseVpnService.ACTION_STOP
      }
      context.startService(intent)
      promise.resolve(null)
    }

    // -- App enumeration -----------------------------------------------------
    AsyncFunction("listInstalledApps") { includeSystem: Boolean ->
      val pm = context.packageManager
      val apps = pm.getInstalledApplications(PackageManager.GET_META_DATA)
      apps
        .filter { info ->
          includeSystem || (info.flags and ApplicationInfo.FLAG_SYSTEM) == 0
        }
        .map { info ->
          mapOf(
            "packageName" to info.packageName,
            "label" to pm.getApplicationLabel(info).toString(),
            "system" to ((info.flags and ApplicationInfo.FLAG_SYSTEM) != 0)
          )
        }
        .sortedBy { (it["label"] as String).lowercase() }
    }
  }
}
