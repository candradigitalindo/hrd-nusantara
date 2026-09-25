import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import '../antrean/layar_antrean.dart';
import 'model_pengumuman.dart';
import 'repo_pengumuman.dart';

class LayarPengumuman extends ConsumerWidget {
  const LayarPengumuman({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final data = ref.watch(pengumumanProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Pengumuman')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(pengumumanProvider);
          await ref.read(pengumumanProvider.future);
        },
        child: data.when(
          loading: () => const Pemuat(),
          error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(pengumumanProvider)),
          data: (daftar) => daftar.isEmpty
              ? ListView(children: const [KeadaanKosong(ikon: Icons.campaign_outlined, judul: 'Belum ada pengumuman')])
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                  itemCount: daftar.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (_, i) => KartuPengumuman(daftar[i]),
                ),
        ),
      ),
    );
  }
}

class KartuPengumuman extends StatelessWidget {
  const KartuPengumuman(this.p, {super.key});
  final Pengumuman p;
  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return Card(
      child: ListTile(
        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => LayarDetailPengumuman(p))),
        leading: Container(
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(color: warnaNada(nadaStatus(p.prioritas) == Nada.netral ? Nada.info : nadaStatus(p.prioritas), skema).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
          child: Icon(p.prioritas == 'urgent' ? Icons.priority_high_rounded : Icons.campaign_outlined, color: warnaNada(nadaStatus(p.prioritas) == Nada.netral ? Nada.info : nadaStatus(p.prioritas), skema)),
        ),
        title: Text(p.judul, style: TextStyle(fontWeight: p.sudahDibaca ? FontWeight.w500 : FontWeight.w800)),
        subtitle: Text('${p.penulis ?? 'HR'} · ${formatRelatif(p.tayangPada)}${p.perluKonfirmasi ? ' · perlu konfirmasi' : ''}'),
        trailing: p.prioritas != 'normal' ? LencanaStatus(p.prioritas) : (!p.sudahDibaca ? Container(width: 10, height: 10, decoration: BoxDecoration(color: skema.primary, shape: BoxShape.circle)) : null),
      ),
    );
  }
}

class LayarDetailPengumuman extends ConsumerStatefulWidget {
  const LayarDetailPengumuman(this.awal, {super.key});
  final Pengumuman awal;
  @override
  ConsumerState<LayarDetailPengumuman> createState() => _LayarDetailPengumumanState();
}

class _LayarDetailPengumumanState extends ConsumerState<LayarDetailPengumuman> {
  late Pengumuman _p = widget.awal;
  bool _proses = false;

  @override
  void initState() {
    super.initState();
    if (!_p.sudahDibaca) _tandai(konfirmasi: false, diam: true);
  }

  Future<void> _tandai({required bool konfirmasi, bool diam = false}) async {
    if (!diam) setState(() => _proses = true);
    try {
      final h = await ref.read(repoPengumumanProvider).tandaiBaca(_p, konfirmasi: konfirmasi);
      if (!h.tertunda) ref.invalidate(pengumumanProvider);
      if (!mounted) return;
      setState(() => _p = _p.salin(sudahDibaca: true, dikonfirmasiPada: konfirmasi ? DateTime.now() : null));
      if (konfirmasi && h.tertunda) {
        tampilkanTertunda(context, 'Konfirmasi');
      } else if (konfirmasi) {
        tampilkanPesan(context, 'Konfirmasi tercatat', rincian: 'HR melihat bahwa Anda sudah membaca dan memahami pengumuman ini.');
      }
    } catch (e) {
      if (!diam && mounted) tampilkanGalat(context, e);
    } finally {
      if (!diam && mounted) setState(() => _proses = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Pengumuman')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 32),
        children: [
          if (_p.prioritas != 'normal') Align(alignment: Alignment.centerLeft, child: LencanaStatus(_p.prioritas)),
          const SizedBox(height: 8),
          Text(_p.judul, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Text('${_p.penulis ?? 'HR'} · ${formatTanggalWaktu(_p.tayangPada)}${_p.berakhirPada != null ? ' · berlaku sampai ${formatTanggal(_p.berakhirPada)}' : ''}', style: TextStyle(color: skema.onSurfaceVariant, fontSize: 13)),
          const Divider(height: 28),
          SelectableText(_p.isi, style: const TextStyle(fontSize: 15, height: 1.55)),
          const SizedBox(height: 28),
          if (_p.wajibKonfirmasi)
            _p.dikonfirmasiPada != null
                ? Row(children: [const Icon(Icons.verified, color: Color(0xFF16A34A)), const SizedBox(width: 8), Text('Dikonfirmasi ${formatTanggalWaktu(_p.dikonfirmasiPada)}', style: const TextStyle(fontWeight: FontWeight.w600))])
                : FilledButton.icon(
                    onPressed: _proses ? null : () => _tandai(konfirmasi: true),
                    icon: const Icon(Icons.check),
                    label: const Text('Saya sudah membaca dan memahami'),
                  ),
        ],
      ),
    );
  }
}
