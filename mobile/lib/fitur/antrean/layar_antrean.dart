import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/status_jaringan.dart';
import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import 'mesin_antrean.dart';
import 'model_antrean.dart';

IconData ikonJenis(String jenis) => switch (jenis.split('-').first) {
      'presensi' => Icons.fingerprint,
      'cuti' => Icons.beach_access_outlined,
      'chat' => Icons.forum_outlined,
      'survei' => Icons.poll_outlined,
      'pengumuman' => Icons.campaign_outlined,
      'keluhan' => Icons.outlined_flag,
      _ => Icons.outbox_outlined,
    };

/// Kiriman yang belum sampai ke server: yang menunggu sinyal, dan yang
/// ditolak server beserta alasannya.
class LayarAntrean extends ConsumerWidget {
  const LayarAntrean({super.key});

  Future<void> _hapus(BuildContext context, WidgetRef ref, ItemAntrean item) async {
    final ya = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Buang kiriman ini?'),
        content: Text('"${item.judul}" tidak akan dikirim ke server.${item.gagal ? '' : ' Kiriman ini belum sempat terkirim.'}'),
        actions: [
          TextButton.icon(onPressed: () => Navigator.pop(ctx, false), icon: const Icon(Icons.close), label: const Text('Batal')),
          FilledButton.icon(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: Theme.of(ctx).colorScheme.error),
            icon: const Icon(Icons.delete_outline),
            label: const Text('Buang'),
          ),
        ],
      ),
    );
    if (ya == true) await ref.read(antreanProvider.notifier).hapus(item.id);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final antrean = ref.watch(antreanProvider);
    final terhubung = ref.watch(statusJaringanProvider.select((s) => s.terhubung));
    final skema = Theme.of(context).colorScheme;
    final mengirim = antrean.sedangDikirim != null;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Antrean kirim'),
        actions: [
          if (antrean.menunggu > 0)
            TextButton.icon(
              onPressed: mengirim ? null : () => ref.read(antreanProvider.notifier).kirimSekarang(),
              icon: mengirim ? const SizedBox(height: 16, width: 16, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send_rounded),
              label: const Text('Kirim sekarang'),
            ),
        ],
      ),
      body: antrean.item.isEmpty && antrean.milikAkunLain == 0
          ? const KeadaanKosong(
              ikon: Icons.cloud_done_outlined,
              judul: 'Semua data sudah terkirim',
              keterangan: 'Yang Anda kirim saat offline akan menunggu di sini sampai sinyal kembali.',
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
              children: [
                if (!terhubung && antrean.menunggu > 0)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(
                      'Ponsel sedang offline. Kiriman dikirim otomatis begitu tersambung, selama aplikasi terbuka.',
                      style: TextStyle(color: skema.onSurfaceVariant),
                    ),
                  ),
                if (antrean.item.isNotEmpty)
                  Card(
                    child: Column(
                      children: [
                        for (var i = 0; i < antrean.item.length; i++) ...[
                          if (i > 0) const Divider(height: 1),
                          _BarisKiriman(
                            item: antrean.item[i],
                            dikirim: antrean.sedangDikirim == antrean.item[i].id,
                            hapus: () => _hapus(context, ref, antrean.item[i]),
                            cobaLagi: () => ref.read(antreanProvider.notifier).cobaLagi(antrean.item[i].id),
                          ),
                        ],
                      ],
                    ),
                  ),
                if (antrean.milikAkunLain > 0)
                  Card(
                    child: ListTile(
                      leading: const Icon(Icons.people_outline),
                      title: Text('${antrean.milikAkunLain} kiriman milik akun lain'),
                      subtitle: const Text('Dikirim setelah akun itu masuk lagi di ponsel ini.'),
                    ),
                  ),
              ],
            ),
    );
  }
}

class _BarisKiriman extends StatelessWidget {
  const _BarisKiriman({required this.item, required this.dikirim, required this.hapus, required this.cobaLagi});
  final ItemAntrean item;
  final bool dikirim;
  final VoidCallback hapus;
  final VoidCallback cobaLagi;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final keterangan = [
      formatTanggal(item.dibuat, pola: 'd MMM, HH:mm'),
      if (!item.gagal && item.percobaan > 0) 'dicoba ${item.percobaan}×',
    ].join(' · ');
    return ListTile(
      leading: Icon(ikonJenis(item.jenis), color: item.gagal ? skema.error : skema.primary),
      title: Text(item.judul, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 4),
          Wrap(
            spacing: 8,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              LencanaStatus(null, label: dikirim ? 'Mengirim…' : (item.gagal ? 'Ditolak' : 'Menunggu'), nada: item.gagal ? Nada.bahaya : (dikirim ? Nada.info : Nada.peringatan)),
              Text(keterangan),
            ],
          ),
          if (item.galat != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                item.galat!,
                maxLines: item.gagal ? null : 2,
                overflow: item.gagal ? null : TextOverflow.ellipsis,
                style: TextStyle(color: item.gagal ? skema.error : skema.onSurfaceVariant),
              ),
            ),
        ],
      ),
      trailing: dikirim
          ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
          : PopupMenuButton<String>(
              tooltip: 'Tindakan',
              onSelected: (v) => v == 'ulang' ? cobaLagi() : hapus(),
              itemBuilder: (_) => [
                if (item.gagal) const PopupMenuItem(value: 'ulang', child: ListTile(leading: Icon(Icons.refresh), title: Text('Coba kirim lagi'))),
                const PopupMenuItem(value: 'hapus', child: ListTile(leading: Icon(Icons.delete_outline), title: Text('Buang'))),
              ],
            ),
    );
  }
}

/// Pesan untuk kiriman yang disimpan di antrean karena ponsel offline.
void tampilkanTertunda(BuildContext context, String apa) => tampilkanPesan(
      context,
      '$apa disimpan',
      rincian: 'Belum terkirim karena ponsel offline. Dikirim otomatis begitu tersambung; lihat Antrean kirim.',
      nada: Nada.info,
    );

/// Bagian "Belum terkirim" di layar sebuah fitur: kiriman jenis [jenis]
/// yang masih di antrean (atau ditolak), supaya pengguna tidak mengira
/// pengajuannya hilang. Mengetuknya membuka Antrean kirim.
class DaftarTertunda extends ConsumerWidget {
  const DaftarTertunda({super.key, required this.jenis});
  final Set<String> jenis;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final daftar = ref.watch(antreanProvider.select((s) => s.item.where((i) => jenis.contains(i.jenis)).toList()));
    if (daftar.isEmpty) return const SizedBox.shrink();
    final skema = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const JudulBagian('Belum terkirim'),
        Card(
          child: Column(
            children: [
              for (var i = 0; i < daftar.length; i++) ...[
                if (i > 0) const Divider(height: 1),
                ListTile(
                  leading: Icon(ikonJenis(daftar[i].jenis), color: daftar[i].gagal ? skema.error : skema.primary),
                  title: Text(daftar[i].judul, style: const TextStyle(fontWeight: FontWeight.w600)),
                  subtitle: Text(
                    daftar[i].gagal ? 'Ditolak: ${daftar[i].galat}' : 'Dikirim otomatis begitu tersambung',
                    style: daftar[i].gagal ? TextStyle(color: skema.error) : null,
                  ),
                  trailing: LencanaStatus(null, label: daftar[i].gagal ? 'Ditolak' : 'Menunggu', nada: daftar[i].gagal ? Nada.bahaya : Nada.peringatan),
                  onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => const LayarAntrean())),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

/// Memberi tahu hasil pengiriman antrean di layar mana pun yang sedang
/// terbuka. Dipasang di MaterialApp.builder.
class PendengarAntrean extends ConsumerWidget {
  const PendengarAntrean({super.key, required this.child});
  final Widget child;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.listen(antreanProvider.select((s) => s.laporan), (_, laporan) {
      if (laporan == null) return;
      if (laporan.gagal.isNotEmpty) {
        final g = laporan.gagal.first;
        tampilkanPesan(
          context,
          laporan.gagal.length == 1 ? '"${g.judul}" ditolak server' : '${laporan.gagal.length} kiriman ditolak server',
          rincian: laporan.gagal.length == 1 ? g.galat : 'Buka Antrean kirim untuk melihat alasannya.',
          nada: Nada.bahaya,
        );
      } else if (laporan.terkirim.isNotEmpty) {
        final t = laporan.terkirim;
        tampilkanPesan(
          context,
          t.length == 1 ? '"${t.first.judul}" terkirim' : '${t.length} kiriman tertunda terkirim',
          rincian: t.length == 1 ? null : t.map((i) => i.judul).take(3).join(' · '),
        );
      }
    });
    return child;
  }
}
