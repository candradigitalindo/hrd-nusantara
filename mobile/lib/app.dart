import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/konfigurasi.dart';
import 'core/tema.dart';
import 'fitur/auth/sesi_provider.dart';
import 'fitur/notifikasi/layanan_push.dart';
import 'router.dart';

class AplikasiHrd extends ConsumerStatefulWidget {
  const AplikasiHrd({super.key, required this.firebaseAktif});
  final bool firebaseAktif;

  @override
  ConsumerState<AplikasiHrd> createState() => _AplikasiHrdState();
}

class _AplikasiHrdState extends ConsumerState<AplikasiHrd> {
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
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: namaAplikasi,
      debugShowCheckedModeBanner: false,
      theme: temaTerang(),
      darkTheme: temaGelap(),
      locale: const Locale('id', 'ID'),
      supportedLocales: const [Locale('id', 'ID'), Locale('en', 'US')],
      localizationsDelegates: const [GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      routerConfig: router,
    );
  }
}
