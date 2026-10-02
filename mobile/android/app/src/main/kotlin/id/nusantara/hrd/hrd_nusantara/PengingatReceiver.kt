package id.nusantara.hrd.hrd_nusantara

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Alarm "pemantauan berhenti" berbunyi di sini. Alarm dipasang ulang setiap
 * titik lokasi diterima, jadi sampai di sini berarti sudah lewat batas tanpa
 * titik baru — proses aplikasinya mati, ditidurkan, atau layanan lokasinya
 * dihentikan sistem.
 */
class PengingatReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != AlarmPemantauan.AKSI) return
        val perlu = KeputusanPengingat.perluMengingatkan(
            aktif = PrefsPemantauan.aktif(context),
            sudahDiingatkan = PrefsPemantauan.sudahDiingatkan(context),
            sekarang = System.currentTimeMillis(),
            batasWaktu = PrefsPemantauan.batasWaktu(context),
        )
        if (!perlu) return
        NotifikasiHenti.tampilkan(context)
        PrefsPemantauan.tandaiDiingatkan(context)
    }
}
