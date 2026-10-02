package id.nusantara.hrd.hrd_nusantara

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KeputusanPengingatTest {
    private val menit = 60_000L
    private val batas = 1_000_000_000L

    @Test
    fun `batas minimal satu jam, atau dua kali interval bila interval panjang`() {
        assertEquals(60, KeputusanPengingat.batasMenit(1))
        assertEquals(60, KeputusanPengingat.batasMenit(15))
        assertEquals(60, KeputusanPengingat.batasMenit(30))
        assertEquals(120, KeputusanPengingat.batasMenit(60))
        assertEquals(480, KeputusanPengingat.batasMenit(240))
    }

    @Test
    fun `berbunyi bila sudah lewat batas dan belum pernah diingatkan`() {
        assertTrue(KeputusanPengingat.perluMengingatkan(aktif = true, sudahDiingatkan = false, sekarang = batas + 5 * menit, batasWaktu = batas))
        assertTrue(KeputusanPengingat.perluMengingatkan(aktif = true, sudahDiingatkan = false, sekarang = batas, batasWaktu = batas))
    }

    @Test
    fun `alarm tak presisi yang tiba sedikit lebih awal tetap berbunyi, yang jauh lebih awal tidak`() {
        assertTrue(KeputusanPengingat.perluMengingatkan(true, false, sekarang = batas - 30_000L, batasWaktu = batas))
        assertFalse(KeputusanPengingat.perluMengingatkan(true, false, sekarang = batas - 10 * menit, batasWaktu = batas))
    }

    @Test
    fun `alarm tertinggal dari titik sebelumnya tidak berbunyi karena batas sudah digeser`() {
        // Titik baru memperpanjang batas satu jam; alarm lama yang masih sempat
        // menembak harus melihat batas yang baru dan diam.
        val batasBaru = batas + 60 * menit
        assertFalse(KeputusanPengingat.perluMengingatkan(true, false, sekarang = batas + menit, batasWaktu = batasBaru))
    }

    @Test
    fun `tidak berbunyi bila pemantauan sengaja dihentikan atau sudah diingatkan`() {
        assertFalse(KeputusanPengingat.perluMengingatkan(aktif = false, sudahDiingatkan = false, sekarang = batas + menit, batasWaktu = batas))
        assertFalse(KeputusanPengingat.perluMengingatkan(aktif = true, sudahDiingatkan = true, sekarang = batas + menit, batasWaktu = batas))
    }

    @Test
    fun `aliran yang dimulai ulang tidak memajukan batas yang masih berjalan`() {
        val sekarang = batas - 10 * menit
        assertEquals(batas, KeputusanPengingat.batasSaatMulai(aktif = true, batasLama = batas, menitLama = 60, menitBaru = 60, sekarang = sekarang))
        // Interval lebih pendek pun tidak memajukannya.
        assertEquals(batas, KeputusanPengingat.batasSaatMulai(aktif = true, batasLama = batas, menitLama = 120, menitBaru = 60, sekarang = sekarang))
    }

    @Test
    fun `interval baru yang lebih panjang memperpanjang batas sebanyak selisihnya`() {
        val sekarang = batas - 10 * menit
        assertEquals(batas + 420 * menit, KeputusanPengingat.batasSaatMulai(aktif = true, batasLama = batas, menitLama = 60, menitBaru = 480, sekarang = sekarang))
    }

    @Test
    fun `batas baru dibuat bila belum aktif atau batas lama sudah lewat`() {
        val sekarang = batas + 5 * menit
        assertEquals(sekarang + 60 * menit, KeputusanPengingat.batasSaatMulai(aktif = true, batasLama = batas, menitLama = 60, menitBaru = 60, sekarang = sekarang))
        assertEquals(batas - 10 * menit + 60 * menit, KeputusanPengingat.batasSaatMulai(aktif = false, batasLama = batas, menitLama = 60, menitBaru = 60, sekarang = batas - 10 * menit))
    }

    @Test
    fun `batas yang belum pernah diisi tidak membunyikan apa pun`() {
        assertFalse(KeputusanPengingat.perluMengingatkan(aktif = true, sudahDiingatkan = false, sekarang = batas, batasWaktu = 0L))
    }
}
