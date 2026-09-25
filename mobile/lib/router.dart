import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'fitur/antrean/layar_antrean.dart';
import 'fitur/auth/layar_login.dart';
import 'fitur/auth/sesi_provider.dart';
import 'fitur/beranda/cangkang.dart';
import 'fitur/beranda/layar_beranda.dart';
import 'fitur/chat/layar_chat.dart';
import 'fitur/cuti/layar_cuti.dart';
import 'fitur/gaji/layar_gaji.dart';
import 'fitur/jadwal/layar_jadwal.dart';
import 'fitur/kasus/layar_kasus.dart';
import 'fitur/kinerja/layar_kinerja.dart';
import 'fitur/pelatihan/layar_pelatihan.dart';
import 'fitur/pengumuman/layar_pengumuman.dart';
import 'fitur/presensi/layar_presensi.dart';
import 'fitur/profil/layar_profil.dart' show LayarGantiPassword, LayarProfil;
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
      final diGantiSandi = state.matchedLocation == '/ganti-sandi';
      return switch (sesi) {
        SesiMemuat() => diMuat ? null : '/memuat',
        SesiKeluar() => diLogin ? null : '/login',
        // Sandi dari HR bersifat sementara: layar lain terkunci sampai diganti.
        SesiMasuk(pengguna: final p) when p.wajibGantiSandi => diGantiSandi ? null : '/ganti-sandi',
        SesiMasuk() => (diLogin || diMuat || diGantiSandi) ? '/' : null,
      };
    },
    routes: [
      GoRoute(path: '/memuat', builder: (_, _) => const Scaffold(body: Center(child: CircularProgressIndicator()))),
      GoRoute(path: '/login', builder: (_, _) => const LayarLogin()),
      GoRoute(path: '/ganti-sandi', builder: (_, _) => const LayarGantiPassword(wajib: true)),
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
      GoRoute(path: '/kinerja', builder: (_, _) => const LayarKinerja()),
      GoRoute(path: '/pelatihan', builder: (_, _) => const LayarPelatihan()),
      GoRoute(path: '/kasus', builder: (_, _) => const LayarKasus()),
      GoRoute(path: '/pengumuman', builder: (_, _) => const LayarPengumuman()),
      GoRoute(path: '/survei', builder: (_, _) => const LayarSurvei()),
      GoRoute(path: '/chat', builder: (_, _) => const LayarChat()),
      GoRoute(path: '/whatsapp', builder: (_, _) => const LayarWhatsApp()),
      GoRoute(path: '/antrean', builder: (_, _) => const LayarAntrean()),
    ],
  );
});
