import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/galat_api.dart';
import '../../core/api/status_jaringan.dart';
import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import '../wajah/model_wajah.dart';
import '../wajah/repo_wajah.dart';
import '../whatsapp/repo_whatsapp.dart';
import 'integritas_lokasi.dart';
import 'layanan_lokasi.dart';
import 'layar_kamera_wajah.dart';
import 'layar_pindai_qr.dart';
import 'model_presensi.dart';
import 'pengirim_presensi.dart';
import 'repo_presensi.dart';

/// Pesan untuk presensi yang disimpan di antrean (ponsel offline).
void tampilkanAbsenTertunda(BuildContext context, Presensi hasil, {required bool pulang}) => tampilkanPesan(
      context,
      '${pulang ? 'Check-out' : 'Check-in'} ${formatWaktu(pulang ? hasil.jamPulang : hasil.jamMasuk)} disimpan',
      rincian: 'Belum terkirim karena ponsel offline. Dikirim otomatis begitu tersambung; lihat Antrean kirim.',
      nada: Nada.info,
    );

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
  void initState() {
    super.initState();
    // Status wajah dibaca tanpa menahan lembar. Yang sudah ada di memori
    // (mis. dari Profil) disegarkan: HR bisa saja baru menyetujui, dan status
    // basi tidak boleh menahan check-in wajah yang sebenarnya sudah boleh.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) segarkanStatusWajah(ref);
    });
  }

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
      String? namaLokasi;
      DateTime? waktuGps;
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
          final List<LokasiKerja> daftar;
          try {
            // Dari data tersimpan bila offline (lihat KlienApi).
            daftar = await ref.read(repoPresensiProvider).lokasiKerja();
          } on GalatApi catch (g) {
            if (!g.serverTakTerjangkau) rethrow;
            throw GalatLokasi('Daftar lokasi kerja belum tersimpan di ponsel ini. Buka aplikasi sekali saat ada sinyal, lalu coba lagi.');
          }
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
          namaLokasi = terdekat.lokasi.nama;
          waktuGps = posisi.waktu;
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
      final offline = !ref.read(statusJaringanProvider).terhubung;
      setState(() => _langkah = offline ? 'Menyimpan untuk dikirim nanti…' : (metode == MetodeAbsen.wajah ? 'Memverifikasi wajah…' : 'Mengirim…'));
      final hasil = await ref.read(pengirimPresensiProvider).kirim(permintaan, pulang: widget.pulang, namaLokasi: namaLokasi, waktuGps: waktuGps);
      // Yang tertunda tampil dari antrean; yang tercatat dimuat ulang dari server.
      if (!hasil.tertunda) ref.invalidate(riwayatPresensiProvider);
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
      if (e is GalatApi && e.kode == 'not_enrolled') {
        // Status di ponsel tadi belum terbaca atau sudah basi (mis. HR
        // menonaktifkan wajah lama): muat ulang supaya pilihan wajah ikut berubah.
        ref.invalidate(statusWajahProvider);
        _batal();
        return _jelaskanWajah(
          ikon: Icons.face_retouching_natural,
          nada: Nada.peringatan,
          judul: 'Wajah belum terdaftar',
          isi: 'Check-in wajah butuh foto wajah yang sudah disetujui HR. Kirim selfie sekarang; sambil menunggu persetujuan, pakai Lokasi GPS atau Pindai QR.',
          labelTutup: 'Nanti',
          labelKeWajah: 'Daftarkan wajah',
        );
      }
      tampilkanGalat(context, e, widget.pulang ? 'Check-out gagal' : 'Check-in gagal');
      _batal();
    }
  }

  /// Pilihan wajah memakai status wajah bila sudah pasti; selain itu server
  /// yang memutuskan, seperti sebelum ada pendaftaran mandiri.
  void _pilihWajah(StatusWajah? wajah) {
    switch (wajah?.keadaan) {
      case KeadaanWajah.belum || KeadaanWajah.ditolak:
        _keLayarWajah();
      case KeadaanWajah.menunggu:
        final dikirim = wajah?.menunggu?.dikirimPada;
        _jelaskanWajah(
          ikon: Icons.hourglass_top_rounded,
          nada: Nada.info,
          judul: 'Menunggu persetujuan HR',
          isi: 'Foto wajah Anda${dikirim == null ? '' : ' (dikirim ${formatTanggalWaktu(dikirim)})'} sedang diperiksa HR. Sementara itu, pakai Lokasi GPS atau Pindai QR. Anda diberi tahu begitu wajah disetujui.',
          labelKeWajah: 'Lihat status',
        );
      case KeadaanWajah.nonaktif:
        // Server menolak check-in wajah selama fitur ini mati.
        _jelaskanWajah(
          ikon: Icons.face_retouching_off,
          nada: Nada.netral,
          judul: 'Verifikasi wajah dinonaktifkan',
          isi: 'Perusahaan sedang tidak memakai verifikasi wajah. Pakai Lokasi GPS atau Pindai QR.',
        );
      case KeadaanWajah.terdaftar || null:
        _jalankan(MetodeAbsen.wajah);
    }
  }

  /// Lembar ditutup dulu, supaya kembali dari layar wajah tidak mendarat di
  /// lembar absen dengan status wajah yang sudah basi.
  void _keLayarWajah() {
    final router = GoRouter.of(context);
    Navigator.of(context).pop();
    router.push('/wajah');
  }

  /// Dialog, bukan notifikasi bawah: notifikasi bawah tertutup lembar ini.
  Future<void> _jelaskanWajah({
    required IconData ikon,
    required Nada nada,
    required String judul,
    required String isi,
    String labelTutup = 'Mengerti',
    String? labelKeWajah,
  }) async {
    final keWajah = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: Icon(ikon, color: warnaNada(nada, Theme.of(ctx).colorScheme), size: 36),
        title: Text(judul),
        content: Text(isi),
        actions: [
          if (labelKeWajah == null)
            FilledButton.icon(onPressed: () => Navigator.pop(ctx, false), icon: const Icon(Icons.check), label: Text(labelTutup))
          else ...[
            TextButton.icon(onPressed: () => Navigator.pop(ctx, false), icon: const Icon(Icons.close), label: Text(labelTutup)),
            FilledButton.icon(onPressed: () => Navigator.pop(ctx, true), icon: const Icon(Icons.face_retouching_natural), label: Text(labelKeWajah)),
          ],
        ],
      ),
    );
    if (keWajah == true && mounted) _keLayarWajah();
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
    final statusWajah = ref.watch(statusWajahProvider);
    // Yang sedang dimuat ulang atau gagal dimuat (offline) bisa basi; hanya
    // status yang pasti yang boleh mengubah pilihan wajah.
    final wajah = statusWajah.isLoading || statusWajah.hasError ? null : statusWajah.valueOrNull;
    final keadaanWajah = wajah?.keadaan;
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
            _PilihanMetode(
              ikon: Icons.face_retouching_natural,
              judul: 'Verifikasi Wajah',
              keterangan: switch (keadaanWajah) {
                KeadaanWajah.belum || KeadaanWajah.ditolak => 'Belum terdaftar — ketuk untuk mendaftar',
                KeadaanWajah.menunggu => 'Menunggu persetujuan HR',
                KeadaanWajah.nonaktif => 'Sedang dinonaktifkan — pakai GPS atau QR',
                KeadaanWajah.terdaftar || null => 'Selfie + lokasi GPS. Paling kuat, dianjurkan.',
              },
              warnaKeterangan: switch (keadaanWajah) {
                KeadaanWajah.belum || KeadaanWajah.ditolak => warnaNada(Nada.peringatan, skema),
                KeadaanWajah.menunggu => warnaNada(Nada.info, skema),
                _ => null,
              },
              onTap: () => _pilihWajah(wajah),
            ),
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
  const _PilihanMetode({required this.ikon, required this.judul, required this.keterangan, required this.onTap, this.warnaKeterangan});
  final IconData ikon;
  final String judul;
  final String keterangan;
  final VoidCallback onTap;

  /// Untuk keterangan yang menuntut tindakan, mis. wajah belum terdaftar.
  final Color? warnaKeterangan;

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
                    Text(
                      keterangan,
                      style: TextStyle(fontSize: 12, color: warnaKeterangan ?? skema.onSurfaceVariant, fontWeight: warnaKeterangan == null ? null : FontWeight.w600),
                    ),
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
