package id.nusantara.hrd.hrd_nusantara

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build

/**
 * Setelah ponsel dinyalakan ulang (atau aplikasi diperbarui), alarm sudah
 * hilang dan proses aplikasi belum ada. Dua hal dikerjakan, keduanya usaha
 * terbaik:
 *
 * 1. Alarm "pemantauan berhenti" dipasang lagi, jadi bila langkah 2 gagal
 *    atau tidak dijalankan, karyawan tetap diingatkan.
 * 2. Bila izin lokasi "Izinkan sepanjang waktu" diberikan, mesin Flutter
 *    dinyalakan tanpa layar; Dart (PemantauLokasi) membaca keadaan tersimpan
 *    dan menjalankan pengambilan lokasi lagi. Tanpa izin itu Android 12+
 *    menolak layanan lokasi yang dimulai tanpa layar, jadi mesin tidak
 *    dinyalakan — pemantauan menunggu aplikasi dibuka.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val aksi = intent.action
        if (aksi != Intent.ACTION_BOOT_COMPLETED && aksi != Intent.ACTION_MY_PACKAGE_REPLACED) return
        if (!PrefsPemantauan.aktif(context)) return

        val menit = PrefsPemantauan.batasMenit(context)
        val batas = System.currentTimeMillis() + menit * 60_000L
        PrefsPemantauan.tandaiAktif(context, menit, batas)
        AlarmPemantauan.pasang(context, batas)

        if (!lokasiLatarDiizinkan(context)) return

        // Siaran ditahan sampai Dart melapor sudah memulai (atau menghentikan)
        // pemantauan: proses tanpa layanan latar depan dibekukan Android begitu
        // receiver selesai, sebelum Dart sempat memulai apa pun.
        // Ditahan sebelum mesin dibuat: jendela boot dihitung sejak siaran tiba.
        MesinFlutter.tahanBoot(goAsync(), TAHAN_MAKS_MS)
        try {
            MesinFlutter.dapatkan(context)
        } catch (e: Throwable) {
            MesinFlutter.selesaikanTahanBoot()
        }
    }

    private fun lokasiLatarDiizinkan(c: Context): Boolean {
        fun ada(izin: String) = c.checkSelfPermission(izin) == PackageManager.PERMISSION_GRANTED
        val depan = ada(Manifest.permission.ACCESS_FINE_LOCATION) || ada(Manifest.permission.ACCESS_COARSE_LOCATION)
        // Sebelum Android 10, izin lokasi biasa sudah berlaku di latar.
        return depan && (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || ada(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
    }

    private companion object {
        /** Jauh di bawah batas 60 detik siaran latar; biasanya selesai dalam beberapa detik. */
        const val TAHAN_MAKS_MS = 25_000L
    }
}
