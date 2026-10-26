package org.palailab.coopanion

import android.annotation.SuppressLint
import android.app.Activity
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient

/** The computer's dress-up page, opened from the pet's menu; it shares the pairing cookie with the floating window. */
class DressActivity : Activity() {
    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val origin = intent.getStringExtra(EXTRA_ORIGIN) ?: run { finish(); return }
        val web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.webViewClient = WebViewClient()
        setContentView(web)
        Direct.apply(this) { web.loadUrl("$origin/dress") }
    }

    companion object {
        const val EXTRA_ORIGIN = "origin"
    }
}
