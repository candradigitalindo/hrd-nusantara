import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import 'layar_slip.dart';
import 'repo_gaji.dart';

class LayarGaji extends ConsumerWidget {
  const LayarGaji({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final slip = ref.watch(slipSayaProvider);
    final skema = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Slip Gaji')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(slipSayaProvider);
          await ref.read(slipSayaProvider.future);
        },
        child: slip.when(
          loading: () => const Pemuat(),
          error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(slipSayaProvider)),
          data: (daftar) => daftar.isEmpty
              ? ListView(children: const [KeadaanKosong(ikon: Icons.receipt_long_outlined, judul: 'Belum ada slip gaji', keterangan: 'Slip muncul setelah HR menyetujui batch penggajian periode Anda.')])
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                  itemCount: daftar.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (_, i) {
                    final s = daftar[i];
                    return Card(
                      child: ListTile(
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => LayarSlip(id: s.id))),
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
                        leading: Container(
                          padding: const EdgeInsets.all(10),
                          decoration: BoxDecoration(color: skema.primary.withValues(alpha: 0.1), borderRadius: BorderRadius.circular(12)),
                          child: Icon(Icons.receipt_long, color: skema.primary),
                        ),
                        title: Text(s.labelPeriode, style: const TextStyle(fontWeight: FontWeight.w700)),
                        subtitle: Text('Bersih ${formatRupiah(s.bersih)}'),
                        trailing: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [LencanaStatus(s.status), const SizedBox(height: 4), Icon(Icons.chevron_right, size: 18, color: skema.onSurfaceVariant)],
                        ),
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  }
}
