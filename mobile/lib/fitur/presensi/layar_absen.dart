import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/widget/widget_umum.dart';
import '../whatsapp/repo_whatsapp.dart';
import 'integritas_lokasi.dart';
import 'layanan_lokasi.dart';
import 'layar_kamera_wajah.dart';
import 'layar_pindai_qr.dart';
import 'model_presensi.dart';
import 'repo_presensi.dart';

/// Lembar pilih metode lalu kirim presensi masuk atau pulang.
class LayarAbsen extends ConsumerStatefulWidget {
  const LayarAbsen({super.key, required this.pulang});
  final bool pulang;

  static Future<Presensi?> buka(BuildContext context, {required bool pulang}) => showModalBottomSheet<Presensi>(
        context: context,
        isScrollControlled: true,
        useSafeArea: true,
        showDragHandle: true,
        builder: (_) => LayarAbsen(pulang: pulang),
      );

  @override
  ConsumerState<LayarAbsen> createState() => _LayarAbsenState();
}

class _LayarAbsenState extends ConsumerState<LayarAbsen> {
  MetodeAbsen? _sedang;
  String? _langkah;
  final _catatan = TextEditingController();

  @override
  void dispose() {
    _catatan.dispose();
    super.dispose();
  }

  Future<void> _jalankan(MetodeAbsen metode) async {
    setState(() {
      _sedang = metode;
      _langkah = 'Menyiapkan…';
    });
    try {
      // Bila grup foto absensi sudah dipilih (di web), metode selain wajah
      // ikut memotret selfie sebagai foto stempel yang dikirim ke grup.
      final tautan = ref.read(tautanWhatsAppProvider).value;
      final perluFotoStempel = tautan?.adaGrup == true && tautan?.tersambung == true;
      String? fotoStempel;
      PermintaanAbsen permintaan;
      switch (metode) {
        case MetodeAbsen.qr:
          final token = await LayarPindaiQr.buka(context);
          if (token == null) return _batal();
          if (perluFotoStempel) {
            if (!mounted) return;
            setState(() => _langkah = 'Foto untuk grup WhatsApp…');
            fotoStempel = await LayarKameraWajah.buka(context);
            if (fotoStempel == null) return _batal();
          }
          permintaan = PermintaanAbsen(metode: metode, qrToken: token, catatan: _catatan.text, fotoStempelBase64: fotoStempel);
        case MetodeAbsen.gps:
        case MetodeAbsen.wajah:
          setState(() => _langkah = 'Mengambil lokasi GPS…');
          final posisi = await ambilPosisi();
          if (!mounted) return;
          setState(() => _langkah = 'Memeriksa keaslian lokasi…');
          final integritas = await periksaIntegritas(posisi);
          if (integritas.diblokir) {
            if (!mounted) return;
            await _tolakKecurangan(integritas);
            return _batal();
          }
          final daftar = await ref.read(repoPresensiProvider).lokasiKerja();
          final terdekat = lokasiTerdekat(daftar, posisi.latitude, posisi.longitude);
          if (terdekat == null) throw GalatLokasi('Belum ada lokasi kerja terdaftar. Hubungi HR.');
          if (!terdekat.diDalamRadius) {
            throw GalatLokasi(
              'Anda ${terdekat.jarak.round()} m dari ${terdekat.lokasi.nama} (batas ${terdekat.lokasi.radiusMeter} m). Mendekatlah ke lokasi kerja.',
            );
          }
          String? foto;
          if (metode == MetodeAbsen.wajah || perluFotoStempel) {
            if (!mounted) return;
            setState(() => _langkah = metode == MetodeAbsen.wajah ? 'Buka kamera…' : 'Foto untuk grup WhatsApp…');
            foto = await LayarKameraWajah.buka(context);
            if (foto == null) return _batal();
          }
          permintaan = PermintaanAbsen(
            metode: metode,
            latitude: posisi.latitude,
            longitude: posisi.longitude,
            lokasiId: terdekat.lokasi.id,
            fotoWajahBase64: metode == MetodeAbsen.wajah ? foto : null,
            fotoStempelBase64: metode == MetodeAbsen.wajah ? null : foto,
            catatan: _catatan.text,
            integritas: integritas.keJson(),
          );
      }
      if (!mounted) return;
      setState(() => _langkah = metode == MetodeAbsen.wajah ? 'Memverifikasi wajah…' : 'Mengirim…');
      final repo = ref.read(repoPresensiProvider);
      final hasil = widget.pulang ? await repo.pulang(permintaan) : await repo.masuk(permintaan);
      ref.invalidate(presensiHariIniProvider);
      ref.invalidate(riwayatPresensiProvider);
      if (!mounted) return;
      Navigator.of(context).pop(hasil);
    } on GalatLokasi catch (e) {
      if (!mounted) return;
      tampilkanPesan(context, 'Lokasi belum bisa dipakai', rincian: e.pesan, nada: Nada.peringatan);
      if (e.bukaPengaturan) {
        if (e.pengaturanAplikasi) {
          Geolocator.openAppSettings();
        } else {
          Geolocator.openLocationSettings();
        }
      }
      _batal();
    } catch (e) {
      if (!mounted) return;
      tampilkanGalat(context, e, widget.pulang ? 'Check-out gagal' : 'Check-in gagal');
      _batal();
    }
  }

  /// Presensi dihentikan di ponsel; server juga akan menolaknya. Dijelaskan
  /// apa yang terdeteksi supaya karyawan yang jujur tahu apa yang harus dicabut.
  Future<void> _tolakKecurangan(LaporanIntegritas laporan) => showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          icon: Icon(Icons.gpp_bad, color: Theme.of(ctx).colorScheme.error, size: 36),
          title: const Text('Presensi ditolak'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Terdeteksi indikasi lokasi palsu:'),
              const SizedBox(height: 8),
              for (final a in laporan.alasanBlokir) Padding(padding: const EdgeInsets.only(bottom: 4), child: Text('• $a')),
              const SizedBox(height: 8),
              Text('Matikan atau hapus aplikasi lokasi palsu, nonaktifkan "lokasi tiruan" di opsi pengembang, lalu coba lagi. Percobaan ini tercatat.', style: TextStyle(fontSize: 12, color: Theme.of(ctx).colorScheme.onSurfaceVariant)),
            ],
          ),
          actions: [FilledButton.icon(onPressed: () => Navigator.pop(ctx), icon: const Icon(Icons.check), label: const Text('Mengerti'))],
        ),
      );

  void _batal() {
    if (mounted) {
      setState(() {
        _sedang = null;
        _langkah = null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(widget.pulang ? 'Check-out' : 'Check-in', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text('Pilih cara verifikasi. Lokasi dan waktu dicatat otomatis.', style: TextStyle(color: skema.onSurfaceVariant)),
          const SizedBox(height: 16),
          if (_sedang != null)
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(color: skema.primaryContainer, borderRadius: BorderRadius.circular(14)),
              child: Row(
                children: [
                  const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5)),
                  const SizedBox(width: 14),
                  Expanded(child: Text('${_sedang!.label}: ${_langkah ?? ''}', style: TextStyle(color: skema.onPrimaryContainer, fontWeight: FontWeight.w600))),
                ],
              ),
            )
          else ...[
            _PilihanMetode(ikon: Icons.face_retouching_natural, judul: 'Verifikasi Wajah', keterangan: 'Selfie + lokasi GPS. Paling kuat, dianjurkan.', onTap: () => _jalankan(MetodeAbsen.wajah)),
            const SizedBox(height: 10),
            _PilihanMetode(ikon: Icons.qr_code_scanner, judul: 'Pindai QR', keterangan: 'Pindai kode di titik presensi outlet/hotel.', onTap: () => _jalankan(MetodeAbsen.qr)),
            const SizedBox(height: 10),
            _PilihanMetode(ikon: Icons.my_location, judul: 'Lokasi GPS', keterangan: 'Cukup berada di radius lokasi kerja.', onTap: () => _jalankan(MetodeAbsen.gps)),
            const SizedBox(height: 14),
            TextField(controller: _catatan, maxLength: 200, decoration: const InputDecoration(labelText: 'Catatan (opsional)', hintText: 'Mis. ganti shift dengan Budi', counterText: '')),
          ],
        ],
      ),
    );
  }
}

class _PilihanMetode extends StatelessWidget {
  const _PilihanMetode({required this.ikon, required this.judul, required this.keterangan, required this.onTap});
  final IconData ikon;
  final String judul;
  final String keterangan;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return Material(
      color: skema.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(14), border: Border.all(color: skema.outlineVariant)),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: skema.primary.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
                child: Icon(ikon, color: skema.primary),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(judul, style: const TextStyle(fontWeight: FontWeight.w700)),
                    Text(keterangan, style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant)),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, color: skema.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}
