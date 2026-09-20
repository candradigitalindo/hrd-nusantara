import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import 'model_whatsapp.dart';
import 'repo_whatsapp.dart';

/// Status sesi WhatsApp nomor perusahaan yang dipegang karyawan ini, dan QR
/// untuk memindai ulang bila sesinya terputus.
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
    // QR Baileys berganti tiap ±20 detik; segarkan supaya tidak kedaluwarsa di layar.
    _penyegar = Timer.periodic(const Duration(seconds: 15), (_) {
      final akun = ref.read(kejadianSesiProvider).value?.map((k) => k.akunId).toSet() ?? {};
      for (final id in akun) {
        ref.invalidate(sesiWhatsAppProvider(id));
      }
    });
  }

  @override
  void dispose() {
    _penyegar?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final kejadian = ref.watch(kejadianSesiProvider);
    final skema = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('WhatsApp Perusahaan')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(kejadianSesiProvider);
          await ref.read(kejadianSesiProvider.future);
        },
        child: kejadian.when(
          loading: () => const Pemuat(),
          error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(kejadianSesiProvider)),
          data: (daftar) {
            if (daftar.isEmpty) {
              return ListView(children: const [KeadaanKosong(ikon: Icons.phone_android_outlined, judul: 'Tidak ada nomor perusahaan', keterangan: 'Layar ini hanya untuk pemegang nomor WhatsApp perusahaan. Kalau Anda memegangnya, HR perlu menautkan nomor itu ke akun Anda.')]);
            }
            final akun = <String, KejadianSesi>{};
            for (final k in daftar) {
              akun.putIfAbsent(k.akunId, () => k);
            }
            return ListView(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
              children: [
                for (final k in akun.values) _KartuSesi(akunId: k.akunId, label: k.labelAkun, nomor: k.nomor),
                const JudulBagian('Riwayat kejadian'),
                Card(
                  child: Column(
                    children: [
                      for (var i = 0; i < daftar.length; i++) ...[
                        if (i > 0) const Divider(),
                        ListTile(
                          leading: Icon(daftar[i].perluScanUlang ? Icons.link_off : Icons.link, color: warnaNada(nadaStatus(daftar[i].jenis), skema)),
                          title: Text(labelUntuk(daftar[i].jenis), style: const TextStyle(fontWeight: FontWeight.w600)),
                          subtitle: Text('${daftar[i].labelAkun} · ${formatTanggalWaktu(daftar[i].waktu)}'),
                        ),
                      ],
                    ],
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _KartuSesi extends ConsumerWidget {
  const _KartuSesi({required this.akunId, required this.label, required this.nomor});
  final String akunId;
  final String label;
  final String nomor;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sesi = ref.watch(sesiWhatsAppProvider(akunId));
    final skema = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: sesi.when(
          loading: () => const SizedBox(height: 80, child: Center(child: CircularProgressIndicator())),
          error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(sesiWhatsAppProvider(akunId))),
          data: (s) {
            Widget? qr;
            final data = s.qrDataUrl;
            if (s.qrTersedia && data != null && data.startsWith('data:image')) {
              try {
                qr = Image.memory(base64Decode(data.split(',').last), width: 220, height: 220, gaplessPlayback: true);
              } catch (_) {}
            }
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(children: [Expanded(child: Text(s.label.isEmpty ? label : s.label, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16))), LencanaStatus(s.status)]),
                Text(s.nomor.isEmpty ? nomor : s.nomor, style: TextStyle(color: skema.onSurfaceVariant)),
                if (s.catatan != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(s.catatan!, style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant))),
                if (qr != null) ...[
                  const SizedBox(height: 14),
                  Center(child: ClipRRect(borderRadius: BorderRadius.circular(12), child: Container(color: Colors.white, padding: const EdgeInsets.all(8), child: qr))),
                  const SizedBox(height: 10),
                  Text('Buka WhatsApp di ponsel nomor ini → Perangkat Tertaut → Tautkan perangkat, lalu pindai kode di atas. Kode berganti otomatis.', style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant)),
                ] else if (s.status == 'connected') ...[
                  const SizedBox(height: 10),
                  const Row(children: [Icon(Icons.check_circle, color: Color(0xFF16A34A), size: 18), SizedBox(width: 6), Text('Sesi tersambung, pesan tersinkron ke sistem.', style: TextStyle(fontWeight: FontWeight.w600))]),
                ] else ...[
                  const SizedBox(height: 10),
                  Text('Sesi terputus. Backend sedang menyambungkan ulang; kalau QR dibutuhkan, kodenya akan muncul di sini.', style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant)),
                ],
              ],
            );
          },
        ),
      ),
    );
  }
}
