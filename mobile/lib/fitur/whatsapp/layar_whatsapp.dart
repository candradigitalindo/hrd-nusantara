import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import 'model_whatsapp.dart';
import 'repo_whatsapp.dart';

/// Karyawan menautkan WhatsApp pribadinya: wajib, supaya seluruh pesannya
/// tersinkron ke arsip perusahaan. Kalau sesi putus, layar ini pula tempat
/// memindai ulang.
class LayarWhatsApp extends ConsumerStatefulWidget {
  const LayarWhatsApp({super.key});
  @override
  ConsumerState<LayarWhatsApp> createState() => _LayarWhatsAppState();
}

class _LayarWhatsAppState extends ConsumerState<LayarWhatsApp> {
  Timer? _penyegar;
  bool _menyambung = false;

  @override
  void initState() {
    super.initState();
    // QR berganti tiap ±20 detik dan status berubah begitu ponsel memindai;
    // selama menunggu, tanya server tiap 3 detik.
    _penyegar = Timer.periodic(const Duration(seconds: 3), (_) {
      final t = ref.read(tautanWhatsAppProvider).value;
      if (t == null || t.menungguScan) ref.invalidate(tautanWhatsAppProvider);
    });
  }

  @override
  void dispose() {
    _penyegar?.cancel();
    super.dispose();
  }

  Future<void> _sambungkan() async {
    setState(() => _menyambung = true);
    try {
      await ref.read(repoWhatsAppProvider).sambungkan();
      ref.invalidate(tautanWhatsAppProvider);
      ref.invalidate(kejadianSesiProvider);
      if (mounted) tampilkanPesan(context, 'Menyiapkan kode QR', rincian: 'Siapkan WhatsApp di ponsel ini; kode muncul beberapa detik lagi.', nada: Nada.info);
    } catch (e) {
      if (mounted) tampilkanGalat(context, e, 'Belum bisa menautkan');
    } finally {
      if (mounted) setState(() => _menyambung = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tautan = ref.watch(tautanWhatsAppProvider);
    final kejadian = ref.watch(kejadianSesiProvider);
    final skema = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('WhatsApp Saya')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(tautanWhatsAppProvider);
          ref.invalidate(kejadianSesiProvider);
          await ref.read(tautanWhatsAppProvider.future);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
          children: [
            tautan.when(
              loading: () => const Card(child: SizedBox(height: 160, child: Center(child: CircularProgressIndicator()))),
              error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(tautanWhatsAppProvider)),
              data: (t) => _KartuTautan(t: t, menyambung: _menyambung, onSambungkan: _sambungkan),
            ),
            const JudulBagian('Mengapa wajib'),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Text(
                  'Percakapan WhatsApp karyawan diarsipkan ke sistem perusahaan untuk audit, pelacakan isu, dan analisis komunikasi internal. '
                  'Dengan menautkan nomor ini Anda menyetujui bahwa seluruh pesan teks (bukan berkas media, bukan grup) disinkronkan secara terenkripsi '
                  'dan hanya bisa dibaca HR yang berwenang. Percakapan grup dan status tidak diarsipkan.',
                  style: TextStyle(fontSize: 13, height: 1.5, color: skema.onSurfaceVariant),
                ),
              ),
            ),
            const JudulBagian('Riwayat sesi'),
            kejadian.when(
              loading: () => const Pemuat(),
              error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(kejadianSesiProvider)),
              data: (daftar) => daftar.isEmpty
                  ? const KeadaanKosong(ikon: Icons.history, judul: 'Belum ada riwayat', keterangan: 'Sambungan dan pemutusan sesi akan tercatat di sini.')
                  : Card(
                      child: Column(
                        children: [
                          for (var i = 0; i < daftar.length; i++) ...[
                            if (i > 0) const Divider(),
                            ListTile(
                              leading: Icon(daftar[i].perluScanUlang ? Icons.link_off : Icons.link, color: warnaNada(nadaStatus(daftar[i].jenis), skema)),
                              title: Text(labelUntuk(daftar[i].jenis), style: const TextStyle(fontWeight: FontWeight.w600)),
                              subtitle: Text(formatTanggalWaktu(daftar[i].waktu)),
                            ),
                          ],
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

class _KartuTautan extends StatelessWidget {
  const _KartuTautan({required this.t, required this.menyambung, required this.onSambungkan});
  final TautanWhatsApp t;
  final bool menyambung;
  final VoidCallback onSambungkan;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    Widget? qr;
    final data = t.qrDataUrl;
    if (t.status == 'pending_scan' && data != null && data.startsWith('data:image')) {
      try {
        qr = Image.memory(base64Decode(data.split(',').last), width: 240, height: 240, gaplessPlayback: true);
      } catch (_) {}
    }

    if (!t.driverAktif) {
      return Card(
        child: ListTile(
          leading: Icon(Icons.cloud_off, color: warnaNada(Nada.peringatan, skema)),
          title: const Text('Layanan WhatsApp sedang tidak aktif di server'),
          subtitle: const Text('Coba lagi nanti. Bila berlanjut, hubungi HR.'),
        ),
      );
    }

    final tombolSambung = FilledButton.icon(
      onPressed: menyambung ? null : onSambungkan,
      icon: menyambung ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Icon(Icons.qr_code_2),
      label: Text(t.belumPernah ? 'Sambungkan WhatsApp' : 'Sambungkan Ulang'),
    );

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
                  decoration: BoxDecoration(color: warnaNada(t.tersambung ? Nada.sukses : t.menungguScan ? Nada.info : Nada.peringatan, skema).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
                  child: Icon(t.tersambung ? Icons.check_circle : t.menungguScan ? Icons.qr_code_scanner : Icons.link_off, color: warnaNada(t.tersambung ? Nada.sukses : t.menungguScan ? Nada.info : Nada.peringatan, skema)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        switch (t.status) {
                          'connected' => 'WhatsApp tersambung',
                          'connecting' => 'Menyiapkan tautan…',
                          'pending_scan' => 'Pindai kode QR',
                          'disconnected' => 'Sesi terputus',
                          'inactive' => 'Tautan dinonaktifkan HR',
                          _ => 'WhatsApp belum tersambung',
                        },
                        style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
                      ),
                      Text(
                        t.phoneNumber != null ? '+${t.phoneNumber}' : 'Nomor terisi otomatis setelah dipindai',
                        style: TextStyle(color: skema.onSurfaceVariant, fontSize: 13),
                      ),
                    ],
                  ),
                ),
                LencanaStatus(t.status, label: switch (t.status) {
                  'never_linked' => 'Wajib',
                  'connecting' => 'Menyiapkan',
                  'inactive' => 'Nonaktif',
                  _ => labelUntuk(t.status),
                }, nada: t.tersambung ? Nada.sukses : t.menungguScan ? Nada.info : Nada.bahaya),
              ],
            ),
            const SizedBox(height: 14),
            if (t.tersambung) ...[
              Text('Pesan Anda tersinkron ke sistem perusahaan${t.tersambungPada != null ? ' sejak ${formatTanggalWaktu(t.tersambungPada)}' : ''}. Jangan keluar dari "Perangkat Tertaut" di WhatsApp, atau sesi akan putus.', style: TextStyle(fontSize: 13, color: skema.onSurfaceVariant)),
            ] else if (t.status == 'connecting') ...[
              const LinearProgressIndicator(),
              const SizedBox(height: 8),
              Text('Kode QR muncul beberapa detik lagi.', style: TextStyle(fontSize: 13, color: skema.onSurfaceVariant)),
            ] else if (qr != null) ...[
              Center(child: ClipRRect(borderRadius: BorderRadius.circular(12), child: Container(color: Colors.white, padding: const EdgeInsets.all(8), child: qr))),
              const SizedBox(height: 12),
              const _Langkah(nomor: 1, teks: 'Buka WhatsApp di ponsel ini, ketuk menu ⋮ (Android) atau Pengaturan (iPhone).'),
              const _Langkah(nomor: 2, teks: 'Pilih Perangkat Tertaut → Tautkan perangkat.'),
              const _Langkah(nomor: 3, teks: 'Arahkan kamera ke kode di atas. Kode berganti otomatis; layar ini memperbarui sendiri.'),
              if (t.catatan != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(t.catatan!, style: TextStyle(fontSize: 12, color: skema.error))),
            ] else ...[
              if (t.catatan != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(t.catatan!, style: TextStyle(fontSize: 13, color: skema.error))),
              if (t.status == 'inactive')
                Text('HR menonaktifkan tautan WhatsApp Anda. Hubungi HR untuk mengaktifkannya kembali.', style: TextStyle(fontSize: 13, color: skema.onSurfaceVariant))
              else ...[
                Text(
                  t.belumPernah
                      ? 'Perusahaan mewajibkan WhatsApp setiap karyawan tersambung ke aplikasi ini. Prosesnya satu menit: tekan tombol, lalu pindai kode QR dengan WhatsApp di ponsel ini.'
                      : 'Sesi terputus${t.terputusPada != null ? ' ${formatRelatif(t.terputusPada)}' : ''}. Sistem mencoba menyambung kembali; bila tidak berhasil, pindai ulang di sini.',
                  style: TextStyle(fontSize: 13, height: 1.5, color: skema.onSurfaceVariant),
                ),
                const SizedBox(height: 12),
                tombolSambung,
              ],
            ],
          ],
        ),
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
      padding: const EdgeInsets.only(bottom: 6),
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
