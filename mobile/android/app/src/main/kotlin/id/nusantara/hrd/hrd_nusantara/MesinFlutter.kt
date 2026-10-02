package id.nusantara.hrd.hrd_nusantara

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.engine.dart.DartExecutor
import io.flutter.plugin.common.MethodChannel
import java.lang.ref.WeakReference

/**
 * Satu mesin Flutter yang dipertahankan selama Pemantauan Lokasi berjalan.
 *
 * Kenapa bukan mesin milik Activity (bawaan FlutterActivity): mesin itu
 * dihancurkan bersama Activity-nya, dan itu terjadi saat karyawan mengusap
 * aplikasi dari daftar aplikasi atau menekan Kembali dari layar awal. Plugin
 * lokasi memutus layanan latar depannya begitu mesinnya hancur, sehingga
 * pemantauan berhenti padahal prosesnya masih bisa hidup. Dengan mesin yang
 * dipertahankan, kode Dart (pengambilan titik, penyimpanan, pengiriman) terus
 * berjalan tanpa layar.
 *
 * Mesin juga bisa dibuat tanpa Activity sama sekali (setelah ponsel restart,
 * lihat [BootReceiver]); Activity yang dibuka kemudian memakai mesin yang sama.
 *
 * Semua fungsi dipanggil dari thread utama.
 */
object MesinFlutter {
    /**
     * Android memberi aplikasi yang dibangunkan siaran boot izin sementara
     * memulai layanan latar depan dari latar (20 detik di AOSP 14, dihitung
     * sejak siaran dikirim — sebelum proses aplikasi selesai dibuat); diambil
     * lebih pendek supaya Dart tidak mencoba di detik-detik terakhir.
     */
    private const val JENDELA_BOOT_MS = 15_000L

    private var mesin: FlutterEngine? = null
    private var aktivitas: WeakReference<Activity>? = null
    private var tahananBoot: BroadcastReceiver.PendingResult? = null
    private var tahananBootSejak = 0L

    /**
     * @param argumenShell argumen mesin dari Intent peluncur (mis. yang diteruskan
     *   `flutter run` saat debug); hanya dipakai saat mesin pertama dibuat.
     */
    fun dapatkan(context: Context, argumenShell: Array<String>? = null): FlutterEngine {
        mesin?.let { return it }
        val app = context.applicationContext
        // Konstruktornya mendaftarkan semua plugin (GeneratedPluginRegistrant).
        val baru = FlutterEngine(app, argumenShell)
        KanalNative.pasang(app, baru)
        baru.dartExecutor.executeDartEntrypoint(DartExecutor.DartEntrypoint.createDefault())
        mesin = baru
        return baru
    }

    /** Membuang mesin; yang berikutnya dibuat baru. */
    fun hancurkan() {
        mesin?.destroy()
        mesin = null
    }

    fun pasangAktivitas(a: Activity) {
        aktivitas = WeakReference(a)
    }

    fun aktivitasSaatIni(): Activity? = aktivitas?.get()

    /**
     * Activity ditutup. Mesin hanya dipertahankan bila pemantauan sedang
     * berjalan; selain itu perilakunya sama seperti FlutterActivity biasa.
     */
    fun aktivitasHancur(a: Activity) {
        // Activity yang lebih baru sudah memakai mesin ini (mis. peluncuran ulang
        // yang membuat instans baru sebelum yang lama dihancurkan): jangan disentuh.
        if (aktivitas?.get() !== a) return
        aktivitas = null
        // Dibuat ulang karena perubahan konfigurasi: instans baru langsung
        // memakai mesin ini lagi — jangan dihancurkan, jangan dikabarkan ditutup.
        if (a.isChangingConfigurations) return
        if (PrefsPemantauan.aktif(a.applicationContext)) kabarkanAktivitasDitutup() else hancurkan()
    }

    /**
     * BootReceiver menahan siarannya sampai Dart melapor pemantauan sudah
     * dimulai atau dihentikan (lihat KanalNative), paling lama [maksMs].
     * Selama ditahan, prosesnya tidak dianggap menganggur — tanpa ini Android
     * membekukannya sebelum Dart sempat memulai layanan lokasi.
     */
    fun tahanBoot(tunda: BroadcastReceiver.PendingResult, maksMs: Long) {
        selesaikanTahanBoot()
        tahananBoot = tunda
        tahananBootSejak = SystemClock.elapsedRealtime()
        Handler(Looper.getMainLooper()).postDelayed({ if (tahananBoot === tunda) selesaikanTahanBoot() }, maksMs)
    }

    fun selesaikanTahanBoot() {
        val tunda = tahananBoot ?: return
        tahananBoot = null
        tunda.finish()
    }

    /** Masih di jendela siaran boot: layanan latar depan boleh dimulai tanpa layar. */
    fun dalamJendelaBoot(): Boolean =
        tahananBoot != null && SystemClock.elapsedRealtime() - tahananBootSejak < JENDELA_BOOT_MS

    /** Pemantauan berhenti saat tak ada layar: mesinnya tak diperlukan lagi. */
    fun lepasBilaMenganggur(context: Context) {
        if (aktivitasSaatIni() == null && !PrefsPemantauan.aktif(context)) hancurkan()
    }

    /**
     * Memberi tahu Dart bahwa layarnya ditutup padahal mesin dipertahankan.
     * Dart menutup dialog dan layar yang bergantung pada Activity itu (mis.
     * kamera) supaya aplikasi yang dibuka lagi mulai dari beranda.
     */
    private fun kabarkanAktivitasDitutup() {
        val m = mesin ?: return
        MethodChannel(m.dartExecutor.binaryMessenger, KanalNative.KANAL_PEMANTAUAN).invokeMethod("aktivitasDitutup", null)
    }
}
