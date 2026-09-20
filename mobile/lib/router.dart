import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'fitur/auth/layar_login.dart';
import 'fitur/auth/sesi_provider.dart';
import 'fitur/beranda/cangkang.dart';
import 'fitur/beranda/layar_beranda.dart';
import 'fitur/chat/layar_chat.dart';
import 'fitur/cuti/layar_cuti.dart';
import 'fitur/gaji/layar_gaji.dart';
import 'fitur/jadwal/layar_jadwal.dart';
import 'fitur/pengumuman/layar_pengumuman.dart';
import 'fitur/presensi/layar_presensi.dart';
import 'fitur/profil/layar_profil.dart';
import 'fitur/survei/layar_survei.dart';
import 'fitur/whatsapp/layar_whatsapp.dart';

/// Jembatan: go_router butuh Listenable untuk mengevaluasi ulang redirect
/// saat status sesi berubah.
class _PemicuSesi extends ChangeNotifier {
  _PemicuSesi(Ref ref) {
    ref.listen(sesiProvider, (_, _) => notifyListeners());
  }
}

final routerProvider = Provider<GoRouter>((ref) {
  final pemicu = _PemicuSesi(ref);
  ref.onDispose(pemicu.dispose);
  return GoRouter(
    initialLocation: '/',
    refreshListenable: pemicu,
    redirect: (context, state) {
      final sesi = ref.read(sesiProvider);
      final diLogin = state.matchedLocation == '/login';
      final diMuat = state.matchedLocation == '/memuat';
      return switch (sesi) {
        SesiMemuat() => diMuat ? null : '/memuat',
        SesiKeluar() => diLogin ? null : '/login',
        SesiMasuk() => (diLogin || diMuat) ? '/' : null,
      };
    },
    routes: [
      GoRoute(path: '/memuat', builder: (_, _) => const Scaffold(body: Center(child: CircularProgressIndicator()))),
      GoRoute(path: '/login', builder: (_, _) => const LayarLogin()),
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => Cangkang(navigationShell: shell),
        branches: [
          StatefulShellBranch(routes: [GoRoute(path: '/', builder: (_, _) => const LayarBeranda())]),
          StatefulShellBranch(routes: [GoRoute(path: '/presensi', builder: (_, _) => const LayarPresensi())]),
          StatefulShellBranch(routes: [GoRoute(path: '/cuti', builder: (_, _) => const LayarCuti())]),
          StatefulShellBranch(routes: [GoRoute(path: '/gaji', builder: (_, _) => const LayarGaji())]),
          StatefulShellBranch(routes: [GoRoute(path: '/profil', builder: (_, _) => const LayarProfil())]),
        ],
      ),
      GoRoute(path: '/jadwal', builder: (_, _) => const LayarJadwal()),
      GoRoute(path: '/pengumuman', builder: (_, _) => const LayarPengumuman()),
      GoRoute(path: '/survei', builder: (_, _) => const LayarSurvei()),
      GoRoute(path: '/chat', builder: (_, _) => const LayarChat()),
      GoRoute(path: '/whatsapp', builder: (_, _) => const LayarWhatsApp()),
    ],
  );
});
