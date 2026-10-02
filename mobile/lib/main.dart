import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'app.dart';
import 'fitur/notifikasi/layanan_push.dart';
import 'fitur/pemantauan/layanan_pemantauan.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('id_ID');
  final firebaseAktif = await LayananPush.inisialisasiFirebase();
  // Di Android mesin Flutter bisa dinyalakan tanpa layar (setelah ponsel
  // restart) dan dipertahankan setelah aplikasi ditutup, supaya Pemantauan
  // Lokasi tetap berjalan. Pemantau dihidupkan di sini, tidak menunggu widget.
  final wadah = ProviderContainer();
  wadah.read(pemantauLokasiProvider);
  runApp(UncontrolledProviderScope(container: wadah, child: AplikasiHrd(firebaseAktif: firebaseAktif)));
}
