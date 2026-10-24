import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../router.dart';
import '../auth/sesi_provider.dart';
import 'layanan_pemantauan.dart';

/// Pengungkapan pemantauan di latar: karyawan menyetujuinya, lalu izin diminta,
/// sebelum Pemantauan Lokasi berjalan.
Future<void> tampilkanPemberitahuanPemantauan(BuildContext context, WidgetRef ref) async {
  final idPengguna = ref.read(penggunaProvider)?.id;
  if (idPengguna == null) return;
  final setuju = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => AlertDialog(
      icon: const Icon(Icons.share_location_rounded, size: 36),
      title: const Text('Pemantauan lokasi'),
      content: const SingleChildScrollView(
        child: Text(
          'HRD Nusantara mengumpulkan dan mengirim lokasi Anda kepada perusahaan untuk pemantauan karyawan, '
          'termasuk saat aplikasi ditutup atau tidak digunakan. '
          'Sesuai pengaturan perusahaan, pemantauan dapat berlangsung selama bekerja atau selama 24 jam, '
          'termasuk di luar jam kerja. Notifikasi ditampilkan selama pemantauan berjalan. '
          'Anda dapat menarik persetujuan dan menghentikan pemantauan melalui menu Kebijakan privasi di Profil.',
        ),
      ),
      actions: [
        TextButton.icon(onPressed: () => Navigator.pop(ctx, false), icon: const Icon(Icons.schedule), label: const Text('Nanti')),
        FilledButton.icon(onPressed: () => Navigator.pop(ctx, true), icon: const Icon(Icons.check), label: const Text('Setuju & lanjut')),
      ],
    ),
  );
  // Jawaban hanya berlaku untuk karyawan yang melihat pengungkapan ini.
  if (!context.mounted || !ref.context.mounted || ref.read(penggunaProvider)?.id != idPengguna) return;
  if (setuju == true) {
    await ref.read(pemantauLokasiProvider.notifier).setujui();
  } else {
    ref.read(pemantauLokasiProvider.notifier).tunda();
  }
}

/// Memunculkan pemberitahuan begitu Super Admin mengaktifkan pemantauan dan
/// karyawan belum membacanya. Izin diminta melalui dialog bawaan sistem oleh
/// layanan lokasi dan notifikasi, tanpa popup penyiapan ponsel tambahan.
/// Dipasang di MaterialApp.builder, jadi dialog dibuka lewat Navigator akar router.
///
/// Diperiksa saat keadaannya berubah, saat layar pertama tampil, dan setiap
/// aplikasi kembali ke depan: pemantauan hidup lebih lama dari layarnya
/// (lihat MesinFlutter.kt), jadi keadaan yang menuntut dialog bisa sudah ada
/// sebelum widget ini terpasang. Tidak pernah saat aplikasi tidak di depan.
class PendengarPemantauan extends ConsumerStatefulWidget {
  const PendengarPemantauan({super.key, required this.child});
  final Widget child;

  @override
  ConsumerState<PendengarPemantauan> createState() => _PendengarPemantauanState();
}

class _PendengarPemantauanState extends ConsumerState<PendengarPemantauan> with WidgetsBindingObserver {
  bool _dialogTerbuka = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _periksa());
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _periksa();
  }

  void _periksa() {
    // Hanya saat aplikasi benar-benar di depan. Mesin tanpa layar (setelah
    // restart) belum punya status siklus sama sekali: dialog yang "tampil"
    // di sana tidak terlihat siapa pun, tetapi tercatat sudah ditawarkan.
    if (!mounted || _dialogTerbuka || WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed) return;
    if (ref.read(penggunaProvider) == null) return;
    final konteks = kunciNavigatorAkar.currentContext;
    if (konteks == null) return;
    final s = ref.read(pemantauLokasiProvider);
    if (s.perluPersetujuan) {
      unawaited(_tampilkan(() => tampilkanPemberitahuanPemantauan(konteks, ref)));
    }
  }

  Future<void> _tampilkan(Future<void> Function() dialog) async {
    _dialogTerbuka = true;
    try {
      await dialog();
    } finally {
      _dialogTerbuka = false;
    }
    // Periksa lagi bila keadaan persetujuan berubah selama dialog terbuka.
    if (mounted) _periksa();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(pemantauLokasiProvider.select((s) => s.perluPersetujuan), (_, _) => _periksa());
    return widget.child;
  }
}
