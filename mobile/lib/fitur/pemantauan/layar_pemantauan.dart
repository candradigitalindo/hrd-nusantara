import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../router.dart';
import 'kanal_pemantauan.dart';
import 'layanan_pemantauan.dart';

String _cakupan(StatusPemantauan s) => s.konfigurasi?.selamaBekerja == true ? 'selama Anda check-in' : '24 jam sehari';

/// Pemberitahuan Pemantauan Lokasi: apa yang dikirim, seberapa sering, dan
/// siapa yang bisa melihatnya. Karyawan membacanya sebelum pemantauan jalan.
Future<void> tampilkanPemberitahuanPemantauan(BuildContext context, WidgetRef ref) async {
  final s = ref.read(pemantauLokasiProvider);
  final setuju = await showDialog<bool>(
    context: context,
    barrierDismissible: false,
    builder: (ctx) => AlertDialog(
      icon: const Icon(Icons.share_location_rounded, size: 36),
      title: const Text('Akses Lokasi'),
      // Kalimat pertama tentang absensi — alasan utama karyawan memberi izin
      // lokasi. Pemantauan berkala tetap disebut apa adanya (cakupan, interval,
      // siapa yang melihat): teks yang menyembunyikannya membuat persetujuan
      // ini tidak sah dan bertentangan dengan notifikasi "Pemantauan lokasi
      // aktif" yang tetap tampil di ponsel.
      content: Text(
        'Aplikasi memakai lokasi ponsel untuk memastikan absensi dilakukan di lokasi kerja.\n\n'
        'Perusahaan juga mengaktifkan pemantauan lokasi: ${_cakupan(s)}, lokasi Anda dikirim '
        'ke HRD Nusantara setiap ${s.konfigurasi?.intervalMenit ?? 20} menit — juga saat aplikasi tidak dibuka. '
        'Hanya Super Admin yang dapat melihatnya, dan datanya disimpan sesuai kebijakan perusahaan. '
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

/// Penyiapan agar pemantauan bertahan saat aplikasi ditutup: izin notifikasi,
/// pengecualian penghemat baterai, dan lokasi "sepanjang waktu". Ditawarkan
/// sesudah izin lokasi diberikan, paling sering sekali per [jedaPenyiapan].
Future<void> tampilkanPenyiapanPemantauan(BuildContext context, WidgetRef ref) async {
  await ref.read(pemantauLokasiProvider.notifier).catatPenyiapanDitampilkan();
  if (!context.mounted) return;
  await showDialog<void>(context: context, builder: (_) => const DialogPenyiapanPemantauan());
}

class DialogPenyiapanPemantauan extends ConsumerStatefulWidget {
  const DialogPenyiapanPemantauan({super.key});

  @override
  ConsumerState<DialogPenyiapanPemantauan> createState() => _DialogPenyiapanPemantauanState();
}

class _DialogPenyiapanPemantauanState extends ConsumerState<DialogPenyiapanPemantauan> {
  LangkahPenyiapan? _sibuk;

  /// Baris notifikasi hanya ada bila izinnya kurang saat dialog dibuka, lalu
  /// tetap tampil (tercentang) setelah diizinkan — seperti baris lainnya.
  late final bool _adaBarisNotifikasi = ref.read(pemantauLokasiProvider).penyiapan?.notifikasi == false;

  // Sistem berhenti menampilkan dialog izin setelah beberapa penolakan; tombol
  // yang sama kemudian membuka pengaturan, supaya tidak pernah jadi tombol mati.
  int _mintaNotifikasi = 0;
  int _mintaLokasi = 0;

  Future<void> _atur(LangkahPenyiapan langkah) async {
    if (_sibuk != null) return;
    setState(() => _sibuk = langkah);
    final pemantau = ref.read(pemantauLokasiProvider.notifier);
    final kanal = ref.read(kanalPemantauanProvider);
    try {
      switch (langkah) {
        case LangkahPenyiapan.notifikasi:
          if (_mintaNotifikasi++ == 0) {
            await kanal.mintaIzinNotifikasi();
          } else {
            await kanal.bukaPengaturanNotifikasi();
          }
        case LangkahPenyiapan.baterai:
          await kanal.mintaPengecualianBaterai();
        case LangkahPenyiapan.sepanjangWaktu:
          final izin = await ref.read(izinLokasiProvider).tingkatkan();
          if (izin != 'granted_always' && _mintaLokasi++ > 0) await Geolocator.openAppSettings();
      }
    } finally {
      if (mounted) setState(() => _sibuk = null);
    }
    // Layar sistem baru ditutup (atau baru dibuka, untuk pengecualian baterai):
    // baca ulang yang bisa dibaca sekarang; sisanya menyusul saat aplikasi
    // kembali ke depan.
    await pemantau.segarkanPenyiapan();
    unawaited(pemantau.segarkan());
  }

  @override
  Widget build(BuildContext context) {
    final s = ref.watch(pemantauLokasiProvider);
    final kurang = s.langkahKurang;
    final langkah = [
      if (_adaBarisNotifikasi || s.penyiapan?.notifikasi == false) LangkahPenyiapan.notifikasi,
      LangkahPenyiapan.baterai,
      LangkahPenyiapan.sepanjangWaktu,
    ];
    return AlertDialog(
      icon: const Icon(Icons.battery_charging_full_rounded, size: 36),
      title: const Text('Agar pemantauan tidak terputus'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Android sering menghentikan aplikasi yang berjalan di latar, sehingga lokasi berhenti terkirim. '
              'Atur hal berikut agar pemantauan yang sudah Anda setujui tidak terputus.',
            ),
            const SizedBox(height: 8),
            for (final l in langkah)
              _BarisLangkah(
                langkah: l,
                selesai: !kurang.contains(l),
                sibuk: _sibuk == l,
                aksi: _sibuk == null ? () => _atur(l) : null,
              ),
          ],
        ),
      ),
      actions: [
        FilledButton(onPressed: () => Navigator.pop(context), child: Text(kurang.isEmpty ? 'Selesai' : 'Nanti saja')),
      ],
    );
  }
}

class _BarisLangkah extends StatelessWidget {
  const _BarisLangkah({required this.langkah, required this.selesai, required this.sibuk, required this.aksi});
  final LangkahPenyiapan langkah;
  final bool selesai;
  final bool sibuk;
  final VoidCallback? aksi;

  static (String, String) _teks(LangkahPenyiapan l) => switch (l) {
        LangkahPenyiapan.notifikasi => (
            'Izinkan notifikasi',
            'Agar notifikasi "Pemantauan lokasi aktif" dan peringatan bila pengiriman lokasi terhenti terlihat.',
          ),
        LangkahPenyiapan.baterai => (
            'Tanpa pembatasan baterai',
            'Mencegah sistem menghentikan pengiriman lokasi saat layar mati atau aplikasi ditutup.',
          ),
        LangkahPenyiapan.sepanjangWaktu => (
            'Lokasi "sepanjang waktu"',
            'Pilih "Izinkan sepanjang waktu" agar lokasi tetap terkirim saat aplikasi ditutup dan setelah ponsel dinyalakan ulang.',
          ),
      };

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final (judul, keterangan) = _teks(langkah);
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Icon(selesai ? Icons.check_circle_rounded : Icons.radio_button_unchecked, color: selesai ? skema.primary : skema.outline),
      title: Text(judul),
      subtitle: Text(keterangan),
      trailing: selesai
          ? null
          : sibuk
              ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2))
              : TextButton(onPressed: aksi, child: const Text('Atur')),
    );
  }
}

/// Memunculkan pemberitahuan begitu Super Admin mengaktifkan pemantauan dan
/// karyawan belum membacanya, lalu penyiapan agar pemantauan bertahan di latar.
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
    final konteks = kunciNavigatorAkar.currentContext;
    if (konteks == null) return;
    final s = ref.read(pemantauLokasiProvider);
    if (s.perluPersetujuan) {
      unawaited(_tampilkan(() => tampilkanPemberitahuanPemantauan(konteks, ref)));
    } else if (s.perluPenyiapan) {
      unawaited(_tampilkan(() => tampilkanPenyiapanPemantauan(konteks, ref)));
    }
  }

  Future<void> _tampilkan(Future<void> Function() dialog) async {
    _dialogTerbuka = true;
    try {
      await dialog();
    } finally {
      _dialogTerbuka = false;
    }
    // Giliran berikutnya (mis. penyiapan sesudah persetujuan).
    if (mounted) _periksa();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(pemantauLokasiProvider.select((s) => (s.perluPersetujuan, s.perluPenyiapan)), (_, _) => _periksa());
    return widget.child;
  }
}
