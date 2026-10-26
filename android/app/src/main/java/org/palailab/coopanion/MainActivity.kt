package org.palailab.coopanion

import android.Manifest
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.math.roundToInt

/**
 * Pairing and permissions. A pairing address arrives typed in, shared, or opened from a scanned code
 * (`http://<computer>:<port>/pair?key=…`); the service opens it in the floating window.
 */
class MainActivity : Activity() {
    private lateinit var state: TextView
    private lateinit var address: EditText
    private lateinit var overlayButton: Button
    private lateinit var micButton: Button

    private val changed = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.getBooleanExtra(PetService.EXTRA_REFUSED, false)) state.setText(R.string.pair_refused) else refresh()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (20 * resources.displayMetrics.density).roundToInt()
        val column = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(pad, pad * 2, pad, pad) }
        fun button(text: Int, onClick: () -> Unit) = Button(this).apply { setText(text); setOnClickListener { onClick() } }.also { column.addView(it, wide()) }
        column.addView(TextView(this).apply { setText(R.string.intro); textSize = 16f; setPadding(0, 0, 0, pad) }, wide())
        state = TextView(this).apply { textSize = 15f; setPadding(0, 0, 0, pad) }
        column.addView(state, wide())
        address = EditText(this).apply { setHint(R.string.address_hint); setSingleLine() }
        column.addView(address, wide())
        button(R.string.pair) { pair(address.text.toString()) }
        overlayButton = button(R.string.grant_overlay) {
            startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:$packageName")))
        }
        micButton = button(R.string.grant_mic) { requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1) }
        button(R.string.start) { start(null) }
        button(R.string.stop) { startService(Intent(this, PetService::class.java).setAction(PetService.ACTION_STOP)) }
        setContentView(ScrollView(this).apply { addView(column) })
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0)
        registerReceiver(changed, IntentFilter(PetService.ACTION_CHANGED), RECEIVER_NOT_EXPORTED)
        handle(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        refresh()
        // a running Coo can record now; the service takes the microphone type while the app is on screen
        if (requestCode == 1 && grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED && Pairing.origin(this) != null) {
            startForegroundService(Intent(this, PetService::class.java).setAction(PetService.ACTION_REFRESH))
        }
    }

    override fun onDestroy() {
        unregisterReceiver(changed)
        super.onDestroy()
    }

    private fun handle(intent: Intent?) {
        val text = when (intent?.action) {
            Intent.ACTION_VIEW -> intent.dataString
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            else -> null
        } ?: return
        address.setText(text)
        pair(text)
    }

    private fun pair(text: String) {
        val uri = Pairing.parse(text)
        if (uri == null) { state.setText(R.string.bad_address); return }
        start(uri.toString())
    }

    private fun start(pair: String?) {
        if (!Settings.canDrawOverlays(this)) { state.setText(R.string.need_overlay); return }
        if (pair == null && Pairing.origin(this) == null) { state.setText(R.string.not_paired); return }
        startForegroundService(Intent(this, PetService::class.java).setAction(PetService.ACTION_PAIR).putExtra(PetService.EXTRA_PAIR, pair))
        state.setText(R.string.status_connecting)
    }

    private fun refresh() {
        val origin = Pairing.origin(this)
        state.text = if (origin != null) getString(R.string.paired_with, Uri.parse(origin).host) else getString(R.string.not_paired)
        overlayButton.isEnabled = !Settings.canDrawOverlays(this)
        micButton.isEnabled = checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED
    }

    private fun wide() = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
}
