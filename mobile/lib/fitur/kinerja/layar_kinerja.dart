import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import '../auth/sesi_provider.dart';
import 'layar_isi_penilaian.dart';
import 'layar_penilaian.dart';
import 'model_kinerja.dart';
import 'repo_kinerja.dart';

/// Kinerja dari sisi karyawan: nilai KPI terakhir, penilaian yang harus ia
/// isi (penilaian diri atau menilai rekan), hasil penilaian atas dirinya,
/// dan umpan balik informal yang ia terima.
class LayarKinerja extends ConsumerWidget {
  const LayarKinerja({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final saya = ref.watch(penggunaProvider)?.id ?? '';
    final penilaian = ref.watch(penilaianProvider);
    final umpan = ref.watch(umpanBalikProvider);
    final skema = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Kinerja & KPI')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(penilaianProvider);
          ref.invalidate(umpanBalikProvider);
          await ref.read(penilaianProvider.future);
        },
        child: penilaian.when(
          loading: () => const Pemuat(),
          error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(penilaianProvider)),
          data: (daftar) {
            final tugas = daftar.where((r) => r.sayaPenilai(saya) && r.draf).toList();
            final hasil = daftar.where((r) => r.sayaDinilai(saya) && r.adaHasil).toList();
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
              children: [
                _KartuNilai(terbaru: nilaiTerbaru(hasil)),
                if (tugas.isNotEmpty) ...[
                  const JudulBagian('Perlu saya isi'),
                  Card(
                    child: Column(
                      children: [
                        for (var i = 0; i < tugas.length; i++) ...[
                          if (i > 0) const Divider(),
                          _UbinTugas(tugas[i]),
                        ],
                      ],
                    ),
                  ),
                ],
                const JudulBagian('Hasil penilaian saya'),
                if (hasil.isEmpty)
                  const KeadaanKosong(
                    ikon: Icons.insights_outlined,
                    judul: 'Belum ada hasil penilaian',
                    keterangan: 'Hasil muncul setelah atasan mengirim penilaian pada siklus yang berjalan.',
                  )
                else
                  Card(
                    child: Column(
                      children: [
                        for (var i = 0; i < hasil.length; i++) ...[
                          if (i > 0) const Divider(),
                          _UbinHasil(hasil[i]),
                        ],
                      ],
                    ),
                  ),
                const JudulBagian('Umpan balik untuk saya'),
                umpan.when(
                  loading: () => const Pemuat(),
                  error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(umpanBalikProvider)),
                  data: (d) => d.isEmpty
                      ? Card(
                          child: Padding(
                            padding: const EdgeInsets.all(16),
                            child: Text(
                              'Belum ada umpan balik. Atasan dan rekan bisa mengirim apresiasi atau masukan kapan saja tanpa menunggu siklus penilaian.',
                              style: TextStyle(color: skema.onSurfaceVariant, fontSize: 13),
                            ),
                          ),
                        )
                      : Column(
                          children: [
                            for (final u in d)
                              Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: _KartuUmpan(u),
                              ),
                          ],
                        ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Kartu hijau di atas: nilai KPI terakhir yang mewakili.
class _KartuNilai extends StatelessWidget {
  const _KartuNilai({required this.terbaru});
  final Penilaian? terbaru;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final r = terbaru;
    final pudar = skema.onPrimary.withValues(alpha: 0.85);
    return Card(
      color: skema.primary,
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'NILAI KINERJA TERAKHIR',
              style: TextStyle(color: pudar, fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.8),
            ),
            const SizedBox(height: 6),
            if (r == null) ...[
              Text('Belum ada penilaian', style: TextStyle(color: skema.onPrimary, fontSize: 20, fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text(
                'Nilai muncul setelah atasan mengirim penilaian pada siklus yang berjalan.',
                style: TextStyle(color: pudar, fontSize: 12.5),
              ),
            ] else ...[
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(formatAngka(r.nilaiTotal), style: TextStyle(color: skema.onPrimary, fontSize: 40, fontWeight: FontWeight.w800, height: 1)),
                  const SizedBox(width: 6),
                  Padding(
                    padding: const EdgeInsets.only(bottom: 5),
                    child: Text('/ 100', style: TextStyle(color: pudar, fontSize: 14, fontWeight: FontWeight.w600)),
                  ),
                  const Spacer(),
                  if (r.rating != null)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.16), borderRadius: BorderRadius.circular(999)),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.star_rounded, size: 16, color: skema.secondary),
                          const SizedBox(width: 4),
                          Text('${formatAngka(r.rating)} dari ${r.skala}', style: TextStyle(color: skema.onPrimary, fontSize: 12.5, fontWeight: FontWeight.w700)),
                        ],
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 10),
              ClipRRect(
                borderRadius: BorderRadius.circular(999),
                child: LinearProgressIndicator(
                  value: ((r.nilaiTotal ?? 0) / 100).clamp(0, 1).toDouble(),
                  minHeight: 6,
                  color: skema.secondary,
                  backgroundColor: Colors.white.withValues(alpha: 0.2),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Periode ${r.periode} · dinilai ${r.labelSudutPandang.toLowerCase()} · ${labelUntuk(r.status)}',
                style: TextStyle(color: pudar, fontSize: 12.5),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _UbinTugas extends StatelessWidget {
  const _UbinTugas(this.r);
  final Penilaian r;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final warna = warnaNada(Nada.peringatan, skema);
    return ListTile(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => LayarIsiPenilaian(id: r.id))),
      leading: Container(
        padding: const EdgeInsets.all(9),
        decoration: BoxDecoration(color: warna.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
        child: Icon(Icons.edit_note_rounded, color: warna),
      ),
      title: Text(r.penilaianDiri ? 'Penilaian diri' : 'Menilai ${r.dinilaiNama}', style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Text('Periode ${r.periode} · sudut pandang ${r.labelSudutPandang.toLowerCase()}'),
      trailing: const Icon(Icons.chevron_right),
    );
  }
}

class _UbinHasil extends StatelessWidget {
  const _UbinHasil(this.r);
  final Penilaian r;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return ListTile(
      onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => LayarPenilaian(id: r.id))),
      leading: Container(
        width: 46,
        height: 46,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: skema.primaryContainer, borderRadius: BorderRadius.circular(12)),
        child: Text(
          r.nilaiTotal == null ? '—' : formatAngka(r.nilaiTotal!.round()),
          style: TextStyle(color: skema.onPrimaryContainer, fontWeight: FontWeight.w800, fontSize: 16),
        ),
      ),
      title: Text('Periode ${r.periode}', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w700)),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('${r.labelSudutPandang} · ${r.penilaiNama}${r.dikirimPada != null ? ' · ${formatTanggal(r.dikirimPada)}' : ''}', maxLines: 2, overflow: TextOverflow.ellipsis),
          const SizedBox(height: 5),
          LencanaStatus(r.status, label: r.menungguKonfirmasi ? 'Perlu konfirmasi' : null),
        ],
      ),
      trailing: const Icon(Icons.chevron_right),
    );
  }
}

class _KartuUmpan extends StatelessWidget {
  const _KartuUmpan(this.u);
  final UmpanBalik u;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final nada = switch (u.tipe) { 'praise' => Nada.sukses, 'improvement' => Nada.peringatan, _ => Nada.info };
    final warna = warnaNada(nada, skema);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  switch (u.tipe) { 'praise' => Icons.thumb_up_alt_outlined, 'improvement' => Icons.trending_up_rounded, _ => Icons.sticky_note_2_outlined },
                  size: 18,
                  color: warna,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '${u.penulisNama ?? 'Rekan kerja'} · ${formatRelatif(u.dibuatPada)}',
                    style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                LencanaStatus(u.tipe, label: u.labelTipe, nada: nada),
              ],
            ),
            const SizedBox(height: 8),
            Text(u.pesan, style: const TextStyle(fontSize: 14, height: 1.4)),
          ],
        ),
      ),
    );
  }
}
