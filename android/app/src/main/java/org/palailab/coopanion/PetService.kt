package org.palailab.coopanion

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.os.IBinder
import android.provider.Settings

/**
 * Keeps Coo on the phone: a foreground service holding the floating window. While the screen is off
 * the page is left, so the computer's pet window takes Coo back; it returns once the phone is unlocked.
 *
 * Started with [ACTION_PAIR] and a pairing address, it opens that address first; the computer it names
 * becomes the paired one once the pet page loads.
 */
class PetService : Service(), PetOverlay.Events {
    private var overlay: PetOverlay? = null
    private var origin: String? = null
    private var mic: Mic? = null
    private var status = R.string.status_connecting

    private val screen = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_SCREEN_OFF -> { stopMic(); overlay?.suspend(); notifyStatus(R.string.status_away) }
                Intent.ACTION_USER_PRESENT -> { overlay?.load(); notifyStatus(R.string.status_connecting) }
            }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.channel), NotificationManager.IMPORTANCE_LOW),
        )
        registerReceiver(screen, IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_USER_PRESENT)
        })
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        goForeground()
        when (intent?.action) {
            ACTION_STOP -> { stopSelf(); return START_NOT_STICKY }
            ACTION_REFRESH -> { if (overlay == null) stopSelf(); return START_STICKY }
            ACTION_TOGGLE -> { overlay?.let { it.setShown(!it.isShown) }; return START_STICKY }
        }
        if (!Settings.canDrawOverlays(this)) { stopSelf(); return START_NOT_STICKY }
        val pair = intent?.getStringExtra(EXTRA_PAIR)?.let { Pairing.parse(it) }
        val target = pair?.let { Pairing.originOf(it) } ?: Pairing.origin(this)
        if (target == null) { stopSelf(); return START_NOT_STICKY }
        if (target != origin) {
            overlay?.destroy()
            origin = target
            overlay = PetOverlay(this, target, this)
        }
        notifyStatus(R.string.status_connecting)
        if (pair != null) overlay!!.load(pair.toString()) else overlay!!.load()
        return START_STICKY
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        overlay?.measureStage()
    }

    override fun onDestroy() {
        unregisterReceiver(screen)
        stopMic()
        overlay?.destroy()
        overlay = null
        super.onDestroy()
    }

    override fun onLoaded() {
        origin?.let { Pairing.save(this, it) }
        notifyStatus(R.string.status_on_phone)
        sendBroadcast(Intent(ACTION_CHANGED).setPackage(packageName))
    }

    override fun onUnreachable() = notifyStatus(R.string.status_unreachable)

    override fun onPairRefused() {
        notifyStatus(R.string.pair_refused)
        sendBroadcast(Intent(ACTION_CHANGED).setPackage(packageName).putExtra(EXTRA_REFUSED, true))
        stopSelf()
    }

    override fun onDress() {
        val origin = origin ?: return
        startActivity(Intent(this, DressActivity::class.java).putExtra(DressActivity.EXTRA_ORIGIN, origin).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    override fun onShownChanged(shown: Boolean) = notifyStatus(status)

    override fun onMic(on: Boolean) {
        val overlay = overlay ?: return
        if (!on) { stopMic(); return }
        if (!hasMic()) { overlay.micOpened(ok = false, denied = true); return }
        // without the microphone type the system hands over silence; the permission may have come after the start
        if (!goForeground()) { overlay.micOpened(ok = false); return }
        val m = mic ?: Mic { overlay.micData(it) }.also { mic = it }
        overlay.micOpened(m.start())
    }

    /** Runs in the foreground, with the microphone type once it is granted; false when that type was refused. */
    private fun goForeground(): Boolean {
        val special = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        if (hasMic()) {
            try {
                startForeground(NOTIFICATION, notification(), special or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
                return true
            } catch (_: SecurityException) {
                // granted, but the app is not in use: the type waits for the next start from the app
            }
        }
        startForeground(NOTIFICATION, notification(), special)
        return false
    }

    private fun stopMic() {
        mic?.stop()
        mic = null
    }

    private fun hasMic() = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    private fun notifyStatus(text: Int) {
        status = text
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION, notification())
    }

    private fun notification(): Notification {
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val toggle = PendingIntent.getService(this, 1, Intent(this, PetService::class.java).setAction(ACTION_TOGGLE), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 2, Intent(this, PetService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val shown = overlay?.isShown ?: true
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(getString(status))
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(null, getString(if (shown) R.string.hide else R.string.show), toggle).build())
            .addAction(Notification.Action.Builder(null, getString(R.string.stop), stop).build())
            .build()
    }

    companion object {
        const val ACTION_PAIR = "org.palailab.coopanion.PAIR"
        const val ACTION_TOGGLE = "org.palailab.coopanion.TOGGLE"
        const val ACTION_STOP = "org.palailab.coopanion.STOP"
        /** Sent by the app once the microphone is granted, so the running service records with it. */
        const val ACTION_REFRESH = "org.palailab.coopanion.REFRESH"
        /** Broadcast to the app when the pairing took or was refused ([EXTRA_REFUSED]). */
        const val ACTION_CHANGED = "org.palailab.coopanion.CHANGED"
        const val EXTRA_PAIR = "pair"
        const val EXTRA_REFUSED = "refused"
        private const val CHANNEL = "pet"
        private const val NOTIFICATION = 1
    }
}
