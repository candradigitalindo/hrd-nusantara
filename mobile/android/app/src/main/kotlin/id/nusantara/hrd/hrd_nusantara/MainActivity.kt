package id.nusantara.hrd.hrd_nusantara

import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File

/**
 * Sinyal integritas perangkat untuk deteksi fake GPS. Tidak ada satu sinyal
 * yang cukup; Dart menggabungkannya dan server yang memutuskan.
 */
class MainActivity : FlutterActivity() {
    private val kanal = "id.nusantara.hrd/integritas"

    /** Aplikasi lokasi palsu yang umum. Harus juga dideklarasikan di <queries> manifest. */
    private val aplikasiPalsuDikenal = listOf(
        "com.lexa.fakegps", "com.incorporateapps.fakegps.fre", "com.blogspot.newapphorizons.fakegps",
        "com.evezzon.fakegps", "com.theappninjas.gpsjoystick", "com.gsmartstudio.fakegps",
        "ru.gavrikov.mocklocations", "com.rosteam.gpsemulator", "com.lkr.fakelocation",
        "com.ninja.toolkit.pulse.fake.gps.pro", "com.fakegps.mock", "com.byterevapps.fakegps",
        "com.hola.fakelocation", "org.hola.gpslocation", "com.pe.fakegps", "com.dvaoru.fake.gps",
        "com.location.mock", "com.blackbox.mocklocation", "com.kokosoft.fake.gps", "com.xdadevelopers.mockgps",
    )

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, kanal).setMethodCallHandler { call, result ->
            when (call.method) {
                "periksa" -> result.success(
                    mapOf(
                        "platform" to "android",
                        "developerOptions" to opsiPengembangAktif(),
                        "emulator" to emulator(),
                        "rooted" to root(),
                        "mockApps" to aplikasiLokasiPalsu(),
                        "networkLocation" to lokasiJaringan(),
                    )
                )
                // Bukti jam presensi offline: jam monotonik tetap berjalan saat
                // ponsel tidur dan tidak ikut berubah bila jam ponsel diputar;
                // hitungan boot memberi tahu kalau ponsel sempat dinyalakan ulang.
                "jamMonotonik" -> result.success(
                    mapOf(
                        "monotonikMs" to SystemClock.elapsedRealtime(),
                        "hitunganBoot" to hitunganBoot(),
                    )
                )
                else -> result.notImplemented()
            }
        }
    }

    private fun hitunganBoot(): Int? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
        try { Settings.Global.getInt(contentResolver, Settings.Global.BOOT_COUNT) } catch (_: Exception) { null }
    } else null

    private fun opsiPengembangAktif(): Boolean = try {
        Settings.Global.getInt(contentResolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1
    } catch (_: Exception) { false }

    private fun emulator(): Boolean {
        val fp = Build.FINGERPRINT.lowercase(); val model = Build.MODEL.lowercase(); val produk = Build.PRODUCT.lowercase()
        val hw = Build.HARDWARE.lowercase(); val pabrik = Build.MANUFACTURER.lowercase(); val merek = Build.BRAND.lowercase()
        return fp.startsWith("generic") || fp.contains("emulator") || fp.contains("unknown") ||
            model.contains("emulator") || model.contains("android sdk built for") || model.contains("sdk_gphone") ||
            produk.contains("sdk") || produk.contains("emulator") || produk.contains("simulator") ||
            hw.contains("goldfish") || hw.contains("ranchu") || pabrik.contains("genymotion") ||
            (merek.startsWith("generic") && Build.DEVICE.lowercase().startsWith("generic"))
    }

    private fun root(): Boolean {
        if (Build.TAGS?.contains("test-keys") == true) return true
        val jalur = listOf(
            "/system/app/Superuser.apk", "/sbin/su", "/system/bin/su", "/system/xbin/su", "/data/local/xbin/su",
            "/data/local/bin/su", "/system/sd/xbin/su", "/system/bin/failsafe/su", "/data/local/su", "/su/bin/su",
            "/system/xbin/magisk", "/sbin/.magisk", "/data/adb/magisk",
        )
        if (jalur.any { File(it).exists() }) return true
        return try {
            val p = Runtime.getRuntime().exec(arrayOf("which", "su"))
            p.inputStream.bufferedReader().readLine() != null
        } catch (_: Exception) { false }
    }

    /**
     * Aplikasi yang meminta izin ACCESS_MOCK_LOCATION, atau termasuk daftar
     * aplikasi lokasi palsu yang dikenal. Di Android 11+ hanya paket yang
     * dideklarasikan di <queries> yang terlihat; daftar dikenal mengatasinya.
     */
    private fun aplikasiLokasiPalsu(): List<String> {
        val hasil = LinkedHashSet<String>()
        try {
            val pm = packageManager
            val paket = if (Build.VERSION.SDK_INT >= 33)
                pm.getInstalledPackages(PackageManager.PackageInfoFlags.of(PackageManager.GET_PERMISSIONS.toLong()))
            else @Suppress("DEPRECATION") pm.getInstalledPackages(PackageManager.GET_PERMISSIONS)
            for (p in paket) {
                if (p.packageName == packageName) continue
                if (p.requestedPermissions?.contains("android.permission.ACCESS_MOCK_LOCATION") == true) hasil.add(p.packageName)
            }
            for (nama in aplikasiPalsuDikenal) {
                try { pm.getPackageInfo(nama, 0); hasil.add(nama) } catch (_: PackageManager.NameNotFoundException) {}
            }
        } catch (_: Exception) {}
        return hasil.toList()
    }

    /** Lokasi terakhir dari jaringan seluler/Wi-Fi, pembanding untuk GPS yang dipalsukan. */
    private fun lokasiJaringan(): Map<String, Any>? = try {
        val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        @Suppress("MissingPermission")
        val l = if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER) else null
        if (l == null) null else mapOf(
            "latitude" to l.latitude, "longitude" to l.longitude, "accuracy" to l.accuracy.toDouble(),
            "ageSeconds" to ((System.currentTimeMillis() - l.time) / 1000.0),
            "mocked" to (if (Build.VERSION.SDK_INT >= 31) l.isMock else @Suppress("DEPRECATION") l.isFromMockProvider),
        )
    } catch (_: Exception) { null }
}
