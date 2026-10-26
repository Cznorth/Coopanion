package org.palailab.coopanion

import android.content.Context
import android.net.Uri

/**
 * The computer this phone is paired with: the origin of its desktop pet pages
 * (`http://<lan address>:<port>`), kept once its `/pair` address has been opened.
 * The cookie that pairing sets lives in the WebView's cookie store.
 */
object Pairing {
    private const val PREFS = "pairing"
    private const val ORIGIN = "origin"

    fun origin(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(ORIGIN, null)

    fun save(context: Context, origin: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(ORIGIN, origin).apply()
    }

    /** The pairing address in `text` (the panel's "View on a phone" link), or null when there is none. */
    fun parse(text: String?): Uri? {
        val found = Regex("""http://[^\s"'<>]+/pair\?key=[A-Za-z0-9_-]+""").find(text ?: return null) ?: return null
        val uri = Uri.parse(found.value)
        return if (uri.host.isNullOrEmpty() || uri.port <= 0) null else uri
    }

    fun originOf(uri: Uri): String = "http://${uri.host}:${uri.port}"
}
