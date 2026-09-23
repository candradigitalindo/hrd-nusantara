import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import 'model_kasus.dart';
import 'repo_kasus.dart';

/// Keluhan & disiplin dari sisi karyawan: mengajukan keluhan (hanya HR yang
/// membacanya) dan melihat tindakan disiplin yang ditujukan kepadanya.
class LayarKasus extends ConsumerWidget {
  const LayarKasus({super.key});

  void _bukaRincian(BuildContext context, Kasus k) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (ctx) => _LembarRincian(k),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final kasus = ref.watch(kasusProvider);
    final skema = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Keluhan & Disiplin')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LayarAjukanKeluhan())),
        icon: const Icon(Icons.outlined_flag),
        label: const Text('Ajukan Keluhan'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(kasusProvider);
          await ref.read(kasusProvider.future);
        },
        child: kasus.when(
          loading: () => const Pemuat(),
          error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(kasusProvider)),
          data: (daftar) => ListView(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.lock_outline, size: 18, color: skema.primary),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'Keluhan hanya dibaca HR; orang yang dikeluhkan tidak melihatnya. Tindakan disiplin (teguran, SP) yang ditujukan kepada Anda tercatat di sini beserta penyelesaiannya.',
                          style: TextStyle(fontSize: 12.5, color: skema.onSurfaceVariant, height: 1.35),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const JudulBagian('Riwayat'),
              if (daftar.isEmpty)
                const KeadaanKosong(
                  ikon: Icons.verified_user_outlined,
                  judul: 'Tidak ada kasus',
                  keterangan: 'Anda belum mengajukan keluhan, dan tidak ada tindakan disiplin yang ditujukan kepada Anda.',
                )
              else
                Card(
                  child: Column(
                    children: [
                      for (var i = 0; i < daftar.length; i++) ...[
                        if (i > 0) const Divider(),
                        _UbinKasus(daftar[i], onTap: () => _bukaRincian(context, daftar[i])),
                      ],
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _UbinKasus extends StatelessWidget {
  const _UbinKasus(this.k, {required this.onTap});
  final Kasus k;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final nada = k.keluhan ? Nada.info : nadaStatus(k.tingkat);
    final warna = warnaNada(nada == Nada.netral ? Nada.bahaya : nada, skema);
    return ListTile(
      onTap: onTap,
      leading: Container(
        padding: const EdgeInsets.all(9),
        decoration: BoxDecoration(color: warna.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
        child: Icon(k.keluhan ? Icons.outlined_flag : Icons.gavel_rounded, color: warna, size: 20),
      ),
      title: Text(k.judul, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text('${k.labelTipe} · ${formatTanggal(k.dibuatPada)}', style: const TextStyle(fontSize: 12)),
      trailing: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          if (k.tingkat != null) ...[LencanaStatus(k.tingkat), const SizedBox(height: 4)],
          LencanaStatus(k.status),
        ],
      ),
    );
  }
}

class _LembarRincian extends StatelessWidget {
  const _LembarRincian(this.k);
  final Kasus k;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Wrap(
              spacing: 8,
              runSpacing: 6,
              children: [
                LencanaStatus(k.tipe, label: k.labelTipe, nada: k.keluhan ? Nada.info : Nada.bahaya),
                if (k.tingkat != null) LencanaStatus(k.tingkat),
                LencanaStatus(k.status),
              ],
            ),
            const SizedBox(height: 10),
            Text(k.judul, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Column(
                  children: [
                    if (!k.keluhan && k.karyawanNama != null) BarisRincian('Ditujukan kepada', k.karyawanNama!),
                    if (k.keluhan && k.karyawanNama != null) BarisRincian('Subjek', k.karyawanNama!),
                    BarisRincian('Tanggal kejadian', k.tanggalKejadian == null ? '—' : formatTanggal(k.tanggalKejadian)),
                    BarisRincian('Dicatat', formatTanggalWaktu(k.dibuatPada)),
                    BarisRincian('Dilaporkan oleh', k.pelaporNama ?? '—'),
                    BarisRincian('Ditangani oleh', k.penanganNama ?? (k.selesai ? '—' : 'Menunggu HR')),
                    if (k.diselesaikanPada != null) BarisRincian('Diselesaikan', formatTanggalWaktu(k.diselesaikanPada)),
                  ],
                ),
              ),
            ),
            const JudulBagian('Uraian'),
            Text(k.uraian, style: const TextStyle(height: 1.45)),
            if (k.catatanPenyelesaian != null && k.catatanPenyelesaian!.trim().isNotEmpty) ...[
              const JudulBagian('Catatan penyelesaian'),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: warnaNada(k.status == 'dismissed' ? Nada.peringatan : Nada.sukses, skema).withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(k.catatanPenyelesaian!, style: const TextStyle(height: 1.4)),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Formulir keluhan: judul, uraian, dan tanggal kejadian (opsional).
class LayarAjukanKeluhan extends ConsumerStatefulWidget {
  const LayarAjukanKeluhan({super.key});
  @override
  ConsumerState<LayarAjukanKeluhan> createState() => _LayarAjukanKeluhanState();
}

class _LayarAjukanKeluhanState extends ConsumerState<LayarAjukanKeluhan> {
  final _form = GlobalKey<FormState>();
  final _judul = TextEditingController();
  final _uraian = TextEditingController();
  DateTime? _tanggal;
  bool _mengirim = false;

  @override
  void dispose() {
    _judul.dispose();
    _uraian.dispose();
    super.dispose();
  }

  Future<void> _pilihTanggal() async {
    final t = await showDatePicker(
      context: context,
      initialDate: _tanggal ?? DateTime.now(),
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now(),
      locale: const Locale('id', 'ID'),
    );
    if (t != null) setState(() => _tanggal = t);
  }

  Future<void> _kirim() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _mengirim = true);
    try {
      final k = await ref.read(repoKasusProvider).ajukanKeluhan(
            judul: _judul.text.trim(),
            uraian: _uraian.text.trim(),
            tanggalKejadian: _tanggal == null ? null : DateFormat('yyyy-MM-dd').format(_tanggal!),
          );
      ref.invalidate(kasusProvider);
      if (!mounted) return;
      tampilkanPesan(context, 'Keluhan terkirim', rincian: '${k.judul} · HR akan meninjaunya.');
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) tampilkanGalat(context, e, 'Keluhan belum terkirim');
    } finally {
      if (mounted) setState(() => _mengirim = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Ajukan Keluhan')),
      body: Form(
        key: _form,
        autovalidateMode: AutovalidateMode.onUserInteraction,
        child: ListView(
          padding: EdgeInsets.fromLTRB(16, 4, 16, 32 + MediaQuery.viewInsetsOf(context).bottom),
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: skema.primaryContainer.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(12)),
              child: Text(
                'Hanya HR yang bisa membaca keluhan ini. Orang yang dikeluhkan tidak akan melihatnya.',
                style: TextStyle(fontSize: 12.5, color: skema.onPrimaryContainer),
              ),
            ),
            const SizedBox(height: 14),
            TextFormField(
              controller: _judul,
              maxLength: 150,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Judul', hintText: 'Mis. jadwal shift berubah mendadak'),
              validator: (v) => (v == null || v.trim().length < 3) ? 'Minimal 3 karakter' : null,
            ),
            const SizedBox(height: 6),
            TextFormField(
              controller: _uraian,
              maxLines: 6,
              maxLength: 5000,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'Uraian', hintText: 'Ceritakan apa yang terjadi, kapan, dan siapa yang terlibat', alignLabelWithHint: true),
              validator: (v) => (v == null || v.trim().length < 10) ? 'Uraikan kejadiannya, minimal 10 karakter' : null,
            ),
            const SizedBox(height: 6),
            InkWell(
              onTap: _pilihTanggal,
              borderRadius: BorderRadius.circular(12),
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: 'Tanggal kejadian (opsional)',
                  suffixIcon: _tanggal == null
                      ? const Icon(Icons.calendar_today_outlined, size: 18)
                      : IconButton(icon: const Icon(Icons.close, size: 18), onPressed: () => setState(() => _tanggal = null), tooltip: 'Hapus tanggal'),
                ),
                child: Text(_tanggal == null ? 'Pilih tanggal' : formatTanggal(_tanggal, pola: 'EEEE, d MMM yyyy')),
              ),
            ),
            const SizedBox(height: 20),
            FilledButton(
              onPressed: _mengirim ? null : _kirim,
              child: _mengirim
                  ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                  : const Text('Kirim Keluhan'),
            ),
          ],
        ),
      ),
    );
  }
}
