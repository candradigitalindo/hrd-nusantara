import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import 'layar_ajukan_cuti.dart';
import 'model_cuti.dart';
import 'repo_cuti.dart';

class LayarCuti extends ConsumerWidget {
  const LayarCuti({super.key});

  Future<void> _batalkan(BuildContext context, WidgetRef ref, Cuti c) async {
    final ya = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Batalkan pengajuan?'),
        content: Text('${c.jenisNama} ${formatTanggalSaja(c.mulai)} – ${formatTanggalSaja(c.selesai)} akan dibatalkan${c.status == 'approved' ? ' dan saldo dikembalikan' : ''}.'),
        actions: [
          TextButton.icon(onPressed: () => Navigator.pop(ctx, false), icon: const Icon(Icons.close), label: const Text('Tidak')),
          FilledButton.icon(onPressed: () => Navigator.pop(ctx, true), icon: const Icon(Icons.event_busy), label: const Text('Batalkan')),
        ],
      ),
    );
    if (ya != true || !context.mounted) return;
    try {
      await ref.read(repoCutiProvider).batalkan(c.id);
      ref.invalidate(riwayatCutiProvider);
      ref.invalidate(saldoCutiProvider);
      if (context.mounted) tampilkanPesan(context, 'Pengajuan dibatalkan', rincian: c.jenisNama);
    } catch (e) {
      if (context.mounted) tampilkanGalat(context, e, 'Tidak bisa dibatalkan');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final saldo = ref.watch(saldoCutiProvider);
    final riwayat = ref.watch(riwayatCutiProvider);
    final skema = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Cuti & Izin')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LayarAjukanCuti())),
        icon: const Icon(Icons.add),
        label: const Text('Ajukan'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(saldoCutiProvider);
          ref.invalidate(riwayatCutiProvider);
          await ref.read(riwayatCutiProvider.future);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
          children: [
            const JudulBagian('Saldo tahun ini'),
            saldo.when(
              loading: () => const Pemuat(),
              error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(saldoCutiProvider)),
              data: (daftar) => daftar.isEmpty
                  ? Card(child: Padding(padding: const EdgeInsets.all(16), child: Text('Belum ada saldo cuti yang ditetapkan HR untuk tahun ini.', style: TextStyle(color: skema.onSurfaceVariant))))
                  : SizedBox(
                      height: 110,
                      child: ListView.separated(
                        scrollDirection: Axis.horizontal,
                        itemCount: daftar.length,
                        separatorBuilder: (_, _) => const SizedBox(width: 10),
                        itemBuilder: (_, i) {
                          final s = daftar[i];
                          final porsi = s.jatah == 0 ? 0.0 : (s.sisa / s.jatah).clamp(0, 1).toDouble();
                          return SizedBox(
                            width: 170,
                            child: Card(
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(s.jenisNama, style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant), maxLines: 1, overflow: TextOverflow.ellipsis),
                                    const Spacer(),
                                    Text.rich(TextSpan(children: [
                                      TextSpan(text: '${s.sisa}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800)),
                                      TextSpan(text: ' / ${s.jatah} hari', style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant)),
                                    ])),
                                    const SizedBox(height: 6),
                                    ClipRRect(borderRadius: BorderRadius.circular(4), child: LinearProgressIndicator(value: porsi, minHeight: 5, color: porsi < 0.25 ? warnaNada(Nada.peringatan, skema) : skema.primary, backgroundColor: skema.surfaceContainerHighest)),
                                  ],
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
            ),
            const JudulBagian('Riwayat pengajuan'),
            riwayat.when(
              loading: () => const Pemuat(),
              error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(riwayatCutiProvider)),
              data: (daftar) => daftar.isEmpty
                  ? const KeadaanKosong(ikon: Icons.beach_access_outlined, judul: 'Belum ada pengajuan', keterangan: 'Ajukan cuti lewat tombol di bawah. Atasan Anda akan menerima permintaannya.')
                  : Card(
                      child: Column(
                        children: [
                          for (var i = 0; i < daftar.length; i++) ...[
                            if (i > 0) const Divider(),
                            ListTile(
                              title: Text('${daftar[i].jenisNama} · ${daftar[i].totalHari} hari', style: const TextStyle(fontWeight: FontWeight.w600)),
                              subtitle: Text([
                                '${formatTanggalSaja(daftar[i].mulai, pola: 'd MMM')} – ${formatTanggalSaja(daftar[i].selesai)}',
                                if (daftar[i].alasan != null && daftar[i].alasan!.isNotEmpty) daftar[i].alasan!,
                                if (daftar[i].catatanKeputusan != null) 'Catatan: ${daftar[i].catatanKeputusan}',
                              ].join('\n')),
                              isThreeLine: daftar[i].alasan != null || daftar[i].catatanKeputusan != null,
                              trailing: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                crossAxisAlignment: CrossAxisAlignment.end,
                                children: [
                                  LencanaStatus(daftar[i].status),
                                  if (daftar[i].bisaDibatalkan)
                                    TextButton.icon(
                                      style: TextButton.styleFrom(visualDensity: VisualDensity.compact, padding: EdgeInsets.zero, minimumSize: const Size(0, 28)),
                                      onPressed: () => _batalkan(context, ref, daftar[i]),
                                      icon: const Icon(Icons.event_busy, size: 15),
                                      label: const Text('Batalkan', style: TextStyle(fontSize: 12)),
                                    ),
                                ],
                              ),
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
