import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/format.dart';
import '../../router.dart';
import 'layanan_pemantauan.dart';

String _cakupan(StatusPemantauan s) => s.konfigurasi?.selamaBekerja == true ? 'Selama Anda check-in' : '24 jam sehari';

/// Pemberitahuan Pemantauan Lokasi: apa yang dikirim, seberapa sering, dan
/// siapa yang bisa melihatnya. Karyawan membacanya sebelum pemantauan jalan.
Future<void> tampilkanPemberitahuanPemantauan(BuildContext context, WidgetRef ref) async {
  final s = ref.read(pemantauLokasiProvider);
  final setuju = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => AlertDialog(
      icon: const Icon(Icons.share_location_rounded, size: 36),
      title: const Text('Pemantauan Lokasi'),
      content: Text(
        'Perusahaan mengaktifkan pemantauan lokasi. ${_cakupan(s)}, aplikasi ini mengirim lokasi Anda '
        'ke HRD Nusantara setiap ${s.konfigurasi?.intervalMenit ?? 20} menit — juga saat aplikasi tidak dibuka.\n\n'
        'Lokasi hanya dapat dilihat oleh Super Admin dan disimpan sesuai kebijakan perusahaan. '
        'Selama pemantauan berjalan, notifikasi "Pemantauan lokasi aktif" tampil di ponsel Anda.\n\n'
        'Setelah ini ponsel akan meminta izin lokasi; pilih "Izinkan sepanjang waktu" bila tersedia.',
      ),
      actions: [
        TextButton.icon(onPressed: () => Navigator.pop(ctx, false), icon: const Icon(Icons.schedule), label: const Text('Nanti')),
        FilledButton.icon(onPressed: () => Navigator.pop(ctx, true), icon: const Icon(Icons.check), label: const Text('Saya mengerti')),
      ],
    ),
  );
  if (setuju == true) {
    await ref.read(pemantauLokasiProvider.notifier).setujui();
  } else {
    ref.read(pemantauLokasiProvider.notifier).tunda();
  }
}

/// Memunculkan pemberitahuan begitu Super Admin mengaktifkan pemantauan dan
/// karyawan belum membacanya. Dipasang di MaterialApp.builder, jadi dialog
/// dibuka lewat Navigator akar router.
class PendengarPemantauan extends ConsumerWidget {
  const PendengarPemantauan({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen(pemantauLokasiProvider.select((s) => s.perluPersetujuan), (_, perlu) {
      final konteks = kunciNavigatorAkar.currentContext;
      if (perlu && konteks != null) tampilkanPemberitahuanPemantauan(konteks, ref);
    });
    return child;
  }
}

/// Baris di Profil: keadaan pemantauan di ponsel ini.
class BarisPemantauan extends ConsumerWidget {
  const BarisPemantauan({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(pemantauLokasiProvider);
    if (!s.aktif) return const SizedBox.shrink();
    final skema = Theme.of(context).colorScheme;
    final (String keterangan, bool masalah, VoidCallback? aksi) = switch (s) {
      _ when s.setuju == false => ('Belum Anda setujui · ketuk untuk membaca', true, () => tampilkanPemberitahuanPemantauan(context, ref)),
      _ when s.izin == 'service_off' => ('Layanan lokasi ponsel mati', true, () => Geolocator.openLocationSettings()),
      _ when s.izinDitolak => ('Izin lokasi ditolak · ketuk untuk membuka pengaturan', true, () => Geolocator.openAppSettings()),
      _ when s.berjalan => (
          [
            '${_cakupan(s)} · tiap ${s.konfigurasi!.intervalMenit} menit',
            if (s.terakhirDiambil != null) 'terakhir ${formatWaktu(s.terakhirDiambil)}',
            if (s.tertunda > 0) '${s.tertunda} belum terkirim',
          ].join(' · '),
          false,
          null
        ),
      _ => ('${_cakupan(s)} · menunggu jam kerja', false, null),
    };
    return ListTile(
      leading: Icon(Icons.share_location_rounded, color: masalah ? skema.error : skema.primary),
      title: const Text('Pemantauan lokasi'),
      subtitle: Text(keterangan, style: masalah ? TextStyle(color: skema.error) : null),
      trailing: aksi == null ? null : const Icon(Icons.chevron_right),
      onTap: aksi,
    );
  }
}
