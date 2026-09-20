import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import 'model_survei.dart';
import 'repo_survei.dart';

class LayarSurvei extends ConsumerWidget {
  const LayarSurvei({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(surveiProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Survei Karyawan')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(surveiProvider);
          await ref.read(surveiProvider.future);
        },
        child: data.when(
          loading: () => const Pemuat(),
          error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(surveiProvider)),
          data: (daftar) {
            final tampil = daftar.where((s) => s.status != 'draft').toList();
            return tampil.isEmpty
                ? ListView(children: const [KeadaanKosong(ikon: Icons.poll_outlined, judul: 'Belum ada survei', keterangan: 'Survei kepuasan dari HR akan tampil di sini.')])
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                    itemCount: tampil.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 8),
                    itemBuilder: (_, i) {
                      final s = tampil[i];
                      return Card(
                        child: ListTile(
                          onTap: s.bisaDiisi ? () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => LayarIsiSurvei(s))) : null,
                          title: Text(s.judul, style: const TextStyle(fontWeight: FontWeight.w700)),
                          subtitle: Text('${s.pertanyaan.length} pertanyaan · sampai ${formatTanggalSaja(s.selesai)}${s.anonim ? ' · anonim' : ''}'),
                          trailing: s.sudahIsi ? const LencanaStatus('completed', label: 'Sudah diisi') : s.status == 'closed' ? const LencanaStatus('closed') : const Icon(Icons.chevron_right),
                        ),
                      );
                    },
                  );
          },
        ),
      ),
    );
  }
}

class LayarIsiSurvei extends ConsumerStatefulWidget {
  const LayarIsiSurvei(this.survei, {super.key});
  final Survei survei;
  @override
  ConsumerState<LayarIsiSurvei> createState() => _LayarIsiSurveiState();
}

class _LayarIsiSurveiState extends ConsumerState<LayarIsiSurvei> {
  final Map<String, Object?> _jawaban = {};
  final Map<String, TextEditingController> _teks = {};
  bool _mengirim = false;

  @override
  void dispose() {
    for (final c in _teks.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _kirim() async {
    final s = widget.survei;
    final kurang = s.pertanyaan.where((p) => p.wajib && (_jawaban[p.id] == null || (_jawaban[p.id] is String && (_jawaban[p.id] as String).trim().isEmpty))).toList();
    if (kurang.isNotEmpty) {
      tampilkanPesan(context, '${kurang.length} pertanyaan wajib belum dijawab', rincian: kurang.first.teks, nada: Nada.peringatan);
      return;
    }
    setState(() => _mengirim = true);
    try {
      final jawaban = s.pertanyaan.where((p) => _jawaban[p.id] != null).map((p) => <String, dynamic>{
            'questionId': p.id,
            if (p.tipe == 'scale') 'scaleValue': _jawaban[p.id],
            if (p.tipe == 'text') 'textValue': (_jawaban[p.id] as String).trim(),
            if (p.tipe == 'choice') 'choiceValue': _jawaban[p.id],
          }).toList();
      await ref.read(repoSurveiProvider).kirim(s.id, jawaban);
      ref.invalidate(surveiProvider);
      if (!mounted) return;
      tampilkanPesan(context, 'Terima kasih, jawaban terkirim', rincian: s.anonim ? 'Jawaban Anda anonim dan tidak bisa ditelusuri ke nama.' : null);
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) tampilkanGalat(context, e, 'Jawaban belum terkirim');
    } finally {
      if (mounted) setState(() => _mengirim = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final s = widget.survei;
    final skema = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: Text(s.judul)),
      body: ListView(
        padding: EdgeInsets.fromLTRB(16, 4, 16, 32 + MediaQuery.viewInsetsOf(context).bottom),
        children: [
          if (s.deskripsi != null) Padding(padding: const EdgeInsets.only(bottom: 12), child: Text(s.deskripsi!, style: TextStyle(color: skema.onSurfaceVariant))),
          if (s.anonim)
            Container(
              padding: const EdgeInsets.all(12),
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(color: skema.primaryContainer.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(12)),
              child: Row(children: [Icon(Icons.lock_outline, size: 18, color: skema.onPrimaryContainer), const SizedBox(width: 8), Expanded(child: Text('Survei ini anonim. HR hanya melihat rekap, bukan siapa menjawab apa.', style: TextStyle(fontSize: 12, color: skema.onPrimaryContainer)))]),
            ),
          for (var i = 0; i < s.pertanyaan.length; i++) ...[
            _KartuPertanyaan(
              nomor: i + 1,
              p: s.pertanyaan[i],
              nilai: _jawaban[s.pertanyaan[i].id],
              teks: _teks.putIfAbsent(s.pertanyaan[i].id, TextEditingController.new),
              onUbah: (v) => setState(() => _jawaban[s.pertanyaan[i].id] = v),
            ),
            const SizedBox(height: 10),
          ],
          const SizedBox(height: 8),
          FilledButton(onPressed: _mengirim ? null : _kirim, child: _mengirim ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Kirim Jawaban')),
        ],
      ),
    );
  }
}

class _KartuPertanyaan extends StatelessWidget {
  const _KartuPertanyaan({required this.nomor, required this.p, required this.nilai, required this.teks, required this.onUbah});
  final int nomor;
  final PertanyaanSurvei p;
  final Object? nilai;
  final TextEditingController teks;
  final ValueChanged<Object?> onUbah;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final min = p.skalaMin ?? 1;
    final maks = p.skalaMaks ?? 5;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text.rich(TextSpan(children: [
              TextSpan(text: '$nomor. ', style: TextStyle(color: skema.primary, fontWeight: FontWeight.w800)),
              TextSpan(text: p.teks, style: const TextStyle(fontWeight: FontWeight.w600)),
              if (p.wajib) TextSpan(text: ' *', style: TextStyle(color: skema.error)),
            ])),
            const SizedBox(height: 10),
            switch (p.tipe) {
              'scale' => Wrap(
                  spacing: 6,
                  children: [
                    for (var v = min; v <= maks; v++)
                      ChoiceChip(label: Text('$v'), selected: nilai == v, onSelected: (_) => onUbah(v), showCheckmark: false),
                  ],
                ),
              'choice' => Column(
                  children: [
                    for (final o in p.opsi)
                      RadioListTile<String>(
                        value: o,
                        // ignore: deprecated_member_use
                        groupValue: nilai as String?,
                        // ignore: deprecated_member_use
                        onChanged: onUbah,
                        title: Text(o),
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                      ),
                  ],
                ),
              _ => TextField(controller: teks, maxLines: 3, maxLength: 5000, onChanged: onUbah, decoration: const InputDecoration(hintText: 'Tulis jawaban Anda…', counterText: '')),
            },
            if (p.tipe == 'scale') Padding(padding: const EdgeInsets.only(top: 4), child: Text('$min = sangat tidak setuju · $maks = sangat setuju', style: TextStyle(fontSize: 11, color: skema.onSurfaceVariant))),
          ],
        ),
      ),
    );
  }
}
