package id.nusantara.hrd.hrd_nusantara

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

/**
 * Kanal Dart <-> Android. Dipasang sekali pada mesin Flutter bersama
 * ([MesinFlutter]) dan hanya memakai Context aplikasi, karena mesinnya bisa
 * berjalan tanpa Activity.
 */
object KanalNative {
    const val KANAL_INTEGRITAS = "id.nusantara.hrd/integritas"
    const val KANAL_PEMANTAUAN = "id.nusantara.hrd/pemantauan"

    fun pasang(app: Context, mesin: FlutterEngine) {
        val pesan = mesin.dartExecutor.binaryMessenger
        val integritas = SinyalIntegritas(app)
        MethodChannel(pesan, KANAL_INTEGRITAS).setMethodCallHandler(integritas::tangani)
        MethodChannel(pesan, KANAL_PEMANTAUAN).setMethodCallHandler { call, hasil -> tanganiPemantauan(app, call, hasil) }
    }

    private fun tanganiPemantauan(app: Context, call: MethodCall, hasil: MethodChannel.Result) {
        when (call.method) {
            // Aliran lokasi baru dimulai (layanan latar depan sudah diminta
            // sebelum pesan ini tiba): pastikan alarm "berhenti" terpasang,
            // tanpa memajukan batas yang masih berjalan dan tanpa menarik
            // notifikasi "terhenti" — itu hanya boleh dilakukan titik nyata.
            "mulai" -> {
                val interval = intervalDari(call, hasil) ?: return
                val menit = KeputusanPengingat.batasMenit(interval)
                val batas = KeputusanPengingat.batasSaatMulai(
                    aktif = PrefsPemantauan.aktif(app),
                    batasLama = PrefsPemantauan.batasWaktu(app),
                    menitLama = PrefsPemantauan.batasMenit(app),
                    menitBaru = menit,
                    sekarang = System.currentTimeMillis(),
                )
                PrefsPemantauan.tandaiAktif(app, menit, batas)
                // Dipasang ulang walau batasnya sama: alarm hilang bila aplikasi
                // pernah dihentikan paksa, sedangkan prefs-nya tetap.
                AlarmPemantauan.pasang(app, batas)
                hasil.success(null)
                Handler(Looper.getMainLooper()).postDelayed({ MesinFlutter.selesaikanTahanBoot() }, 1_000)
            }
            // Titik lokasi diterima: batas digeser, notifikasi "terhenti" ditarik.
            "denyut" -> {
                val interval = intervalDari(call, hasil) ?: return
                val menit = KeputusanPengingat.batasMenit(interval)
                val batas = System.currentTimeMillis() + menit * 60_000L
                PrefsPemantauan.tandaiAktif(app, menit, batas)
                AlarmPemantauan.pasang(app, batas)
                NotifikasiHenti.batalkan(app)
                hasil.success(null)
            }
            // Pemantauan dihentikan dengan sengaja (dimatikan admin, check-out,
            // keluar akun): tidak ada yang perlu diingatkan.
            "berhenti" -> {
                PrefsPemantauan.bersihkan(app)
                AlarmPemantauan.batal(app)
                NotifikasiHenti.batalkan(app)
                hasil.success(null)
                MesinFlutter.selesaikanTahanBoot()
                // Tanpa layar dan tanpa pemantauan, mesin tak ada gunanya lagi.
                Handler(Looper.getMainLooper()).post { MesinFlutter.lepasBilaMenganggur(app) }
            }
            "statusPenyiapan" -> hasil.success(
                mapOf(
                    "penghematBaterai" to bebasPenghematBaterai(app),
                    "notifikasi" to notifikasiDiizinkan(app),
                    "jendelaBoot" to MesinFlutter.dalamJendelaBoot(),
                )
            )
            "mintaPengecualianBaterai" -> hasil.success(mintaPengecualianBaterai(app))
            "bukaPengaturanNotifikasi" -> hasil.success(bukaPengaturanNotifikasi(app))
            else -> hasil.notImplemented()
        }
    }

    private fun intervalDari(call: MethodCall, hasil: MethodChannel.Result): Int? {
        val interval = call.argument<Int>("intervalMenit")
        if (interval == null || interval < 1) {
            hasil.error("ARGUMEN", "intervalMenit wajib berupa bilangan positif", null)
            return null
        }
        return interval
    }

    private fun bebasPenghematBaterai(app: Context): Boolean =
        (app.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(app.packageName)

    private fun notifikasiDiizinkan(app: Context): Boolean =
        (app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).areNotificationsEnabled()

    /**
     * Menampilkan dialog sistem "izinkan berjalan tanpa pembatasan baterai".
     * Bila layar itu tak tersedia di ponsel (sebagian OEM), daftar
     * pengecualian baterai yang dibuka. Hasilnya diketahui Dart dari
     * [bebasPenghematBaterai] saat aplikasi kembali ke depan.
     *
     * @return true bila sudah bebas atau sebuah layar berhasil dibuka.
     */
    private fun mintaPengecualianBaterai(app: Context): Boolean {
        if (bebasPenghematBaterai(app)) return true
        val langsung = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${app.packageName}"))
        return buka(app, langsung) || buka(app, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    /**
     * Halaman notifikasi aplikasi. Dipakai bila dialog izin Android 13+ sudah
     * ditolak dua kali: sistem tidak menampilkannya lagi, jadi tombolnya mati
     * kecuali karyawan diarahkan ke pengaturan.
     */
    private fun bukaPengaturanNotifikasi(app: Context): Boolean {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, app.packageName)
        } else {
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${app.packageName}"))
        }
        return buka(app, intent)
    }

    private fun buka(app: Context, intent: Intent): Boolean = try {
        val layar = MesinFlutter.aktivitasSaatIni()
        if (layar != null) layar.startActivity(intent) else app.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
    } catch (_: Exception) {
        false
    }
}
