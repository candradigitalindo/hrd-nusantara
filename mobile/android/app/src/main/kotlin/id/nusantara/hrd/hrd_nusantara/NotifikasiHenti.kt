package id.nusantara.hrd.hrd_nusantara

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * Notifikasi lokal "Pemantauan lokasi terhenti". Dibuat langsung lewat
 * NotificationManager, bukan lewat Dart: yang memicunya justru keadaan saat
 * proses Dart sudah tidak ada.
 */
object NotifikasiHenti {
    private const val SALURAN = "pemantauan_terhenti"
    private const val ID = 7102

    private fun manajer(c: Context) = c.applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    fun tampilkan(context: Context) {
        val c = context.applicationContext
        val nm = manajer(c)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val saluran = NotificationChannel(SALURAN, "Pemantauan terhenti", NotificationManager.IMPORTANCE_HIGH)
            saluran.description = "Peringatan bila lokasi ponsel tidak terkirim lebih dari satu jam."
            nm.createNotificationChannel(saluran)
        }
        // Ketuk = buka aplikasi; begitu terbuka, pemantauan dinyalakan lagi.
        // CLEAR_TOP + SINGLE_TOP: layar lain di atas aplikasi (mis. pengaturan
        // baterai yang dibuka dari dialog penyiapan) ditutup dan MainActivity
        // yang ada dipakai lagi — bukan instans kedua yang berebut satu mesin.
        val buka = c.packageManager.getLaunchIntentForPackage(c.packageName)?.apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED or
                    Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            )
        }
        val tujuan = buka?.let {
            PendingIntent.getActivity(c, ID, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        }
        val judul = "Pemantauan lokasi terhenti"
        val isi = "Lokasi Anda belum terkirim lebih dari satu jam. Ketuk untuk membuka HRD Nusantara agar pengiriman berjalan lagi."
        @Suppress("DEPRECATION")
        val pembangun = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(c, SALURAN) else Notification.Builder(c)
        pembangun
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(judul)
            .setContentText(isi)
            .setStyle(Notification.BigTextStyle().bigText(isi))
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_STATUS)
        if (tujuan != null) pembangun.setContentIntent(tujuan)
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            @Suppress("DEPRECATION")
            pembangun.setPriority(Notification.PRIORITY_HIGH)
        }
        try {
            nm.notify(ID, pembangun.build())
        } catch (_: SecurityException) {
            // Izin notifikasi dicabut: tidak ada yang bisa ditampilkan.
        }
    }

    fun batalkan(context: Context) {
        manajer(context).cancel(ID)
    }
}
