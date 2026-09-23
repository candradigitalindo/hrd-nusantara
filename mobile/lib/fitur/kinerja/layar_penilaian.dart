import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import '../auth/sesi_provider.dart';
import 'layar_isi_penilaian.dart';
import 'model_kinerja.dart';
import 'repo_kinerja.dart';

/// Rincian satu penilaian: nilai per kriteria, catatan penilai, diskusi,
/// dan tombol konfirmasi bagi karyawan yang dinilai.
class LayarPenilaian extends ConsumerWidget {
  const LayarPenilaian({super.key, required this.id});
  final String id;

  Future<void> _konfirmasi(BuildContext context, WidgetRef ref, Penilaian r) async {
    final ya = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Konfirmasi penilaian?'),
        content: Text(
          'Anda menyatakan sudah membaca hasil penilaian periode ${r.periode}. Ini bukan berarti setuju — tambahkan catatan diskusi bila ada yang ingin ditanggapi.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Konfirmasi')),
        ],
      ),
    );
    if (ya != true || !context.mounted) return;
    try {
      await ref.read(repoKinerjaProvider).akui(r.id);
      ref.invalidate(penilaianDetailProvider(id));
      ref.invalidate(penilaianProvider);
      if (context.mounted) tampilkanPesan(context, 'Penilaian dikonfirmasi', rincian: 'Periode ${r.periode}');
    } catch (e) {
      if (context.mounted) tampilkanGalat(context, e, 'Belum terkonfirmasi');
    }
  }

  Future<void> _tambahCatatan(BuildContext context, WidgetRef ref) async {
    final pengendali = TextEditingController();
    final teks = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Catatan diskusi'),
        content: TextField(
          controller: pengendali,
          maxLines: 4,
          maxLength: 5000,
          autofocus: true,
          decoration: const InputDecoration(hintText: 'Tanggapan atau hal yang ingin dibahas dengan penilai'),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
          FilledButton(onPressed: () => Navigator.pop(ctx, pengendali.text.trim()), child: const Text('Kirim')),
        ],
      ),
    );
    pengendali.dispose();
    if (teks == null || teks.isEmpty || !context.mounted) return;
    try {
      await ref.read(repoKinerjaProvider).tambahDiskusi(id, teks);
      ref.invalidate(penilaianDetailProvider(id));
      if (context.mounted) tampilkanPesan(context, 'Catatan terkirim', rincian: 'Penilai dan HR bisa membacanya.');
    } catch (e) {
      if (context.mounted) tampilkanGalat(context, e, 'Catatan belum terkirim');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final saya = ref.watch(penggunaProvider)?.id ?? '';
    final detail = ref.watch(penilaianDetailProvider(id));
    final skema = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Rincian Penilaian')),
      body: detail.when(
        loading: () => const Pemuat(),
        error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(penilaianDetailProvider(id))),
        data: (r) {
          final sebagaiPenilai = r.sayaPenilai(saya) && !r.penilaianDiri;
          String namaPenulis(String id) =>
              id == r.penilaiId ? r.penilaiNama : id == r.dinilaiId ? r.dinilaiNama : 'HR';
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
            children: [
              _KepalaPenilaian(r: r, sebagaiPenilai: sebagaiPenilai),
              if (r.draf && r.sayaPenilai(saya)) ...[
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => LayarIsiPenilaian(id: r.id))),
                  icon: const Icon(Icons.edit_note_rounded),
                  label: const Text('Isi penilaian'),
                ),
              ],
              if (r.menungguKonfirmasi && r.sayaDinilai(saya)) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: skema.secondaryContainer, borderRadius: BorderRadius.circular(12)),
                  child: Text(
                    'Penilaian ini menunggu konfirmasi Anda. Konfirmasi berarti Anda sudah membacanya; tanggapan bisa ditulis di bagian diskusi.',
                    style: TextStyle(fontSize: 12.5, color: skema.onSecondaryContainer),
                  ),
                ),
                const SizedBox(height: 10),
                FilledButton.icon(
                  onPressed: () => _konfirmasi(context, ref, r),
                  icon: const Icon(Icons.task_alt_rounded),
                  label: const Text('Saya sudah membaca'),
                ),
              ],
              if (r.nilai.isNotEmpty) ...[
                const JudulBagian('Nilai per kriteria'),
                Card(
                  child: Column(
                    children: [
                      for (var i = 0; i < r.nilai.length; i++) ...[
                        if (i > 0) const Divider(),
                        _BarisKriteria(r.nilai[i]),
                      ],
                    ],
                  ),
                ),
              ],
              if (r.umpanBalik != null && r.umpanBalik!.trim().isNotEmpty) ...[
                JudulBagian(sebagaiPenilai ? 'Catatan saya' : 'Catatan penilai'),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Text(r.umpanBalik!, style: const TextStyle(height: 1.4)),
                  ),
                ),
              ],
              JudulBagian(
                'Diskusi',
                aksi: r.draf
                    ? null
                    : TextButton.icon(
                        onPressed: () => _tambahCatatan(context, ref),
                        icon: const Icon(Icons.add_comment_outlined, size: 18),
                        label: const Text('Tambah'),
                      ),
              ),
              Card(
                child: r.diskusi.isEmpty
                    ? Padding(
                        padding: const EdgeInsets.all(14),
                        child: Text(
                          r.draf
                              ? 'Diskusi dibuka setelah penilaian dikirim.'
                              : 'Belum ada catatan. Hasil evaluasi sebaiknya dibicarakan, bukan hanya dibaca.',
                          style: TextStyle(fontSize: 13, color: skema.onSurfaceVariant),
                        ),
                      )
                    : Column(
                        children: [
                          for (var i = 0; i < r.diskusi.length; i++) ...[
                            if (i > 0) const Divider(),
                            ListTile(
                              leading: CircleAvatar(
                                radius: 16,
                                backgroundColor: r.diskusi[i].penulisId == saya ? skema.primary : skema.surfaceContainerHighest,
                                child: Text(
                                  namaPenulis(r.diskusi[i].penulisId).isEmpty ? '?' : namaPenulis(r.diskusi[i].penulisId)[0].toUpperCase(),
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w700,
                                    color: r.diskusi[i].penulisId == saya ? skema.onPrimary : skema.onSurface,
                                  ),
                                ),
                              ),
                              title: Text(r.diskusi[i].catatan, style: const TextStyle(fontSize: 14, height: 1.35)),
                              subtitle: Text(
                                '${r.diskusi[i].penulisId == saya ? 'Anda' : namaPenulis(r.diskusi[i].penulisId)} · ${formatRelatif(r.diskusi[i].dibuatPada)}',
                                style: const TextStyle(fontSize: 12),
                              ),
                            ),
                          ],
                        ],
                      ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _KepalaPenilaian extends StatelessWidget {
  const _KepalaPenilaian({required this.r, required this.sebagaiPenilai});
  final Penilaian r;
  final bool sebagaiPenilai;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final pudar = skema.onPrimary.withValues(alpha: 0.85);
    return Card(
      color: skema.primary,
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text('Periode ${r.periode}', style: TextStyle(color: pudar, fontSize: 13, fontWeight: FontWeight.w600))),
                LencanaStatus(r.status, nada: r.menungguKonfirmasi ? Nada.peringatan : r.draf ? Nada.netral : Nada.sukses),
              ],
            ),
            const SizedBox(height: 6),
            if (r.nilaiTotal == null)
              Text(r.draf ? 'Belum diisi' : '—', style: TextStyle(color: skema.onPrimary, fontSize: 26, fontWeight: FontWeight.w800))
            else
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(formatAngka(r.nilaiTotal), style: TextStyle(color: skema.onPrimary, fontSize: 36, fontWeight: FontWeight.w800, height: 1)),
                  const SizedBox(width: 6),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text('/ 100${r.rating != null ? ' · rating ${formatAngka(r.rating)} dari ${r.skala}' : ''}', style: TextStyle(color: pudar, fontSize: 13, fontWeight: FontWeight.w600)),
                  ),
                ],
              ),
            const SizedBox(height: 8),
            Text(
              sebagaiPenilai
                  ? 'Anda menilai ${r.dinilaiNama} sebagai ${r.labelSudutPandang.toLowerCase()}'
                  : r.penilaianDiri
                      ? 'Penilaian diri Anda sendiri'
                      : 'Dinilai oleh ${r.penilaiNama} (${r.labelSudutPandang.toLowerCase()})',
              style: TextStyle(color: skema.onPrimary, fontSize: 13.5),
            ),
            if (r.dikirimPada != null) Text('Dikirim ${formatTanggalWaktu(r.dikirimPada)}', style: TextStyle(color: pudar, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}

class _BarisKriteria extends StatelessWidget {
  const _BarisKriteria(this.n);
  final NilaiKriteria n;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final warna = n.porsi >= 0.8
        ? warnaNada(Nada.sukses, skema)
        : n.porsi >= 0.5
            ? skema.primary
            : warnaNada(Nada.peringatan, skema);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(n.nama, style: const TextStyle(fontWeight: FontWeight.w600))),
              const SizedBox(width: 8),
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(text: formatAngka(n.nilai), style: TextStyle(fontWeight: FontWeight.w800, fontSize: 16, color: warna)),
                    TextSpan(text: ' / ${n.nilaiMaks}', style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          ClipRRect(
            borderRadius: BorderRadius.circular(999),
            child: LinearProgressIndicator(value: n.porsi, minHeight: 5, color: warna, backgroundColor: skema.surfaceContainerHighest),
          ),
          const SizedBox(height: 4),
          Text(
            'Bobot ${formatAngka(n.bobot)}%${n.komentar != null && n.komentar!.trim().isNotEmpty ? ' · ${n.komentar}' : ''}',
            style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}
