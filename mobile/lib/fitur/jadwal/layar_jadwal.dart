import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import 'repo_jadwal.dart';

class LayarJadwal extends ConsumerWidget {
  const LayarJadwal({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final jadwal = ref.watch(jadwalProvider);
    final skema = Theme.of(context).colorScheme;
    final hariIni = DateTime.now();
    return Scaffold(
      appBar: AppBar(title: const Text('Jadwal Shift')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(jadwalProvider);
          await ref.read(jadwalProvider.future);
        },
        child: jadwal.when(
          loading: () => const Pemuat(),
          error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(jadwalProvider)),
          data: (daftar) {
            if (daftar.isEmpty) {
              return ListView(children: const [KeadaanKosong(ikon: Icons.calendar_month_outlined, judul: 'Belum ada jadwal', keterangan: 'Jadwal 3 minggu ke depan akan tampil di sini setelah atasan menyusunnya.')]);
            }
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
              itemCount: daftar.length,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (_, i) {
                final s = daftar[i];
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
                    title: Text('${s.mulai} – ${s.selesai}${s.lintasHari ? ' (+1 hari)' : ''}', style: TextStyle(fontWeight: FontWeight.w700, color: lewat ? skema.onSurfaceVariant : null)),
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
}
