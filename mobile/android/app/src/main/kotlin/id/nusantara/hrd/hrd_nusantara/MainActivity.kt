package id.nusantara.hrd.hrd_nusantara

import android.content.Context
import android.os.Bundle
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

/**
 * Memakai mesin Flutter bersama ([MesinFlutter]) alih-alih mesin milik
 * Activity, supaya Pemantauan Lokasi tetap berjalan setelah aplikasi ditutup
 * (diusap dari daftar aplikasi, atau Kembali dari layar awal). Kanal native
 * (sinyal integritas dan pemantauan) dipasang di [KanalNative].
 */
class MainActivity : FlutterActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        MesinFlutter.pasangAktivitas(this)
        super.onCreate(savedInstanceState)
    }

    override fun provideFlutterEngine(context: Context): FlutterEngine? = MesinFlutter.dapatkan(context, flutterShellArgs.toArray())

    // Mesin dikelola MesinFlutter; FlutterActivity tidak boleh menghancurkannya sendiri.
    override fun shouldDestroyEngineWithHost(): Boolean = false

    override fun onDestroy() {
        super.onDestroy()
        MesinFlutter.aktivitasHancur(this)
    }
}
