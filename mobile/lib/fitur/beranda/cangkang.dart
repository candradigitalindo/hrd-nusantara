import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../auth/sesi_provider.dart';

/// Tab bawah beserta cabang router-nya dan izin menu yang membukanya.
/// Beranda dan Profil selalu ada; sisanya mengikuti peran pengguna.
class _Tab {
  const _Tab(this.cabang, this.tujuan, [this.izin]);
  final int cabang;
  final NavigationDestination tujuan;
  final String? izin;
}

const _semuaTab = [
  _Tab(
    0,
    NavigationDestination(
      icon: Icon(Icons.home_outlined),
      selectedIcon: Icon(Icons.home),
      label: 'Beranda',
    ),
  ),
  _Tab(
    1,
    NavigationDestination(
      icon: Icon(Icons.fingerprint),
      selectedIcon: Icon(Icons.fingerprint),
      label: 'Presensi',
    ),
    'halaman.presensi',
  ),
  _Tab(
    2,
    NavigationDestination(
      icon: Icon(Icons.beach_access_outlined),
      selectedIcon: Icon(Icons.beach_access),
      label: 'Cuti',
    ),
    'halaman.cuti',
  ),
  _Tab(
    3,
    NavigationDestination(
      icon: Icon(Icons.receipt_long_outlined),
      selectedIcon: Icon(Icons.receipt_long),
      label: 'Gaji',
    ),
    'halaman.gaji',
  ),
  _Tab(
    4,
    NavigationDestination(
      icon: Icon(Icons.person_outline),
      selectedIcon: Icon(Icons.person),
      label: 'Profil',
    ),
  ),
];

/// Kerangka dengan navigasi bawah; tiap tab punya tumpukan sendiri.
/// Tab yang menunya tidak termasuk peran pengguna tidak ditampilkan.
class Cangkang extends ConsumerWidget {
  const Cangkang({super.key, required this.navigationShell});
  final StatefulNavigationShell navigationShell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(penggunaProvider);
    final tab = _semuaTab
        .where((t) => t.izin == null || p == null || p.punyaIzin(t.izin!))
        .toList();
    final terpilih = tab.indexWhere(
      (t) => t.cabang == navigationShell.currentIndex,
    );
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: terpilih < 0 ? 0 : terpilih,
        onDestinationSelected: (i) => navigationShell.goBranch(
          tab[i].cabang,
          initialLocation: tab[i].cabang == navigationShell.currentIndex,
        ),
        destinations: [for (final t in tab) t.tujuan],
      ),
    );
  }
}
