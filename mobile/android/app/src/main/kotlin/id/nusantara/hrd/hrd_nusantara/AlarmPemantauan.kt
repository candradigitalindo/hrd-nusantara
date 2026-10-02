package id.nusantara.hrd.hrd_nusantara

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent

/**
 * Alarm "pemantauan berhenti" — saklar orang mati: dipasang ulang setiap titik
 * lokasi diterima, jadi hanya bunyi bila titik berhenti datang. Proses yang
 * sudah mati tidak bisa memberi tahu dirinya sendiri; AlarmManager hidup di
 * luar proses aplikasi dan membangunkannya hanya untuk menampilkan notifikasi.
 */
object AlarmPemantauan {
    const val AKSI = "id.nusantara.hrd.PEMANTAUAN_BERHENTI"
    private const val KODE = 7101

    private fun tujuan(c: Context): PendingIntent = PendingIntent.getBroadcast(
        c.applicationContext,
        KODE,
        Intent(c.applicationContext, PengingatReceiver::class.java).setAction(AKSI),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun manajer(c: Context) = c.applicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    /**
     * Sengaja tidak presisi (setAndAllowWhileIdle): izin alarm tepat waktu
     * perlu persetujuan khusus di Android 12+, sedangkan telat beberapa menit
     * tidak berarti untuk batas satu jam. Tetap berbunyi saat ponsel Doze.
     */
    fun pasang(c: Context, pada: Long) {
        manajer(c).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, pada, tujuan(c))
    }

    fun batal(c: Context) {
        manajer(c).cancel(tujuan(c))
    }
}
