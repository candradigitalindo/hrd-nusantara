import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import '../auth/sesi_provider.dart';
import 'model_shift.dart';
import 'repo_jadwal.dart';

class LayarJadwal extends ConsumerWidget {
  const LayarJadwal({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final jadwal = ref.watch(jadwalProvider);
    final fleksibel = ref.watch(jamFleksibelProvider);
    final skema = Theme.of(context).colorScheme;
    final hariIni = DateTime.now();
    return Scaffold(
      appBar: AppBar(title: const Text('Jadwal Shift')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(jadwalProvider);
          await Future.wait([
            ref.read(jadwalProvider.future),
            segarkanProfilDiam(ref),
          ]);
        },
        child: jadwal.when(
          loading: () => const Pemuat(),
          error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(jadwalProvider)),
          data: (semua) {
            // Salinan offline lama bisa memuat shift yang dibatalkan.
            final daftar = semua.where((s) => !s.dibatalkan).toList();
            if (daftar.isEmpty && !fleksibel) {
              return ListView(children: [KeadaanKosong(ikon: Icons.calendar_month_outlined, judul: 'Belum ada jadwal', keterangan: 'Jadwal ${_rentangKeDepan()} ke depan akan tampil di sini setelah atasan menyusunnya.')]);
            }
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
              itemCount: daftar.length + (fleksibel ? 1 : 0),
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (_, indeks) {
                if (fleksibel && indeks == 0) return const KartuJamFleksibel();
                final s = daftar[indeks - (fleksibel ? 1 : 0)];
                final tgl = DateTime.tryParse(s.tanggal)?.toUtc();
                final iniHariIni = tgl != null && tgl.year == hariIni.year && tgl.month == hariIni.month && tgl.day == hariIni.day;
                final lewat = tgl != null && DateTime(tgl.year, tgl.month, tgl.day).isBefore(DateTime(hariIni.year, hariIni.month, hariIni.day));
                return Card(
                  color: iniHariIni ? skema.primaryContainer : null,
                  child: ListTile(
                    leading: Container(
                      width: 48,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(color: iniHariIni ? skema.primary : skema.surfaceContainerHighest, borderRadius: BorderRadius.circular(10)),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(formatTanggalSaja(s.tanggal, pola: 'EEE'), style: TextStyle(fontSize: 10, color: iniHariIni ? skema.onPrimary : skema.onSurfaceVariant)),
                          Text(formatTanggalSaja(s.tanggal, pola: 'd'), style: TextStyle(fontWeight: FontWeight.w800, fontSize: 18, color: iniHariIni ? skema.onPrimary : null)),
                        ],
                      ),
                    ),
                    title: Row(
                      children: [
                        if (s.jenis != null) ...[
                          Container(
                            width: 8,
                            height: 8,
                            decoration: BoxDecoration(color: warnaJenisShift(s.jenis!.warna, Theme.of(context).brightness), shape: BoxShape.circle),
                          ),
                          const SizedBox(width: 6),
                        ],
                        Flexible(
                          // Word joiner setelah tanda pisah: bila tidak muat,
                          // baris dipatahkan setelah nama jenis, bukan di
                          // tengah jam ("07:00–" / "15:00").
                          child: Text(
                            '${s.jenis == null ? s.judul : s.judul.replaceAll('–', '–\u2060')}${s.lintasHari ? ' (+1 hari)' : ''}',
                            style: TextStyle(fontWeight: FontWeight.w700, color: lewat ? skema.onSurfaceVariant : null),
                          ),
                        ),
                        if (s.berulang) ...[
                          const SizedBox(width: 6),
                          Tooltip(
                            message: 'Jadwal berulang dari penugasan',
                            child: Icon(Icons.repeat_rounded, size: 16, color: skema.onSurfaceVariant, semanticLabel: 'Jadwal berulang'),
                          ),
                        ],
                      ],
                    ),
                    subtitle: Text([
                      formatTanggalSaja(s.tanggal, pola: 'd MMMM yyyy'),
                      if ((s.istirahatJam ?? 0) > 0) 'istirahat ${s.istirahatJam} jam',
                      if (s.catatan != null && s.catatan!.isNotEmpty) s.catatan!,
                    ].join(' · ')),
                    trailing: iniHariIni ? const LencanaStatus('today', label: 'Hari ini', nada: Nada.utama) : LencanaStatus(s.status),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }

  /// "2 minggu" untuk 14 hari, supaya teksnya tidak bohong bila rentangnya
  /// diubah.
  static String _rentangKeDepan() => hariJadwalKeDepan % 7 == 0 ? '${hariJadwalKeDepan ~/ 7} minggu' : '$hariJadwalKeDepan hari';
}

/// Keterangan untuk karyawan berjam fleksibel: tidak ada roster yang perlu
/// ditunggu, jadi daftar kosong bukan berarti "belum disusun".
class KartuJamFleksibel extends StatelessWidget {
  const KartuJamFleksibel({super.key});

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final warna = warnaNada(Nada.info, skema);
    return Card(
      margin: EdgeInsets.zero,
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: warna.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(10)),
              child: Icon(Icons.more_time_rounded, color: warna, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Anda memakai jam fleksibel — tidak ada roster shift', style: TextStyle(fontWeight: FontWeight.w700, fontSize: 14)),
                  const SizedBox(height: 4),
                  Text(
                    'Masuk dan pulang kapan saja sesuai kebutuhan, tanpa hitungan terlambat atau lembur. Presensi tetap di lokasi kerja.',
                    style: TextStyle(fontSize: 12.5, color: skema.onSurfaceVariant),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
