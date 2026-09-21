import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import 'model_whatsapp.dart';
import 'repo_whatsapp.dart';

/// Status tautan WhatsApp pribadi — hanya memeriksa. Menautkan dan memindai
/// ulang QR dilakukan lewat aplikasi web HRD.
class LayarWhatsApp extends ConsumerStatefulWidget {
  const LayarWhatsApp({super.key});
  @override
  ConsumerState<LayarWhatsApp> createState() => _LayarWhatsAppState();
}

class _LayarWhatsAppState extends ConsumerState<LayarWhatsApp> {
  Timer? _penyegar;

  @override
  void initState() {
    super.initState();
    // Status berubah begitu karyawan memindai QR di web; segarkan tiap 10 detik.
    _penyegar = Timer.periodic(const Duration(seconds: 10), (_) => ref.invalidate(tautanWhatsAppProvider));
  }

  @override
  void dispose() {
    _penyegar?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tautan = ref.watch(tautanWhatsAppProvider);
    final kejadian = ref.watch(kejadianSesiProvider);
    final skema = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Tautan WhatsApp')),
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
              loading: () => const Card(child: SizedBox(height: 140, child: Center(child: CircularProgressIndicator()))),
              error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(tautanWhatsAppProvider)),
              data: (t) => _KartuStatus(t),
            ),
            const JudulBagian('Cara menautkan / memindai ulang'),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: const [
                    _Langkah(nomor: 1, teks: 'Masuk ke aplikasi web HRD di komputer atau browser (bukan dari ponsel ini).'),
                    _Langkah(nomor: 2, teks: 'Buka menu WhatsApp Saya, tekan Tautkan / Pindai Ulang. Kode QR tampil di layar komputer.'),
                    _Langkah(nomor: 3, teks: 'Di ponsel ini: WhatsApp → Perangkat Tertaut → Tautkan perangkat → pindai kode di layar komputer.'),
                    _Langkah(nomor: 4, teks: 'Kembali ke sini; status berubah menjadi Tersambung dalam beberapa detik.'),
                  ],
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

class _KartuStatus extends StatelessWidget {
  const _KartuStatus(this.t);
  final TautanWhatsApp t;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    if (!t.driverAktif) {
      return Card(
        child: ListTile(
          leading: Icon(Icons.cloud_off, color: warnaNada(Nada.peringatan, skema)),
          title: const Text('Layanan WhatsApp sedang tidak aktif di server'),
          subtitle: const Text('Coba lagi nanti. Bila berlanjut, hubungi HR.'),
        ),
      );
    }
    final nada = t.tersambung ? Nada.sukses : t.menungguScan ? Nada.info : t.status == 'inactive' ? Nada.netral : Nada.bahaya;
    final judul = switch (t.status) {
      'connected' => 'WhatsApp tersambung',
      'connecting' || 'pending_scan' => 'Menunggu pemindaian QR di web',
      'disconnected' => 'Tautan WhatsApp terputus',
      'inactive' => 'Tautan dinonaktifkan HR',
      _ => 'WhatsApp belum ditautkan',
    };
    final keterangan = switch (t.status) {
      'connected' => 'Pesan Anda tersinkron ke sistem perusahaan${t.tersambungPada != null ? ' sejak ${formatTanggalWaktu(t.tersambungPada)}' : ''}. Jangan hapus perangkat tertaut "HRD Nusantara" di WhatsApp.',
      'connecting' || 'pending_scan' => 'Kode QR sedang tampil di aplikasi web. Pindai dengan WhatsApp di ponsel ini; status di sini berubah otomatis.',
      'disconnected' => 'Pesan Anda tidak lagi tersinkron${t.terputusPada != null ? ' sejak ${formatRelatif(t.terputusPada)}' : ''}. Masuk ke aplikasi web HRD untuk memindai ulang.',
      'inactive' => 'Hubungi HR untuk mengaktifkannya kembali.',
      _ => 'Perusahaan mewajibkan WhatsApp setiap karyawan tersambung. Tautkan lewat aplikasi web HRD — langkahnya di bawah.',
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: warnaNada(nada, skema).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
                  child: Icon(t.tersambung ? Icons.check_circle : t.menungguScan ? Icons.qr_code_scanner : Icons.link_off, color: warnaNada(nada, skema)),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(judul, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                      Text(t.phoneNumber != null ? '+${t.phoneNumber}' : 'Nomor terisi otomatis setelah dipindai', style: TextStyle(color: skema.onSurfaceVariant, fontSize: 13)),
                    ],
                  ),
                ),
                LencanaStatus(t.status, label: switch (t.status) { 'never_linked' => 'Wajib', 'connecting' || 'pending_scan' => 'Menunggu', 'inactive' => 'Nonaktif', _ => labelUntuk(t.status) }, nada: nada),
              ],
            ),
            const SizedBox(height: 12),
            Text(keterangan, style: TextStyle(fontSize: 13, height: 1.5, color: skema.onSurfaceVariant)),
            if (t.tersambung) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Icon(t.adaGrup ? Icons.groups : Icons.group_off, size: 18, color: warnaNada(t.adaGrup ? Nada.sukses : Nada.peringatan, skema)),
                  const SizedBox(width: 8),
                  Expanded(child: Text(t.adaGrup ? 'Foto absensi dikirim ke grup "${t.grupNama}"' : 'Grup foto absensi belum dipilih — pilih di aplikasi web (WhatsApp Saya)', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
                ],
              ),
            ],
            if (t.catatan != null && !t.tersambung) Padding(padding: const EdgeInsets.only(top: 8), child: Text(t.catatan!, style: TextStyle(fontSize: 12, color: skema.error))),
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
