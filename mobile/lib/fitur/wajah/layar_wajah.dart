import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/galat_api.dart';
import '../../core/api/status_jaringan.dart';
import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import 'model_wajah.dart';
import 'repo_wajah.dart';

/// Pendaftaran wajah mandiri. Karyawan mengirim selfie, lalu HR memastikan
/// di web bahwa wajah di foto memang milik karyawan ini sebelum dipakai untuk
/// check-in. Tanpa persetujuan itu, karyawan bisa mendaftarkan wajah rekannya
/// atas namanya sendiri dan rekan itulah yang absen untuknya.
class LayarWajah extends ConsumerStatefulWidget {
  const LayarWajah({super.key});
  @override
  ConsumerState<LayarWajah> createState() => _LayarWajahState();
}

class _LayarWajahState extends ConsumerState<LayarWajah> {
  bool _mengirim = false;

  /// Alasan pemeriksaan otomatis server menolak foto terakhir (bukan wajah
  /// langsung, tidak ada wajah, lebih dari satu orang). Tetap tampil setelah
  /// notifikasi bawah hilang, supaya jelas apa yang diperbaiki saat memotret ulang.
  String? _galatKirim;

  @override
  void initState() {
    super.initState();
    // Dibuka dari notifikasi atau Profil: status di memori bisa sudah basi.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) segarkanStatusWajah(ref);
    });
  }

  Future<void> _ambilDanKirim() async {
    if (_mengirim) return;
    if (!ref.read(statusJaringanProvider).terhubung) {
      tampilkanPesan(
        context,
        'Butuh koneksi internet',
        rincian: 'Foto wajah diperiksa server saat itu juga, jadi tidak disimpan untuk dikirim nanti. Coba lagi saat ada sinyal.',
        nada: Nada.peringatan,
      );
      return;
    }
    // Unggahan bisa sampai semenit; status tetap harus disegarkan walau
    // karyawan sudah meninggalkan layar ini (Profil ikut menampilkannya).
    final wadah = ProviderScope.containerOf(context, listen: false);
    final foto = await ref.read(ambilSelfieWajahProvider)(context);
    if (foto == null || !mounted) return;
    setState(() {
      _mengirim = true;
      _galatKirim = null;
    });
    try {
      await wadah.read(repoWajahProvider).kirim(foto);
      wadah.invalidate(statusWajahProvider);
      if (!mounted) return;
      tampilkanPesan(context, 'Foto terkirim ke HR', rincian: 'Anda diberi tahu setelah HR memeriksanya. Sementara itu, check-in pakai Lokasi GPS atau Pindai QR.');
    } catch (e) {
      if (!mounted) return;
      final g = GalatApi.dari(e);
      // 422 = foto ditolak pemeriksaan otomatis; bisa langsung diperbaiki
      // dengan memotret ulang. Galat lain (jaringan, server) bukan soal fotonya.
      final fotoDitolak = g.kodeHttp == 422;
      setState(() => _galatKirim = fotoDitolak ? g.pesanLengkap : null);
      tampilkanPesan(context, fotoDitolak ? 'Foto belum bisa dipakai' : 'Foto belum terkirim', rincian: g.pesanLengkap, nada: Nada.bahaya);
    } finally {
      if (mounted) setState(() => _mengirim = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(statusWajahProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Wajah untuk Presensi')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(statusWajahProvider);
          try {
            await ref.read(statusWajahProvider.future);
          } catch (_) {
            // Galatnya tampil di kartu status.
          }
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
          children: [
            status.when(
              loading: () => const Card(child: SizedBox(height: 160, child: Center(child: CircularProgressIndicator()))),
              error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(statusWajahProvider)),
              data: (s) => _KartuStatus(s, mengirim: _mengirim, galatKirim: _galatKirim, kirim: _ambilDanKirim),
            ),
            const JudulBagian('Cara kerja'),
            const Card(
              child: Padding(
                padding: EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _Langkah(nomor: 1, teks: 'Ambil selfie dengan kamera depan, langsung dari aplikasi ini.'),
                    _Langkah(nomor: 2, teks: 'HR memeriksa bahwa wajah di foto memang Anda, supaya tidak ada orang lain yang didaftarkan atas nama Anda.'),
                    _Langkah(nomor: 3, teks: 'Setelah disetujui, Anda mendapat notifikasi dan bisa check-in dengan Verifikasi Wajah.'),
                  ],
                ),
              ),
            ),
            const JudulBagian('Agar foto diterima'),
            const Card(
              child: Padding(
                padding: EdgeInsets.all(14),
                child: Column(
                  children: [
                    _Tips(ikon: Icons.wb_sunny_outlined, teks: 'Cahaya cukup dari depan; wajah tidak tertutup bayangan.'),
                    _Tips(ikon: Icons.face_outlined, teks: 'Lepas masker dan kacamata hitam, wajah menghadap kamera.'),
                    _Tips(ikon: Icons.person_outline, teks: 'Hanya Anda di dalam bingkai.'),
                    _Tips(ikon: Icons.no_photography_outlined, teks: 'Memotret foto atau layar ponsel lain ditolak otomatis.'),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// "Kemarin 14:20" → "kemarin 14:20", untuk disambung setelah kata kerja.
String _sambung(DateTime? waktu) {
  final t = formatRelatif(waktu);
  return t.isEmpty ? t : t[0].toLowerCase() + t.substring(1);
}

class _KartuStatus extends StatelessWidget {
  const _KartuStatus(this.s, {required this.mengirim, required this.galatKirim, required this.kirim});
  final StatusWajah s;
  final bool mengirim;
  final String? galatKirim;
  final VoidCallback kirim;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final keadaan = s.keadaan;
    final nada = switch (keadaan) {
      KeadaanWajah.terdaftar => Nada.sukses,
      KeadaanWajah.menunggu => Nada.info,
      KeadaanWajah.ditolak => Nada.bahaya,
      KeadaanWajah.belum => Nada.peringatan,
      KeadaanWajah.nonaktif => Nada.netral,
    };
    final warna = warnaNada(nada, skema);
    final judul = switch (keadaan) {
      KeadaanWajah.terdaftar => 'Wajah terdaftar',
      KeadaanWajah.menunggu => 'Menunggu persetujuan HR',
      KeadaanWajah.ditolak => 'Foto ditolak HR',
      KeadaanWajah.belum => 'Wajah belum terdaftar',
      KeadaanWajah.nonaktif => 'Verifikasi wajah dinonaktifkan',
    };
    final subjudul = switch (keadaan) {
      KeadaanWajah.terdaftar => 'Siap dipakai untuk check-in',
      KeadaanWajah.menunggu => s.menunggu?.dikirimPada == null ? 'Foto sedang diperiksa' : 'Dikirim ${_sambung(s.menunggu!.dikirimPada)}',
      KeadaanWajah.ditolak => s.penolakan?.ditolakPada == null ? 'Kirim foto baru' : 'Diperiksa ${_sambung(s.penolakan!.ditolakPada)}',
      KeadaanWajah.belum => 'Diperlukan untuk check-in Verifikasi Wajah',
      KeadaanWajah.nonaktif => 'Check-in pakai Lokasi GPS atau Pindai QR',
    };
    final keterangan = switch (keadaan) {
      KeadaanWajah.terdaftar =>
        'Anda bisa check-in dan check-out dengan Verifikasi Wajah. Perbarui foto bila penampilan Anda berubah jauh; foto baru juga diperiksa HR, dan foto lama tetap dipakai sampai disetujui.',
      KeadaanWajah.menunggu =>
        'HR sedang memeriksa foto Anda, dan Anda mendapat notifikasi setelah diputuskan. Sementara itu, check-in pakai Lokasi GPS atau Pindai QR. Bila foto tadi kurang jelas, kirim ulang — kiriman baru menggantikan yang sedang menunggu.',
      KeadaanWajah.ditolak => 'Perbaiki sesuai alasan dari HR, lalu kirim foto baru.',
      KeadaanWajah.belum =>
        'Ambil selfie sekali. Setelah HR memastikan wajah di foto memang Anda, Anda bisa check-in dengan Verifikasi Wajah.',
      KeadaanWajah.nonaktif => 'Perusahaan sedang tidak memakai verifikasi wajah. Pendaftaran bisa dilakukan setelah fitur ini diaktifkan kembali.',
    };
    final labelTombol = switch (keadaan) {
      KeadaanWajah.terdaftar => 'Perbarui foto',
      KeadaanWajah.menunggu => 'Kirim ulang foto',
      KeadaanWajah.ditolak => 'Kirim ulang',
      _ => 'Ambil selfie',
    };
    final ikonTombol = mengirim
        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
        : const Icon(Icons.photo_camera_outlined);
    final teksTombol = Text(mengirim ? 'Mengirim foto…' : labelTombol);
    // Tombol utama hanya bila karyawan memang harus bertindak.
    final tombolUtama = keadaan == KeadaanWajah.belum || keadaan == KeadaanWajah.ditolak;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: warna.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
                  child: Icon(
                    switch (keadaan) {
                      KeadaanWajah.terdaftar => Icons.check_circle,
                      KeadaanWajah.menunggu => Icons.hourglass_top_rounded,
                      KeadaanWajah.ditolak => Icons.cancel_outlined,
                      KeadaanWajah.belum => Icons.face_retouching_natural,
                      KeadaanWajah.nonaktif => Icons.face_retouching_off,
                    },
                    color: warna,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(judul, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                      Text(subjudul, style: TextStyle(color: skema.onSurfaceVariant, fontSize: 13)),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Text(keterangan, style: TextStyle(fontSize: 13, height: 1.5, color: skema.onSurfaceVariant)),
            if (keadaan == KeadaanWajah.ditolak)
              _Catatan(nada: Nada.bahaya, ikon: Icons.comment_outlined, teks: 'Alasan HR: ${s.penolakan?.alasan ?? 'tidak disebutkan'}'),
            if (keadaan == KeadaanWajah.terdaftar && s.menunggu != null)
              _Catatan(
                nada: Nada.info,
                ikon: Icons.hourglass_top_rounded,
                teks: 'Foto baru${s.menunggu!.dikirimPada == null ? '' : ' dikirim ${_sambung(s.menunggu!.dikirimPada)},'} menunggu persetujuan HR.',
              )
            else if (keadaan == KeadaanWajah.terdaftar && s.penolakan != null)
              _Catatan(nada: Nada.peringatan, ikon: Icons.comment_outlined, teks: 'Foto pembaruan ditolak HR: ${s.penolakan!.alasan ?? 'alasan tidak disebutkan'}. Foto lama tetap dipakai.'),
            if (galatKirim != null) _Catatan(nada: Nada.bahaya, ikon: Icons.error_outline, teks: 'Foto tadi belum bisa dipakai: $galatKirim'),
            if (keadaan != KeadaanWajah.nonaktif) ...[
              const SizedBox(height: 16),
              tombolUtama
                  ? FilledButton.icon(onPressed: mengirim ? null : kirim, icon: ikonTombol, label: teksTombol)
                  : OutlinedButton.icon(onPressed: mengirim ? null : kirim, icon: ikonTombol, label: teksTombol),
            ],
          ],
        ),
      ),
    );
  }
}

/// Kotak berwarna kecil untuk alasan penolakan dan keterangan tambahan.
class _Catatan extends StatelessWidget {
  const _Catatan({required this.nada, required this.ikon, required this.teks});
  final Nada nada;
  final IconData ikon;
  final String teks;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final warna = warnaNada(nada, skema);
    return Container(
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: warna.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(ikon, size: 18, color: warna),
          const SizedBox(width: 10),
          Expanded(child: Text(teks, style: TextStyle(fontSize: 13, height: 1.4, color: skema.onSurface, fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }
}

class _Langkah extends StatelessWidget {
  const _Langkah({required this.nomor, required this.teks});
  final int nomor;
  final String teks;
  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(radius: 11, backgroundColor: skema.primary, child: Text('$nomor', style: TextStyle(color: skema.onPrimary, fontSize: 12, fontWeight: FontWeight.w700))),
          const SizedBox(width: 10),
          Expanded(child: Text(teks, style: const TextStyle(fontSize: 13, height: 1.4))),
        ],
      ),
    );
  }
}

class _Tips extends StatelessWidget {
  const _Tips({required this.ikon, required this.teks});
  final IconData ikon;
  final String teks;
  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(ikon, size: 18, color: skema.primary),
          const SizedBox(width: 10),
          Expanded(child: Text(teks, style: const TextStyle(fontSize: 13, height: 1.4))),
        ],
      ),
    );
  }
}
