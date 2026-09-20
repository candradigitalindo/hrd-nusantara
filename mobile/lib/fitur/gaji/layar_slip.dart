import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import 'repo_gaji.dart';

class LayarSlip extends ConsumerWidget {
  const LayarSlip({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final slip = ref.watch(slipProvider(id));
    final skema = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Rincian Slip')),
      body: slip.when(
        loading: () => const Pemuat(),
        error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(slipProvider(id))),
        data: (s) {
          final tunjangan = s.komponen.where((k) => !k.potongan).toList();
          final potongan = s.komponen.where((k) => k.potongan).toList();
          return ListView(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
            children: [
              Card(
                color: skema.primary,
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(s.labelPeriode, style: TextStyle(color: skema.onPrimary.withValues(alpha: 0.85))),
                      const SizedBox(height: 4),
                      Text(formatRupiah(s.bersih), style: TextStyle(color: skema.onPrimary, fontSize: 30, fontWeight: FontWeight.w800)),
                      Text('Gaji bersih diterima', style: TextStyle(color: skema.onPrimary.withValues(alpha: 0.85), fontSize: 12)),
                      const SizedBox(height: 10),
                      LencanaStatus(s.status, nada: s.status == 'paid' ? Nada.sukses : Nada.peringatan, label: s.status == 'paid' ? 'Sudah dibayar' : labelUntuk(s.status)),
                    ],
                  ),
                ),
              ),
              const JudulBagian('Pendapatan'),
              Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Column(
                    children: [
                      BarisRincian('Gaji pokok', formatRupiah(s.gajiPokok)),
                      if (s.lembur > 0) BarisRincian('Lembur${s.jamLembur != null ? ' (${s.jamLembur} jam)' : ''}', formatRupiah(s.lembur)),
                      for (final k in tunjangan) BarisRincian(k.nama, formatRupiah(k.jumlah)),
                      const Divider(),
                      BarisRincian('Total bruto', formatRupiah(s.bruto), tebal: true),
                    ],
                  ),
                ),
              ),
              const JudulBagian('Potongan'),
              Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Column(
                    children: [
                      if (potongan.isEmpty) BarisRincian('Tidak ada potongan', formatRupiah(0)),
                      for (final k in potongan) BarisRincian(k.nama, '– ${formatRupiah(k.jumlah)}'),
                      const Divider(),
                      BarisRincian('Total potongan', '– ${formatRupiah(s.potongan)}', tebal: true),
                    ],
                  ),
                ),
              ),
              const JudulBagian('Kehadiran'),
              Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: Column(
                    children: [
                      BarisRincian('Hari terjadwal', '${s.hariTerjadwal ?? '—'}'),
                      BarisRincian('Hari kerja', '${s.hariKerja ?? '—'}'),
                      if (s.catatan != null) BarisRincian('Catatan', s.catatan!),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Text('Ada yang tidak sesuai? Hubungi HR sebelum tanggal pembayaran berikutnya.', style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant), textAlign: TextAlign.center),
            ],
          );
        },
      ),
    );
  }
}
