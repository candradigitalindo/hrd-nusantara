import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import 'model_kinerja.dart';
import 'repo_kinerja.dart';

/// Mengisi penilaian draf: skor per kriteria (1..skala), komentar per
/// kriteria, dan catatan keseluruhan. Nilai akhir dihitung server.
class LayarIsiPenilaian extends ConsumerStatefulWidget {
  const LayarIsiPenilaian({super.key, required this.id});
  final String id;

  @override
  ConsumerState<LayarIsiPenilaian> createState() => _LayarIsiPenilaianState();
}

class _LayarIsiPenilaianState extends ConsumerState<LayarIsiPenilaian> {
  final Map<String, num> _nilai = {};
  final Map<String, TextEditingController> _komentar = {};
  final _catatan = TextEditingController();
  bool _mengirim = false;

  TextEditingController _pengendali(String kriteriaId) => _komentar.putIfAbsent(kriteriaId, TextEditingController.new);

  @override
  void dispose() {
    for (final c in _komentar.values) {
      c.dispose();
    }
    _catatan.dispose();
    super.dispose();
  }

  /// Perkiraan nilai akhir dengan rumus yang sama dengan server: tiap
  /// kriteria dinormalkan ke 0-1 lalu dikalikan bobotnya.
  num? _perkiraan(Penilaian r) {
    if (r.kriteria.isEmpty || r.kriteria.any((k) => !_nilai.containsKey(k.id))) return null;
    num total = 0;
    for (final k in r.kriteria) {
      total += k.nilaiMaks == 0 ? 0 : (_nilai[k.id]! / k.nilaiMaks) * k.bobot;
    }
    return (total * 100).round() / 100;
  }

  Future<void> _kirim(Penilaian r) async {
    final belum = r.kriteria.where((k) => !_nilai.containsKey(k.id)).toList();
    if (belum.isNotEmpty) {
      tampilkanPesan(
        context,
        'Masih ada kriteria yang belum dinilai',
        rincian: belum.map((k) => k.nama).join(', '),
        nada: Nada.peringatan,
      );
      return;
    }
    final ya = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Kirim penilaian?'),
        content: const Text('Setelah dikirim, nilai tidak bisa diubah lagi. Nilai akhir dihitung sistem dari bobot tiap kriteria.'),
        actions: [
          TextButton.icon(onPressed: () => Navigator.pop(ctx, false), icon: const Icon(Icons.edit_outlined), label: const Text('Periksa lagi')),
          FilledButton.icon(onPressed: () => Navigator.pop(ctx, true), icon: const Icon(Icons.send), label: const Text('Kirim')),
        ],
      ),
    );
    if (ya != true || !mounted) return;
    setState(() => _mengirim = true);
    try {
      final hasil = await ref.read(repoKinerjaProvider).kirim(
            r.id,
            nilai: _nilai,
            komentar: {for (final e in _komentar.entries) e.key: e.value.text},
            umpanBalik: _catatan.text,
          );
      ref.invalidate(penilaianProvider);
      ref.invalidate(penilaianDetailProvider(widget.id));
      if (!mounted) return;
      tampilkanPesan(
        context,
        'Penilaian terkirim',
        rincian: hasil.nilaiTotal == null ? null : 'Nilai akhir ${formatAngka(hasil.nilaiTotal)} dari 100',
      );
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) tampilkanGalat(context, e, 'Penilaian belum terkirim');
    } finally {
      if (mounted) setState(() => _mengirim = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final detail = ref.watch(penilaianDetailProvider(widget.id));
    final skema = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Isi Penilaian')),
      body: detail.when(
        loading: () => const Pemuat(),
        error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(penilaianDetailProvider(widget.id))),
        data: (r) {
          if (!r.draf) {
            return KeadaanKosong(
              ikon: Icons.task_alt_rounded,
              judul: 'Penilaian ini sudah dikirim',
              keterangan: 'Status: ${labelUntuk(r.status)}. Tidak ada yang perlu diisi lagi.',
            );
          }
          final perkiraan = _perkiraan(r);
          return ListView(
            padding: EdgeInsets.fromLTRB(16, 4, 16, 32 + MediaQuery.viewInsetsOf(context).bottom),
            children: [
              Card(
                child: ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(color: skema.primaryContainer, borderRadius: BorderRadius.circular(12)),
                    child: Icon(r.penilaianDiri ? Icons.person_outline : Icons.people_outline, color: skema.primary),
                  ),
                  title: Text(r.penilaianDiri ? 'Penilaian diri sendiri' : 'Menilai ${r.dinilaiNama}', style: const TextStyle(fontWeight: FontWeight.w700)),
                  subtitle: Text('Periode ${r.periode} · sudut pandang ${r.labelSudutPandang.toLowerCase()} · ${r.kriteria.length} kriteria'),
                ),
              ),
              const SizedBox(height: 4),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  r.penilaianDiri
                      ? 'Nilai diri Anda apa adanya; perbedaan dengan penilaian atasan justru bahan diskusi yang berguna.'
                      : 'Nilai berdasarkan yang Anda amati langsung selama periode ini, bukan kesan sesaat.',
                  style: TextStyle(fontSize: 12.5, color: skema.onSurfaceVariant),
                ),
              ),
              for (final k in r.kriteria)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _KartuKriteria(
                    k: k,
                    nilai: _nilai[k.id],
                    pengendali: _pengendali(k.id),
                    onUbah: (v) => setState(() => _nilai[k.id] = v),
                  ),
                ),
              TextField(
                controller: _catatan,
                maxLines: 4,
                maxLength: 5000,
                decoration: const InputDecoration(
                  labelText: 'Catatan keseluruhan (opsional)',
                  hintText: 'Kekuatan yang menonjol dan hal yang perlu dikembangkan',
                ),
              ),
              const SizedBox(height: 8),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          perkiraan == null ? 'Nilai akhir dihitung setelah semua kriteria diisi' : 'Perkiraan nilai akhir',
                          style: TextStyle(fontSize: 13, color: skema.onSurfaceVariant),
                        ),
                      ),
                      if (perkiraan != null)
                        Text('${formatAngka(perkiraan)} / 100', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: skema.primary)),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 14),
              FilledButton.icon(
                onPressed: _mengirim ? null : () => _kirim(r),
                icon: _mengirim ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.send),
                label: const Text('Kirim Penilaian'),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _KartuKriteria extends StatelessWidget {
  const _KartuKriteria({required this.k, required this.nilai, required this.pengendali, required this.onUbah});
  final KriteriaKinerja k;
  final num? nilai;
  final TextEditingController pengendali;
  final ValueChanged<num> onUbah;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final rincian = [if (k.kategori != null && k.kategori!.isNotEmpty) k.kategori!, if (k.keterangan != null && k.keterangan!.isNotEmpty) k.keterangan!].join(' · ');
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(k.nama, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15))),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(color: skema.surfaceContainerHighest, borderRadius: BorderRadius.circular(999)),
                  child: Text('bobot ${formatAngka(k.bobot)}%', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: skema.onSurfaceVariant)),
                ),
              ],
            ),
            if (rincian.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 2), child: Text(rincian, style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant))),
            const SizedBox(height: 10),
            if (k.nilaiMaks <= 10)
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (var i = 1; i <= k.nilaiMaks; i++)
                    ChoiceChip(
                      label: Text('$i'),
                      selected: nilai == i,
                      onSelected: (_) => onUbah(i),
                      visualDensity: VisualDensity.compact,
                    ),
                ],
              )
            else
              Row(
                children: [
                  Expanded(
                    child: Slider(
                      value: (nilai ?? 0).toDouble(),
                      min: 0,
                      max: k.nilaiMaks.toDouble(),
                      divisions: k.nilaiMaks,
                      label: '${nilai ?? 0}',
                      onChanged: (v) => onUbah(v.round()),
                    ),
                  ),
                  SizedBox(width: 56, child: Text('${nilai ?? '—'} / ${k.nilaiMaks}', textAlign: TextAlign.right, style: const TextStyle(fontWeight: FontWeight.w700))),
                ],
              ),
            const SizedBox(height: 8),
            TextField(
              controller: pengendali,
              maxLines: 2,
              maxLength: 1000,
              decoration: const InputDecoration(labelText: 'Komentar (opsional)', isDense: true, counterText: ''),
            ),
          ],
        ),
      ),
    );
  }
}
