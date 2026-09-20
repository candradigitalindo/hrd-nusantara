import 'package:firebase_core/firebase_core.dart';

/// PENGGANTI SEMENTARA — belum terhubung ke proyek Firebase.
///
/// Untuk mengaktifkan notifikasi push:
///   1. dart pub global activate flutterfire_cli
///   2. flutterfire configure --project=hrd-app-635cb   (pilih android, ios)
///      Perintah itu menimpa berkas ini dengan `DefaultFirebaseOptions` dan
///      menaruh google-services.json / GoogleService-Info.plist.
///   3. Ubah `firebaseTerkonfigurasi` menjadi true dan
///      `opsiFirebase()` menjadi `DefaultFirebaseOptions.currentPlatform`.
///
/// Tanpa ini aplikasi tetap berjalan penuh — hanya push yang tidak aktif.
const bool firebaseTerkonfigurasi = false;

FirebaseOptions? opsiFirebase() => null;
