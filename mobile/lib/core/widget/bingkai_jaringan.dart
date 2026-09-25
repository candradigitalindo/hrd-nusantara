import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/status_jaringan.dart';
import '../format.dart';

/// Membungkus seluruh aplikasi (MaterialApp.builder). Pita di atas layar
/// muncul selama offline — memberi tahu bahwa yang tampil adalah data
/// tersimpan dan sejak kapan — atau selama ada kiriman yang ditolak server.
///
/// [menunggu]/[ditolak] adalah isi antrean kirim; mengetuk pita membuka
/// antrean lewat [bukaAntrean].
///
/// Susunan widget sengaja sama saat pita tampil maupun tidak — kalau [child]
/// (Navigator) berpindah posisi di pohon widget, tumpukan halamannya hilang
/// dan pengguna terlempar ke beranda setiap kali sinyal putus.
class BingkaiJaringan extends ConsumerWidget {
  const BingkaiJaringan({super.key, required this.child, this.menunggu = 0, this.ditolak = 0, this.bukaAntrean});
  final Widget child;
  final int menunggu;
  final int ditolak;
  final VoidCallback? bukaAntrean;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(statusJaringanProvider);
    final tampil = !status.terhubung || ditolak > 0;
    return Column(
      children: [
        if (!status.terhubung)
          PitaOffline(dataPer: status.dataPer, menunggu: menunggu, ditolak: ditolak, bukaAntrean: bukaAntrean)
        else if (ditolak > 0)
          _PitaDitolak(jumlah: ditolak, bukaAntrean: bukaAntrean)
        else
          const SizedBox.shrink(),
        Expanded(
          // Pita sudah menempati ruang bilah status; layar di bawahnya tidak
          // perlu memberi jarak atas lagi.
          child: MediaQuery.removePadding(context: context, removeTop: tampil, child: child),
        ),
      ],
    );
  }
}

class _Pita extends StatelessWidget {
  const _Pita({required this.warna, required this.latar, required this.ikon, required this.isi, this.tombol, this.diketuk});
  final Color warna;
  final Color latar;
  final IconData ikon;
  final InlineSpan isi;
  final Widget? tombol;
  final VoidCallback? diketuk;

  @override
  Widget build(BuildContext context) => Material(
        color: latar,
        child: InkWell(
          onTap: diketuk,
          child: SafeArea(
            bottom: false,
            child: Semantics(
              liveRegion: true,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 6, 8, 6),
                child: Row(
                  children: [
                    Icon(ikon, size: 20, color: warna),
                    const SizedBox(width: 10),
                    Expanded(child: Text.rich(isi, style: TextStyle(color: warna, fontSize: 13))),
                    ?tombol,
                  ],
                ),
              ),
            ),
          ),
        ),
      );
}

String _antrean(int menunggu, int ditolak) => [
      if (menunggu > 0) '$menunggu menunggu terkirim',
      if (ditolak > 0) '$ditolak ditolak',
    ].map((s) => ' · $s').join();

class PitaOffline extends ConsumerStatefulWidget {
  const PitaOffline({super.key, this.dataPer, this.menunggu = 0, this.ditolak = 0, this.bukaAntrean});
  final DateTime? dataPer;
  final int menunggu;
  final int ditolak;
  final VoidCallback? bukaAntrean;

  @override
  ConsumerState<PitaOffline> createState() => _PitaOfflineState();
}

class _PitaOfflineState extends ConsumerState<PitaOffline> {
  bool _memeriksa = false;

  Future<void> _cobaLagi() async {
    setState(() => _memeriksa = true);
    await ref.read(statusJaringanProvider.notifier).periksaSekarang();
    if (mounted) setState(() => _memeriksa = false);
  }

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final warna = skema.onSecondaryContainer;
    final t = widget.dataPer;
    final sekarang = DateTime.now();
    final rincian = t == null
        ? 'Tidak terhubung ke server'
        : 'Menampilkan data tersimpan ${t.year == sekarang.year && t.month == sekarang.month && t.day == sekarang.day ? 'pukul ${formatWaktu(t)}' : formatTanggal(t, pola: 'd MMM, HH:mm')}';
    final adaAntrean = widget.menunggu + widget.ditolak > 0;
    return _Pita(
      warna: warna,
      latar: skema.secondaryContainer,
      ikon: Icons.cloud_off_rounded,
      diketuk: adaAntrean ? widget.bukaAntrean : null,
      isi: TextSpan(children: [
        const TextSpan(text: 'Offline', style: TextStyle(fontWeight: FontWeight.w700)),
        TextSpan(text: ' · $rincian${_antrean(widget.menunggu, widget.ditolak)}'),
      ]),
      tombol: TextButton.icon(
        onPressed: _memeriksa ? null : _cobaLagi,
        style: TextButton.styleFrom(foregroundColor: warna, visualDensity: VisualDensity.compact),
        icon: _memeriksa
            ? SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2, color: warna))
            : const Icon(Icons.refresh_rounded, size: 18),
        label: const Text('Coba lagi'),
      ),
    );
  }
}

class _PitaDitolak extends StatelessWidget {
  const _PitaDitolak({required this.jumlah, this.bukaAntrean});
  final int jumlah;
  final VoidCallback? bukaAntrean;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return _Pita(
      warna: skema.onErrorContainer,
      latar: skema.errorContainer,
      ikon: Icons.error_outline_rounded,
      diketuk: bukaAntrean,
      isi: TextSpan(children: [
        TextSpan(text: '$jumlah kiriman ditolak server', style: const TextStyle(fontWeight: FontWeight.w700)),
        const TextSpan(text: ' · perlu diperiksa'),
      ]),
      tombol: bukaAntrean == null
          ? null
          : TextButton.icon(
              onPressed: bukaAntrean,
              style: TextButton.styleFrom(foregroundColor: skema.onErrorContainer, visualDensity: VisualDensity.compact),
              icon: const Icon(Icons.chevron_right_rounded, size: 18),
              label: const Text('Lihat'),
            ),
    );
  }
}
