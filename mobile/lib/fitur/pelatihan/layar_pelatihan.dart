import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import 'repo_pelatihan.dart';

/// Pelatihan dari sisi karyawan: sesi terjadwal yang bisa diikuti (daftar /
/// daftar tunggu / batalkan) dan riwayat pelatihannya sendiri beserta hasil.
class LayarPelatihan extends ConsumerWidget {
  const LayarPelatihan({super.key});

  Future<void> _daftar(BuildContext context, WidgetRef ref, SesiPelatihan s) async {
    try {
      final p = await ref.read(repoPelatihanProvider).daftar(s.id);
      ref.invalidate(pendaftaranSayaProvider);
      ref.invalidate(sesiTerjadwalProvider);
      if (context.mounted) {
        tampilkanPesan(
          context,
          p.status == 'waitlisted' ? 'Masuk daftar tunggu' : 'Terdaftar',
          rincian: '${s.judul} · ${formatTanggal(s.mulai, pola: 'EEE, d MMM HH:mm')}',
          nada: p.status == 'waitlisted' ? Nada.peringatan : Nada.sukses,
        );
      }
    } catch (e) {
      if (context.mounted) tampilkanGalat(context, e, 'Pendaftaran gagal');
    }
  }

  Future<void> _batalkan(BuildContext context, WidgetRef ref, PendaftaranPelatihan p) async {
    final ya = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Batalkan pendaftaran?'),
        content: Text('${p.judul}${p.mulai != null ? ' · ${formatTanggal(p.mulai, pola: 'EEE, d MMM')}' : ''}. Kursi Anda diberikan ke peserta daftar tunggu.'),
        actions: [
          TextButton.icon(onPressed: () => Navigator.pop(ctx, false), icon: const Icon(Icons.close), label: const Text('Tidak')),
          FilledButton.icon(onPressed: () => Navigator.pop(ctx, true), icon: const Icon(Icons.event_busy), label: const Text('Batalkan')),
        ],
      ),
    );
    if (ya != true || !context.mounted) return;
    try {
      await ref.read(repoPelatihanProvider).batalkan(p.id);
      ref.invalidate(pendaftaranSayaProvider);
      ref.invalidate(sesiTerjadwalProvider);
      if (context.mounted) tampilkanPesan(context, 'Pendaftaran dibatalkan', rincian: p.judul);
    } catch (e) {
      if (context.mounted) tampilkanGalat(context, e, 'Tidak bisa dibatalkan');
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sesi = ref.watch(sesiTerjadwalProvider);
    final saya = ref.watch(pendaftaranSayaProvider);
    final skema = Theme.of(context).colorScheme;
    PendaftaranPelatihan? pendaftaranUntuk(String sesiId) =>
        (saya.value ?? const <PendaftaranPelatihan>[]).where((p) => p.sesiId == sesiId && p.status != 'cancelled').firstOrNull;

    return Scaffold(
      appBar: AppBar(title: const Text('Pelatihan')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(sesiTerjadwalProvider);
          ref.invalidate(pendaftaranSayaProvider);
          await ref.read(pendaftaranSayaProvider.future);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
          children: [
            const JudulBagian('Sesi yang bisa diikuti'),
            sesi.when(
              loading: () => const Pemuat(),
              error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(sesiTerjadwalProvider)),
              data: (daftar) => daftar.isEmpty
                  ? const KeadaanKosong(
                      ikon: Icons.school_outlined,
                      judul: 'Belum ada sesi terjadwal',
                      keterangan: 'HR membuka sesi pelatihan dari waktu ke waktu; pantau pengumuman.',
                    )
                  : Column(
                      children: [
                        for (final s in daftar)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 10),
                            child: _KartuSesi(
                              s: s,
                              pendaftaran: pendaftaranUntuk(s.id),
                              onDaftar: () => _daftar(context, ref, s),
                              onBatal: (p) => _batalkan(context, ref, p),
                            ),
                          ),
                      ],
                    ),
            ),
            const JudulBagian('Riwayat pelatihan saya'),
            saya.when(
              loading: () => const Pemuat(),
              error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(pendaftaranSayaProvider)),
              data: (daftar) => daftar.isEmpty
                  ? Card(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Text('Belum pernah mendaftar pelatihan.', style: TextStyle(color: skema.onSurfaceVariant, fontSize: 13)),
                      ),
                    )
                  : Card(
                      child: Column(
                        children: [
                          for (var i = 0; i < daftar.length; i++) ...[
                            if (i > 0) const Divider(),
                            _UbinRiwayat(daftar[i]),
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

class _KartuSesi extends StatelessWidget {
  const _KartuSesi({required this.s, required this.pendaftaran, required this.onDaftar, required this.onBatal});
  final SesiPelatihan s;
  final PendaftaranPelatihan? pendaftaran;
  final VoidCallback onDaftar;
  final ValueChanged<PendaftaranPelatihan> onBatal;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final p = pendaftaran;
    final jadwal = s.mulai == null
        ? 'Jadwal menyusul'
        : '${formatTanggal(s.mulai, pola: 'EEEE, d MMM yyyy')} · ${formatWaktu(s.mulai)}${s.selesai != null ? '–${formatWaktu(s.selesai)}' : ''}';
    final tempat = [s.pelatih, s.lokasi].whereType<String>().where((x) => x.isNotEmpty).join(' · ');
    final kuota = '${s.jumlahPendaftar}${s.kuota != null ? '/${s.kuota}' : ''} peserta${s.batasDaftar != null ? ' · daftar s/d ${formatTanggal(s.batasDaftar, pola: 'd MMM')}' : ''}';
    final tombolKecil = FilledButton.styleFrom(minimumSize: const Size(0, 36), padding: const EdgeInsets.symmetric(horizontal: 14), visualDensity: VisualDensity.compact);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 46,
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  decoration: BoxDecoration(color: skema.secondaryContainer, borderRadius: BorderRadius.circular(12)),
                  child: Column(
                    children: [
                      Text(s.mulai == null ? '—' : '${s.mulai!.day}', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: skema.onSecondaryContainer, height: 1)),
                      Text(s.mulai == null ? '' : formatTanggal(s.mulai, pola: 'MMM'), style: TextStyle(fontSize: 10.5, fontWeight: FontWeight.w600, color: skema.onSecondaryContainer)),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(s.judul, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
                      if (s.program != null) Text(s.program!, style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant)),
                      const SizedBox(height: 4),
                      Text(jadwal, style: const TextStyle(fontSize: 12.5)),
                      if (tempat.isNotEmpty) Text(tempat, style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant)),
                    ],
                  ),
                ),
              ],
            ),
            if (s.keterangan != null && s.keterangan!.trim().isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(s.keterangan!, maxLines: 3, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12.5, color: skema.onSurfaceVariant, height: 1.35)),
              ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      Text(kuota, style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant)),
                      if (s.wajib) const LencanaStatus('wajib', label: 'Wajib', nada: Nada.peringatan),
                      if (p != null) LencanaStatus(p.status),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                if (p != null && p.aktif && s.status == 'scheduled')
                  TextButton.icon(
                    onPressed: () => onBatal(p),
                    style: TextButton.styleFrom(foregroundColor: skema.error, visualDensity: VisualDensity.compact),
                    icon: const Icon(Icons.event_busy, size: 18),
                    label: const Text('Batalkan'),
                  )
                else if (p == null && s.bukaPendaftaran)
                  FilledButton.tonalIcon(
                    onPressed: onDaftar,
                    style: tombolKecil,
                    icon: Icon(s.penuh ? Icons.hourglass_empty : Icons.how_to_reg, size: 18),
                    label: Text(s.penuh ? 'Daftar Tunggu' : 'Daftar'),
                  )
                else if (p == null)
                  Text('Pendaftaran ditutup', style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _UbinRiwayat extends StatelessWidget {
  const _UbinRiwayat(this.p);
  final PendaftaranPelatihan p;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final rincian = [
      if (p.program != null) p.program!,
      if (p.mulai != null) formatTanggal(p.mulai, pola: 'd MMM yyyy'),
      if (p.nilai != null) 'nilai ${formatAngka(p.nilai)}${p.lulus == true ? ' · lulus' : p.lulus == false ? ' · tidak lulus' : ''}',
      if (p.berlakuSampai != null) 'berlaku s/d ${formatTanggal(p.berlakuSampai)}',
      if (p.sertifikatUrl != null && p.sertifikatUrl!.isNotEmpty) 'sertifikat tersedia',
    ].join(' · ');
    return ListTile(
      leading: Container(
        padding: const EdgeInsets.all(9),
        decoration: BoxDecoration(color: warnaNada(nadaStatus(p.status), skema).withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
        child: Icon(
          p.lulus == true ? Icons.workspace_premium_outlined : Icons.school_outlined,
          color: warnaNada(nadaStatus(p.status), skema),
          size: 20,
        ),
      ),
      title: Text(p.judul, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(rincian.isEmpty ? '—' : rincian, style: const TextStyle(fontSize: 12)),
          const SizedBox(height: 5),
          LencanaStatus(p.status),
        ],
      ),
    );
  }
}
