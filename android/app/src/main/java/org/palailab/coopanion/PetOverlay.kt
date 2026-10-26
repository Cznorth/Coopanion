package org.palailab.coopanion

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Rect
import android.net.Uri
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.WindowInsets
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import kotlin.math.roundToInt

/**
 * The pet page in a floating window over other apps. The page is laid out on the whole stage (the
 * screen above the navigation bar), so walks and bubbles land where they do on a desktop; the window
 * itself covers only the part the page reports through `petHost.place` (the pet, its bubbles, menu and
 * buttons) with a margin, and shows the page under it by shifting the WebView. A window can only take
 * every touch inside it, so it stays that small; it moves when what it shows leaves it.
 */
@SuppressLint("SetJavaScriptEnabled")
class PetOverlay(private val context: Context, private val origin: String, private val events: Events) {
    interface Events {
        /** The pet page loaded, so the pairing (if any) took. */
        fun onLoaded()
        /** The computer could not be reached, or the page failed; the overlay tries again by itself. */
        fun onUnreachable()
        /** The computer refused the pairing key. */
        fun onPairRefused()
        fun onDress()
        fun onShownChanged(shown: Boolean)
        /** The page wants the microphone (true) or is done with it; answer with [micOpened]. */
        fun onMic(on: Boolean)
    }

    private val wm = context.getSystemService(WindowManager::class.java)
    private val density = context.resources.displayMetrics.density
    private val margin = (48 * density).roundToInt()
    private val root = object : FrameLayout(context) {
        override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
            if (ev.actionMasked == MotionEvent.ACTION_OUTSIDE) { setFocusable(false); return false }
            return super.dispatchTouchEvent(ev)
        }
    }
    private val web = WebView(context)
    private val params = WindowManager.LayoutParams(
        1, 1,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
            WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH or
            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
        title = "Coo"
    }
    private var stage = Rect()
    private var reply: JavaScriptReplyProxy? = null
    private var shown = true
    private var retry: Runnable? = null

    init {
        web.setBackgroundColor(Color.TRANSPARENT)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.settings.textZoom = 100
        web.webViewClient = Client()
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.i(TAG, "${message.messageLevel()} ${message.message()} @${message.sourceId()}:${message.lineNumber()}")
                return true
            }
        }
        if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) WebView.setWebContentsDebuggingEnabled(true)
        val rules = setOf(origin)
        check(WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) { "WebView too old" }
        val script = context.assets.open("pet-host.js").bufferedReader().use { it.readText() }
        WebViewCompat.addDocumentStartJavaScript(web, script, rules)
        WebViewCompat.addWebMessageListener(web, "CooAndroid", rules) { _, message, _, isMainFrame, proxy ->
            if (isMainFrame) { reply = proxy; onPage(message.data ?: return@addWebMessageListener) }
        }
        root.clipChildren = true
        root.addView(web)
        measureStage()
        wm.addView(root, params)
    }

    /** Opens `url` (the pairing address) or the pet page. */
    fun load(url: String = "$origin/pet") {
        retry?.let { root.removeCallbacks(it) }
        retry = null
        Direct.apply(context) { web.loadUrl(url) }
    }

    /** Leaves the page: the computer's own pet window takes Coo back. */
    fun suspend() {
        retry?.let { root.removeCallbacks(it) }
        retry = null
        web.loadUrl("about:blank")
        reply = null
    }

    fun setShown(on: Boolean) {
        shown = on
        root.visibility = if (on) FrameLayout.VISIBLE else FrameLayout.GONE
        send(JSONObject().put("t", "shown").put("v", on))
        events.onShownChanged(on)
    }

    val isShown get() = shown

    fun micOpened(ok: Boolean, denied: Boolean = false) {
        send(JSONObject().put("t", "mic-open").put("ok", ok).put("denied", denied).put("label", "phone"))
    }

    /** Hands a 100 ms chunk of microphone audio (base64 PCM16) to the page; any thread. */
    fun micData(pcm: String) {
        root.post { send(JSONObject().put("t", "mic-data").put("pcm", pcm)) }
    }

    /** The screen turned or its size changed: the page is laid out on the new stage. */
    fun measureStage() {
        val metrics = wm.currentWindowMetrics
        val nav = metrics.windowInsets.getInsetsIgnoringVisibility(WindowInsets.Type.navigationBars())
        stage = Rect(0, 0, metrics.bounds.width(), metrics.bounds.height() - nav.bottom)
        web.layoutParams = FrameLayout.LayoutParams(stage.width(), stage.height())
    }

    fun destroy() {
        retry?.let { root.removeCallbacks(it) }
        wm.removeView(root)
        web.destroy()
    }

    private fun send(msg: JSONObject) {
        reply?.postMessage(msg.toString())
    }

    private fun onPage(data: String) {
        val msg = try { JSONObject(data) } catch (_: Exception) { return }
        when (msg.optString("t")) {
            "place" -> place(msg.optJSONObject("rect"))
            "focus" -> setFocusable(true)
            "blur" -> setFocusable(false)
            "hide" -> setShown(false)
            "dress" -> events.onDress()
            "mic" -> events.onMic(msg.optBoolean("on"))
        }
    }

    private fun setFocusable(on: Boolean) {
        val flags = if (on) params.flags and WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE.inv()
        else params.flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
        if (flags == params.flags) return
        params.flags = flags
        wm.updateViewLayout(root, params)
        if (on) web.requestFocus()
    }

    /** Keeps the window over `rect` (page pixels): it moves only when the part shown leaves it or it has grown too big for it. */
    private fun place(rect: JSONObject?) {
        if (rect == null) { move(Rect(0, 0, 1, 1)); return }
        val need = Rect(
            (rect.optDouble("x") * density).roundToInt(), (rect.optDouble("y") * density).roundToInt(),
            ((rect.optDouble("x") + rect.optDouble("width")) * density).roundToInt(),
            ((rect.optDouble("y") + rect.optDouble("height")) * density).roundToInt(),
        )
        if (!need.intersect(stage)) { move(Rect(0, 0, 1, 1)); return }
        val now = Rect(params.x, params.y, params.x + params.width, params.y + params.height)
        if (now.contains(need) && now.width() <= need.width() + 4 * margin && now.height() <= need.height() + 4 * margin) return
        val next = Rect(need).apply { inset(-margin, -margin) }
        next.intersect(stage)
        move(next)
    }

    private fun move(to: Rect) {
        web.translationX = -to.left.toFloat()
        web.translationY = -to.top.toFloat()
        params.x = to.left
        params.y = to.top
        params.width = to.width()
        params.height = to.height()
        wm.updateViewLayout(root, params)
    }

    private fun retryLater() {
        if (retry != null) return
        val again = Runnable { retry = null; web.loadUrl("$origin/pet") }
        retry = again
        root.postDelayed(again, RETRY_MS)
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if ("${url.scheme}://${url.host}:${url.port}" == origin) return false
            // the chat page and links in bubbles open in the browser
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url.toString())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return true
        }

        override fun onPageFinished(view: WebView, url: String) {
            Log.i(TAG, "loaded $url")
            if (Uri.parse(url).path == "/pet") events.onLoaded()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            Log.w(TAG, "error ${request.url} ${error.errorCode} ${error.description}")
            if (!request.isForMainFrame) return
            events.onUnreachable()
            retryLater()
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            Log.w(TAG, "http ${response.statusCode} ${request.url}")
            if (!request.isForMainFrame) return
            if (request.url.path == "/pair") { events.onPairRefused(); return }
            events.onUnreachable()
            retryLater()
        }
    }

    private companion object {
        const val RETRY_MS = 10_000L
        const val TAG = "CooPage"
    }
}
