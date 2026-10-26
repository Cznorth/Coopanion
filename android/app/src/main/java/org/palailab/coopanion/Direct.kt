package org.palailab.coopanion

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Handler
import android.os.Looper
import androidx.webkit.ProxyConfig
import androidx.webkit.ProxyController
import androidx.webkit.WebViewFeature

/**
 * The app reaches only the paired computer, on the local network, so it goes there directly: its
 * WebViews ignore the phone's proxy, and the process is bound to the Wi-Fi (or Ethernet) network so
 * that a VPN routing every address through itself does not swallow the LAN one. A VPN that forbids
 * apps to bypass it still wins.
 */
object Direct {
    private var proxySet = false
    private var bound: Network? = null
    private var watching = false

    /** Runs `then` on the main thread once the local network is bound, or after a short wait without one. */
    fun apply(context: Context, then: () -> Unit) {
        if (!proxySet && WebViewFeature.isFeatureSupported(WebViewFeature.PROXY_OVERRIDE)) {
            proxySet = true
            ProxyController.getInstance().setProxyOverride(ProxyConfig.Builder().addDirect().build(), Runnable::run) {}
        }
        val main = Handler(Looper.getMainLooper())
        if (bound != null || watching) { main.post(then); return }
        watching = true
        val cm = context.getSystemService(ConnectivityManager::class.java)
        var pending: (() -> Unit)? = then
        val go = { pending?.let { pending = null; it() } }
        val request = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
            .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        cm.registerNetworkCallback(request, object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                main.post {
                    bound = network
                    val ok = cm.bindProcessToNetwork(network)
                    android.util.Log.i("CooPage", "bound to $network: $ok")
                    go()
                }
            }

            override fun onLost(network: Network) {
                main.post {
                    if (bound != network) return@post
                    bound = null
                    cm.bindProcessToNetwork(null)
                }
            }
        })
        main.postDelayed({ go() }, WAIT_MS)
    }

    private const val WAIT_MS = 2000L
}
