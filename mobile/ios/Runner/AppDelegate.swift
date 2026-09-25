import Flutter
import UIKit
import CoreLocation

@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private var pemeriksaLokasi: PemeriksaLokasi?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)
    // Sinyal integritas perangkat untuk deteksi fake GPS (jailbreak, simulator,
    // lokasi yang disimulasikan perangkat lunak per iOS 15).
    let kanal = FlutterMethodChannel(name: "id.nusantara.hrd/integritas", binaryMessenger: engineBridge.pluginRegistry.registrar(forPlugin: "integritas")!.messenger())
    kanal.setMethodCallHandler { [weak self] call, result in
      // Bukti jam presensi offline: mach_continuous_time tetap berjalan saat
      // ponsel tidur dan tidak ikut berubah bila jam ponsel diputar. iOS tidak
      // punya hitungan boot; Dart memeriksa nyala ulang dari jam dinding.
      if call.method == "jamMonotonik" {
        var basis = mach_timebase_info_data_t()
        mach_timebase_info(&basis)
        let nanodetik = mach_continuous_time() * UInt64(basis.numer) / UInt64(basis.denom)
        result(["monotonikMs": Int(nanodetik / 1_000_000)])
        return
      }
      guard call.method == "periksa" else { result(FlutterMethodNotImplemented); return }
      let dasar: [String: Any] = [
        "platform": "ios",
        "developerOptions": false,
        "emulator": AppDelegate.simulator(),
        "rooted": AppDelegate.jailbroken(),
        "mockApps": [],
        "networkLocation": NSNull(),
      ]
      let pemeriksa = PemeriksaLokasi { simulasi in
        var hasil = dasar
        if let s = simulasi { hasil["locationSimulated"] = s }
        result(hasil)
        self?.pemeriksaLokasi = nil
      }
      self?.pemeriksaLokasi = pemeriksa
      pemeriksa.mulai()
    }
  }

  static func simulator() -> Bool {
    #if targetEnvironment(simulator)
    return true
    #else
    return false
    #endif
  }

  static func jailbroken() -> Bool {
    #if targetEnvironment(simulator)
    return false
    #else
    let jalur = ["/Applications/Cydia.app", "/Applications/Sileo.app", "/Library/MobileSubstrate/MobileSubstrate.dylib",
                 "/bin/bash", "/usr/sbin/sshd", "/etc/apt", "/private/var/lib/apt/", "/usr/bin/ssh", "/var/jb"]
    if jalur.contains(where: { FileManager.default.fileExists(atPath: $0) }) { return true }
    if let url = URL(string: "cydia://package/com.example"), UIApplication.shared.canOpenURL(url) { return true }
    do {
      try "uji".write(toFile: "/private/jailbreak.txt", atomically: true, encoding: .utf8)
      try FileManager.default.removeItem(atPath: "/private/jailbreak.txt")
      return true
    } catch { return false }
    #endif
  }
}

/// Mengambil satu pembacaan lokasi untuk membaca CLLocationSourceInformation
/// (iOS 15+): apakah lokasi disimulasikan perangkat lunak atau aksesori luar.
class PemeriksaLokasi: NSObject, CLLocationManagerDelegate {
  private let manajer = CLLocationManager()
  private let selesai: (Bool?) -> Void
  private var sudah = false

  init(selesai: @escaping (Bool?) -> Void) {
    self.selesai = selesai
    super.init()
    manajer.delegate = self
    manajer.desiredAccuracy = kCLLocationAccuracyHundredMeters
  }

  func mulai() {
    let status = manajer.authorizationStatus
    guard status == .authorizedWhenInUse || status == .authorizedAlways else { tuntaskan(nil); return }
    manajer.requestLocation()
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.tuntaskan(nil) }
  }

  private func tuntaskan(_ nilai: Bool?) {
    if sudah { return }
    sudah = true
    selesai(nilai)
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let l = locations.last else { tuntaskan(nil); return }
    if #available(iOS 15.0, *), let info = l.sourceInformation {
      tuntaskan(info.isSimulatedBySoftware || info.isProducedByAccessory)
    } else {
      tuntaskan(false)
    }
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { tuntaskan(nil) }
}
