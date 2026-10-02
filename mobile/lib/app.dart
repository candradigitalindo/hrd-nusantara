import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/konfigurasi.dart';
import 'core/tema.dart';
import 'core/widget/bingkai_jaringan.dart';
import 'fitur/antrean/layar_antrean.dart';
import 'fitur/antrean/mesin_antrean.dart';
import 'fitur/auth/sesi_provider.dart';
import 'fitur/beranda/layar_beranda.dart' show dibukaUlangProvider;
import 'fitur/pemantauan/kanal_pemantauan.dart';
import 'fitur/pemantauan/layanan_pemantauan.dart';
import 'fitur/pemantauan/layar_pemantauan.dart';
import 'fitur/notifikasi/layanan_push.dart';
import 'router.dart';

class AplikasiHrd extends ConsumerStatefulWidget {
  const AplikasiHrd({super.key, required this.firebaseAktif});
  final bool firebaseAktif;

  @override
  ConsumerState<AplikasiHrd> createState() => _AplikasiHrdState();
}

class _AplikasiHrdState extends ConsumerState<AplikasiHrd> {
  late final AppLifecycleListener _siklus;

  /// Layar sempat ditutup sementara mesin Flutter tetap hidup.
  bool _dibukaUlang = false;

  @override
  void initState() {
    super.initState();
    // Daftarkan perangkat untuk push setiap kali sesi masuk (login atau pulih).
    ref.listenManual(sesiProvider, (sebelum, sesudah) {
      if (sesudah is SesiMasuk && sebelum is! SesiMasuk && widget.firebaseAktif) {
        final push = ref.read(layananPushProvider);
        push.saatDiketuk = (rute) => ref.read(routerProvider).push(rute);
        push.daftarkan();
      }
    }, fireImmediately: true);
    // Android: aplikasi ditutup (diusap / Kembali) tetapi mesin Flutter
    // dipertahankan agar Pemantauan Lokasi terus berjalan. Saat dibuka lagi,
    // karyawan mulai dari beranda, bukan dari layar yang tadi terbuka.
    ref.read(kanalPemantauanProvider).saatAktivitasDitutup(() {
      ref.read(pemantauLokasiProvider.notifier).aktivitasDitutup();
      kembaliKeBeranda(ref.read(routerProvider));
      _dibukaUlang = true;
    });
    _siklus = AppLifecycleListener(onResume: _saatDibukaUlang);
  }

  /// Aplikasi dibuka lagi setelah layarnya ditutup: data dimuat ulang seperti
  /// aplikasi yang baru dibuka, dan notifikasi push yang membukanya diarahkan.
  void _saatDibukaUlang() {
    if (!_dibukaUlang) return;
    _dibukaUlang = false;
    ref.read(dibukaUlangProvider.notifier).state++;
    if (widget.firebaseAktif) ref.read(layananPushProvider).bukaPesanAwal();
  }

  @override
  void dispose() {
    _siklus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: namaAplikasi,
      debugShowCheckedModeBanner: false,
      theme: temaTerang(),
      darkTheme: temaGelap(),
      // Bawaan terang, tidak mengikuti pengaturan sistem ponsel.
      themeMode: ThemeMode.light,
      locale: const Locale('id', 'ID'),
      supportedLocales: const [Locale('id', 'ID'), Locale('en', 'US')],
      localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      routerConfig: router,
      builder: (context, child) => PendengarPemantauan(
        child: PendengarAntrean(
          child: Consumer(
            builder: (context, ref, _) {
              final antrean = ref.watch(antreanProvider);
              return BingkaiJaringan(
                menunggu: antrean.menunggu,
                ditolak: antrean.gagal,
                bukaAntrean: () => router.push('/antrean'),
                child: child ?? const SizedBox.shrink(),
              );
            },
          ),
        ),
      ),
    );
  }
}
