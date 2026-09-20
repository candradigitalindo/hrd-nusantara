import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import 'model_cuti.dart';
import 'repo_cuti.dart';

class LayarAjukanCuti extends ConsumerStatefulWidget {
  const LayarAjukanCuti({super.key});
  @override
  ConsumerState<LayarAjukanCuti> createState() => _LayarAjukanCutiState();
}

class _LayarAjukanCutiState extends ConsumerState<LayarAjukanCuti> {
  String? _jenisId;
  DateTime? _mulai;
  DateTime? _selesai;
  final _alasan = TextEditingController();
  final _lampiran = TextEditingController();
  bool _mengirim = false;

  @override
  void dispose() {
    _alasan.dispose();
    _lampiran.dispose();
    super.dispose();
  }

  Future<void> _pilihTanggal({required bool mulai}) async {
    final awal = mulai ? (_mulai ?? DateTime.now()) : (_selesai ?? _mulai ?? DateTime.now());
    final t = await showDatePicker(
      context: context,
      initialDate: awal,
      firstDate: DateTime.now().subtract(const Duration(days: 30)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
      locale: const Locale('id', 'ID'),
    );
    if (t == null) return;
    setState(() {
      if (mulai) {
        _mulai = t;
        if (_selesai == null || _selesai!.isBefore(t)) _selesai = t;
      } else {
        _selesai = t;
      }
    });
  }

  Future<void> _kirim(List<JenisCuti> jenis) async {
    final j = jenis.where((x) => x.id == _jenisId).firstOrNull;
    if (j == null || _mulai == null || _selesai == null) {
      tampilkanPesan(context, 'Lengkapi jenis cuti dan tanggal', nada: Nada.peringatan);
      return;
    }
    if (j.wajibLampiran && _lampiran.text.trim().isEmpty) {
      tampilkanPesan(context, '${j.nama} membutuhkan lampiran', rincian: 'Isi tautan surat dokter atau bukti pendukung.', nada: Nada.peringatan);
      return;
    }
    setState(() => _mengirim = true);
    final f = DateFormat('yyyy-MM-dd');
    try {
      final c = await ref.read(repoCutiProvider).ajukan(jenisId: j.id, mulai: f.format(_mulai!), selesai: f.format(_selesai!), alasan: _alasan.text.trim(), lampiranUrl: _lampiran.text.trim());
      ref.invalidate(riwayatCutiProvider);
      ref.invalidate(saldoCutiProvider);
      if (!mounted) return;
      tampilkanPesan(context, 'Pengajuan terkirim', rincian: '${c.jenisNama} ${c.totalHari} hari · menunggu persetujuan atasan');
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) tampilkanGalat(context, e, 'Pengajuan ditolak sistem');
    } finally {
      if (mounted) setState(() => _mengirim = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final jenis = ref.watch(jenisCutiProvider);
    final saldo = ref.watch(saldoCutiProvider).value ?? const <SaldoCuti>[];
    final skema = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Ajukan Cuti')),
      body: jenis.when(
        loading: () => const Pemuat(),
        error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(jenisCutiProvider)),
        data: (daftar) {
          final terpilih = daftar.where((x) => x.id == _jenisId).firstOrNull;
          final sisa = saldo.where((s) => s.jenisId == _jenisId).firstOrNull;
          return ListView(
            padding: EdgeInsets.fromLTRB(16, 4, 16, 32 + MediaQuery.viewInsetsOf(context).bottom),
            children: [
              DropdownButtonFormField<String>(
                initialValue: _jenisId,
                decoration: const InputDecoration(labelText: 'Jenis cuti'),
                items: daftar.map((j) => DropdownMenuItem(value: j.id, child: Text(j.nama))).toList(),
                onChanged: (v) => setState(() => _jenisId = v),
              ),
              if (terpilih != null) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: skema.primaryContainer.withValues(alpha: 0.5), borderRadius: BorderRadius.circular(12)),
                  child: Text(
                    [
                      if (sisa != null) 'Sisa saldo ${sisa.sisa} hari',
                      if (!terpilih.potongSaldo) 'Tidak memotong saldo',
                      if (terpilih.maksHariBerturut != null) 'maks. ${terpilih.maksHariBerturut} hari berturut',
                      if (terpilih.wajibLampiran) 'wajib lampiran',
                      if (terpilih.keterangan != null) terpilih.keterangan!,
                    ].join(' · '),
                    style: TextStyle(fontSize: 12, color: skema.onPrimaryContainer),
                  ),
                ),
              ],
              const SizedBox(height: 14),
              Row(
                children: [
                  Expanded(child: _KotakTanggal(label: 'Mulai', nilai: _mulai, onTap: () => _pilihTanggal(mulai: true))),
                  const SizedBox(width: 10),
                  Expanded(child: _KotakTanggal(label: 'Selesai', nilai: _selesai, onTap: () => _pilihTanggal(mulai: false))),
                ],
              ),
              const SizedBox(height: 14),
              TextField(controller: _alasan, maxLines: 3, maxLength: 1000, decoration: const InputDecoration(labelText: 'Alasan', hintText: 'Mis. acara keluarga di luar kota')),
              const SizedBox(height: 6),
              TextField(controller: _lampiran, keyboardType: TextInputType.url, decoration: InputDecoration(labelText: terpilih?.wajibLampiran == true ? 'Tautan lampiran (wajib)' : 'Tautan lampiran (opsional)', hintText: 'https://…', helperText: 'Unggah berkas ke Drive/foto, lalu tempel tautannya')),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: _mengirim ? null : () => _kirim(daftar),
                child: _mengirim ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Kirim Pengajuan'),
              ),
              const SizedBox(height: 8),
              Text('Hari libur dan cuti bersama tidak dihitung; saldo dipotong setelah disetujui.', style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant), textAlign: TextAlign.center),
            ],
          );
        },
      ),
    );
  }
}

class _KotakTanggal extends StatelessWidget {
  const _KotakTanggal({required this.label, required this.nilai, required this.onTap});
  final String label;
  final DateTime? nilai;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: InputDecorator(
        decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.calendar_today_outlined, size: 18)),
        child: Text(nilai == null ? 'Pilih tanggal' : formatTanggal(nilai, pola: 'EEE, d MMM yyyy')),
      ),
    );
  }
}
