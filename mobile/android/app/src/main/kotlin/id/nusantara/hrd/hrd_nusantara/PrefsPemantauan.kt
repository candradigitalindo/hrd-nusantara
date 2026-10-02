package id.nusantara.hrd.hrd_nusantara

import android.content.Context

/**
 * Keadaan Pemantauan Lokasi yang harus terbaca tanpa Dart: alarm "berhenti"
 * dan penerima boot berjalan di proses yang belum tentu punya mesin Flutter.
 * Hanya ditulis lewat [KanalNative] (dari Dart) dan dua penerima di bawah.
 */
object PrefsPemantauan {
    private const val BERKAS = "pemantauan"
    private const val AKTIF = "aktif"
    private const val BATAS_MENIT = "batasMenit"
    private const val BATAS_WAKTU = "batasWaktu"
    private const val DIINGATKAN = "diingatkan"

    private fun prefs(c: Context) = c.applicationContext.getSharedPreferences(BERKAS, Context.MODE_PRIVATE)

    /** Pemantauan seharusnya berjalan (tertulis oleh Dart; hilang hanya saat dihentikan dengan sengaja). */
    fun aktif(c: Context): Boolean = prefs(c).getBoolean(AKTIF, false)

    fun batasMenit(c: Context): Int = prefs(c).getInt(BATAS_MENIT, 60)

    /** Kapan titik berikutnya paling lambat harus sudah datang (ms epoch). */
    fun batasWaktu(c: Context): Long = prefs(c).getLong(BATAS_WAKTU, 0L)

    /** Notifikasi "berhenti" untuk rangkaian henti yang sekarang sudah dikirim. */
    fun sudahDiingatkan(c: Context): Boolean = prefs(c).getBoolean(DIINGATKAN, false)

    fun tandaiAktif(c: Context, batasMenit: Int, batasWaktu: Long) {
        prefs(c).edit()
            .putBoolean(AKTIF, true)
            .putInt(BATAS_MENIT, batasMenit)
            .putLong(BATAS_WAKTU, batasWaktu)
            .putBoolean(DIINGATKAN, false)
            .apply()
    }

    fun tandaiDiingatkan(c: Context) {
        prefs(c).edit().putBoolean(DIINGATKAN, true).apply()
    }

    fun bersihkan(c: Context) {
        prefs(c).edit().clear().apply()
    }
}
