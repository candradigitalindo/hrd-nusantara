package id.nusantara.hrd.hrd_nusantara

/**
 * Aturan kapan notifikasi "pemantauan terhenti" boleh tampil. Dipisah dari
 * receiver supaya bisa diuji tanpa Android.
 */
object KeputusanPengingat {
    /** Alarm tak presisi boleh tiba sedikit lebih awal bila jam ponsel digeser. */
    const val TOLERANSI_MS = 60_000L

    private const val MENIT = 60_000L

    /** Batas minimal "berhenti": satu jam, atau dua kali interval bila interval panjang. */
    fun batasMenit(intervalMenit: Int): Int = maxOf(60, intervalMenit * 2)

    /**
     * Batas saat aliran lokasi (ulang) dimulai. Batas yang masih berjalan tidak
     * dimajukan — aliran yang terus dimulai ulang tanpa pernah menghasilkan
     * titik tidak boleh menunda pengingat selamanya — kecuali interval baru
     * lebih panjang: batasnya ikut diperpanjang sebanyak selisihnya.
     */
    fun batasSaatMulai(aktif: Boolean, batasLama: Long, menitLama: Int, menitBaru: Int, sekarang: Long): Long {
        if (!aktif || batasLama <= sekarang) return sekarang + menitBaru * MENIT
        return if (menitBaru > menitLama) batasLama + (menitBaru - menitLama) * MENIT else batasLama
    }

    /**
     * Tampilkan hanya bila pemantauan memang seharusnya berjalan ([aktif]),
     * belum diingatkan untuk rangkaian henti ini, dan titik yang ditunggu
     * benar-benar sudah lewat batasnya — alarm yang tertinggal dari titik
     * sebelumnya (sudah diganti titik yang lebih baru) tidak boleh berbunyi.
     */
    fun perluMengingatkan(aktif: Boolean, sudahDiingatkan: Boolean, sekarang: Long, batasWaktu: Long): Boolean =
        aktif && !sudahDiingatkan && batasWaktu > 0L && sekarang >= batasWaktu - TOLERANSI_MS
}
