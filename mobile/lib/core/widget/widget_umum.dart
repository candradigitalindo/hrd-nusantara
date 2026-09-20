import 'package:flutter/material.dart';

import '../api/galat_api.dart';
import '../format.dart';
import '../tema.dart';

enum Nada { netral, sukses, peringatan, bahaya, info, utama }

Color warnaNada(Nada nada, ColorScheme skema) => switch (nada) {
      Nada.sukses => warnaSukses,
      Nada.peringatan => warnaPeringatan,
      Nada.bahaya => warnaBahaya,
      Nada.info => warnaInfo,
      Nada.utama => skema.primary,
      Nada.netral => skema.onSurfaceVariant,
    };

/// Nada lencana dari kode status backend — satu tempat, dipakai semua layar.
Nada nadaStatus(String? kode) => switch (kode) {
      'present' || 'approved' || 'paid' || 'connected' || 'completed' || 'active' || 'confirmed' || 'reconnected' => Nada.sukses,
      'late' || 'pending' || 'pending_scan' || 'calculated' || 'important' || 'probation' || 'no_checkout' => Nada.peringatan,
      'absent' || 'rejected' || 'disconnected' || 'scan_required' || 'urgent' || 'logged_out' || 'qr_required' || 'terminated' => Nada.bahaya,
      'draft' || 'scheduled' || 'published' || 'contract' => Nada.info,
      _ => Nada.netral,
    };

/// Notifikasi bawah layar yang berwarna sesuai jenisnya, dengan penjelasan —
/// bukan sekadar "Berhasil".
void tampilkanPesan(BuildContext context, String judul, {String? rincian, Nada nada = Nada.sukses}) {
  final skema = Theme.of(context).colorScheme;
  final warna = warnaNada(nada, skema);
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        backgroundColor: skema.inverseSurface,
        duration: Duration(seconds: nada == Nada.bahaya ? 6 : 4),
        content: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              switch (nada) {
                Nada.sukses => Icons.check_circle_rounded,
                Nada.peringatan => Icons.warning_amber_rounded,
                Nada.bahaya => Icons.error_rounded,
                _ => Icons.info_rounded,
              },
              color: warna,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(judul, style: TextStyle(fontWeight: FontWeight.w700, color: skema.onInverseSurface)),
                  if (rincian != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(rincian, style: TextStyle(color: skema.onInverseSurface.withValues(alpha: 0.85), fontSize: 13))),
                ],
              ),
            ),
          ],
        ),
      ),
    );
}

void tampilkanGalat(BuildContext context, Object e, [String judul = 'Gagal']) {
  final g = GalatApi.dari(e);
  tampilkanPesan(context, judul, rincian: g.pesanLengkap, nada: Nada.bahaya);
}

class LencanaStatus extends StatelessWidget {
  const LencanaStatus(this.kode, {super.key, this.label, this.nada});
  final String? kode;
  final String? label;
  final Nada? nada;

  @override
  Widget build(BuildContext context) {
    final warna = warnaNada(nada ?? nadaStatus(kode), Theme.of(context).colorScheme);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: warna.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(width: 6, height: 6, decoration: BoxDecoration(color: warna, shape: BoxShape.circle)),
          const SizedBox(width: 6),
          Text(label ?? labelUntuk(kode), style: TextStyle(color: warna, fontSize: 12, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

class KartuStatistik extends StatelessWidget {
  const KartuStatistik({super.key, required this.label, required this.nilai, this.keterangan, this.ikon, this.nada = Nada.utama});
  final String label;
  final String nilai;
  final String? keterangan;
  final IconData? ikon;
  final Nada nada;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final warna = warnaNada(nada, skema);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant)),
                  const SizedBox(height: 4),
                  Text(nilai, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis),
                  if (keterangan != null) Padding(padding: const EdgeInsets.only(top: 2), child: Text(keterangan!, style: TextStyle(fontSize: 11, color: skema.onSurfaceVariant))),
                ],
              ),
            ),
            if (ikon != null)
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(color: warna.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
                child: Icon(ikon, color: warna, size: 20),
              ),
          ],
        ),
      ),
    );
  }
}

class KeadaanKosong extends StatelessWidget {
  const KeadaanKosong({super.key, required this.judul, this.keterangan, this.ikon = Icons.inbox_outlined, this.aksi});
  final String judul;
  final String? keterangan;
  final IconData ikon;
  final Widget? aksi;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: skema.primary.withValues(alpha: 0.08), shape: BoxShape.circle),
              child: Icon(ikon, size: 32, color: skema.primary),
            ),
            const SizedBox(height: 12),
            Text(judul, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16), textAlign: TextAlign.center),
            if (keterangan != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(keterangan!, style: TextStyle(color: skema.onSurfaceVariant, fontSize: 13), textAlign: TextAlign.center)),
            if (aksi != null) Padding(padding: const EdgeInsets.only(top: 14), child: aksi),
          ],
        ),
      ),
    );
  }
}

/// Tampilan galat pemuatan dengan tombol coba lagi.
class PanelGalat extends StatelessWidget {
  const PanelGalat({super.key, required this.galat, this.cobaLagi});
  final Object galat;
  final VoidCallback? cobaLagi;

  @override
  Widget build(BuildContext context) {
    final g = GalatApi.dari(galat);
    return KeadaanKosong(
      ikon: g.jaringan ? Icons.wifi_off_rounded : Icons.error_outline_rounded,
      judul: g.jaringan ? 'Tidak terhubung' : 'Tidak bisa dimuat',
      keterangan: g.pesanLengkap,
      aksi: cobaLagi == null ? null : OutlinedButton.icon(onPressed: cobaLagi, icon: const Icon(Icons.refresh), label: const Text('Coba lagi')),
    );
  }
}

class Pemuat extends StatelessWidget {
  const Pemuat({super.key});
  @override
  Widget build(BuildContext context) => const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator()));
}

/// Judul bagian kecil huruf kapital, seperti di web.
class JudulBagian extends StatelessWidget {
  const JudulBagian(this.teks, {super.key, this.aksi});
  final String teks;
  final Widget? aksi;
  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 16, 4, 8),
      child: Row(
        children: [
          Expanded(child: Text(teks.toUpperCase(), style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, letterSpacing: 0.8, color: skema.onSurfaceVariant))),
          ?aksi,
        ],
      ),
    );
  }
}

/// Baris "label — nilai" untuk rincian.
class BarisRincian extends StatelessWidget {
  const BarisRincian(this.label, this.nilai, {super.key, this.tebal = false});
  final String label;
  final String nilai;
  final bool tebal;
  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(child: Text(label, style: TextStyle(color: tebal ? skema.onSurface : skema.onSurfaceVariant, fontWeight: tebal ? FontWeight.w700 : FontWeight.w400))),
          const SizedBox(width: 12),
          Text(nilai, style: TextStyle(fontWeight: tebal ? FontWeight.w700 : FontWeight.w600), textAlign: TextAlign.right),
        ],
      ),
    );
  }
}
