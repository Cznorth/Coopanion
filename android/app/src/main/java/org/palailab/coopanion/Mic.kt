package org.palailab.coopanion

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.util.Base64

/**
 * The phone's microphone as the pet page wants it: 16 kHz mono PCM16, handed over in 100 ms chunks
 * (base64) on a thread of its own. The page cannot open the microphone itself: it is not a secure context.
 */
class Mic(private val onChunk: (String) -> Unit) {
    private var record: AudioRecord? = null
    private var thread: Thread? = null

    /** Starts recording; the caller holds RECORD_AUDIO. False when the microphone does not open. */
    @SuppressLint("MissingPermission")
    fun start(): Boolean {
        if (record != null) return true
        val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val rec = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT, maxOf(min, CHUNK * 4))
        } catch (_: Exception) {
            return false
        }
        if (rec.state != AudioRecord.STATE_INITIALIZED) { rec.release(); return false }
        rec.startRecording()
        record = rec
        thread = Thread({
            val buf = ByteArray(CHUNK)
            while (record === rec) {
                var got = 0
                while (got < CHUNK && record === rec) {
                    val n = rec.read(buf, got, CHUNK - got)
                    if (n <= 0) break
                    got += n
                }
                if (got > 0 && record === rec) onChunk(Base64.encodeToString(buf, 0, got - got % 2, Base64.NO_WRAP))
                if (got == 0) break
            }
        }, "coo-mic").apply { start() }
        return true
    }

    fun stop() {
        val rec = record ?: return
        record = null
        try { rec.stop() } catch (_: IllegalStateException) {}
        thread?.join(500)
        thread = null
        rec.release()
    }

    private companion object {
        const val RATE = 16000
        /** 100 ms of 16 kHz PCM16. */
        const val CHUNK = RATE / 10 * 2
    }
}
