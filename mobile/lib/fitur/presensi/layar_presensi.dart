import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import 'layar_absen.dart';
import 'model_presensi.dart';
import 'repo_presensi.dart';

class LayarPresensi extends ConsumerWidget {
  const LayarPresensi({super.key});

  Future<void> _absen(BuildContext context, WidgetRef ref, {required bool pulang}) async {
    final hasil = await LayarAbsen.buka(context, pulang: pulang);
    if (hasil == null || !context.mounted) return;
    if (pulang) {
      tampilkanPesan(context, 'Check-out tercatat ${formatWaktu(hasil.jamPulang)}',
          rincian: 'Jam kerja ${formatDurasiMenit(hasil.menitKerja)}${(hasil.jamLembur ?? 0) > 0 ? ' · lembur ${hasil.jamLembur} jam menunggu persetujuan' : ''}');
    } else {
      final telat = (hasil.menitTerlambat ?? 0) > 0;
      tampilkanPesan(
        context,
        telat ? 'Check-in tercatat, terlambat ${hasil.menitTerlambat} menit' : 'Check-in tercatat ${formatWaktu(hasil.jamMasuk)}',
        rincian: '${hasil.namaLokasi ?? 'Lokasi terverifikasi'} · ${labelMetode[hasil.metodeMasuk] ?? ''}${hasil.wajahTerverifikasi ? ' · wajah cocok' : ''}',
        nada: telat ? Nada.peringatan : Nada.sukses,
      );
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hariIni = ref.watch(presensiHariIniProvider);
    final riwayat = ref.watch(riwayatPresensiProvider);
    final skema = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(title: const Text('Presensi')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(presensiHariIniProvider);
          ref.invalidate(riwayatPresensiProvider);
          await ref.read(riwayatPresensiProvider.future);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: hariIni.when(
                  loading: () => const SizedBox(height: 120, child: Center(child: CircularProgressIndicator())),
                  error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(presensiHariIniProvider)),
                  data: (p) => Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(formatTanggal(DateTime.now(), pola: 'EEEE, d MMMM yyyy'), style: TextStyle(color: skema.onSurfaceVariant)),
                      const SizedBox(height: 10),
                      Row(
                        children: [
                          Expanded(child: _Jam(label: 'Masuk', waktu: p?.jamMasuk, rincian: p?.menitTerlambat != null && p!.menitTerlambat! > 0 ? 'terlambat ${p.menitTerlambat} mnt' : (p?.metodeMasuk != null ? labelMetode[p!.metodeMasuk] : null))),
                          Container(width: 1, height: 44, color: skema.outlineVariant),
                          Expanded(child: _Jam(label: 'Pulang', waktu: p?.jamPulang, rincian: p?.menitKerja != null ? formatDurasiMenit(p!.menitKerja) : null)),
                        ],
                      ),
                      const SizedBox(height: 16),
                      if (p == null)
                        FilledButton.icon(onPressed: () => _absen(context, ref, pulang: false), icon: const Icon(Icons.login), label: const Text('Check-in Sekarang'))
                      else if (p.masihTerbuka)
                        FilledButton.icon(
                          onPressed: () => _absen(context, ref, pulang: true),
                          style: FilledButton.styleFrom(backgroundColor: skema.tertiary),
                          icon: const Icon(Icons.logout),
                          label: const Text('Check-out'),
                        )
                      else
                        Row(
                          children: [
                            const Icon(Icons.check_circle, color: Color(0xFF16A34A)),
                            const SizedBox(width: 8),
                            Expanded(child: Text('Presensi hari ini lengkap. ${p.lemburDisetujui ? 'Lembur disetujui.' : (p.jamLembur ?? 0) > 0 ? 'Lembur ${p.jamLembur} jam menunggu persetujuan.' : ''}', style: const TextStyle(fontWeight: FontWeight.w600))),
                          ],
                        ),
                    ],
                  ),
                ),
              ),
            ),
            const JudulBagian('30 hari terakhir'),
            riwayat.when(
              loading: () => const Pemuat(),
              error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(riwayatPresensiProvider)),
              data: (daftar) => daftar.isEmpty
                  ? const KeadaanKosong(ikon: Icons.event_busy, judul: 'Belum ada presensi', keterangan: 'Riwayat check-in Anda akan muncul di sini.')
                  : Card(
                      child: Column(
                        children: [
                          for (var i = 0; i < daftar.length; i++) ...[
                            if (i > 0) const Divider(),
                            _BarisPresensi(daftar[i]),
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

class _Jam extends StatelessWidget {
  const _Jam({required this.label, this.waktu, this.rincian});
  final String label;
  final DateTime? waktu;
  final String? rincian;
  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return Column(
      children: [
        Text(label, style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant)),
        Text(waktu == null ? '--:--' : formatWaktu(waktu), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, fontFeatures: [FontFeature.tabularFigures()])),
        if (rincian != null) Text(rincian!, style: TextStyle(fontSize: 11, color: skema.onSurfaceVariant)),
      ],
    );
  }
}

class _BarisPresensi extends StatelessWidget {
  const _BarisPresensi(this.p);
  final Presensi p;
  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return ListTile(
      leading: Container(
        width: 44,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: skema.surfaceContainerHighest, borderRadius: BorderRadius.circular(10)),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(formatTanggal(p.tanggal, pola: 'd'), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            Text(formatTanggal(p.tanggal, pola: 'MMM'), style: TextStyle(fontSize: 10, color: skema.onSurfaceVariant)),
          ],
        ),
      ),
      title: Text('${formatWaktu(p.jamMasuk)} – ${p.jamPulang == null ? '…' : formatWaktu(p.jamPulang)}', style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text([
        if (p.namaLokasi != null) p.namaLokasi!,
        if (p.menitKerja != null) formatDurasiMenit(p.menitKerja),
        if ((p.menitTerlambat ?? 0) > 0) 'telat ${p.menitTerlambat} mnt',
        if ((p.jamLembur ?? 0) > 0) 'lembur ${p.jamLembur} jam${p.lemburDisetujui ? ' ✓' : ''}',
      ].join(' · ')),
      trailing: LencanaStatus(p.status),
    );
  }
}
