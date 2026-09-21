import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import '../auth/sesi_provider.dart';
import '../cuti/repo_cuti.dart';
import '../jadwal/repo_jadwal.dart';
import '../pengumuman/layar_pengumuman.dart';
import '../pengumuman/repo_pengumuman.dart';
import '../presensi/layar_absen.dart';
import '../presensi/repo_presensi.dart';
import '../whatsapp/repo_whatsapp.dart';

class LayarBeranda extends ConsumerWidget {
  const LayarBeranda({super.key});

  String _sapaan() {
    final jam = DateTime.now().hour;
    if (jam < 11) return 'Selamat pagi';
    if (jam < 15) return 'Selamat siang';
    if (jam < 18) return 'Selamat sore';
    return 'Selamat malam';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(penggunaProvider);
    final presensi = ref.watch(presensiHariIniProvider);
    final shift = ref.watch(shiftHariIniProvider);
    final saldo = ref.watch(saldoCutiProvider);
    final pengumuman = ref.watch(pengumumanProvider);
    final tautanWa = ref.watch(tautanWhatsAppProvider).value;
    final skema = Theme.of(context).colorScheme;

    Future<void> segarkan() async {
      ref.invalidate(presensiHariIniProvider);
      ref.invalidate(shiftHariIniProvider);
      ref.invalidate(saldoCutiProvider);
      ref.invalidate(pengumumanProvider);
      ref.invalidate(tautanWhatsAppProvider);
      await Future.wait([ref.read(presensiHariIniProvider.future), ref.read(pengumumanProvider.future)]);
    }

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: segarkan,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${_sapaan()},', style: TextStyle(color: skema.onSurfaceVariant)),
                        Text(p?.nama.split(' ').first ?? '', style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
                        Text(formatTanggal(DateTime.now(), pola: 'EEEE, d MMMM yyyy'), style: TextStyle(fontSize: 13, color: skema.onSurfaceVariant)),
                      ],
                    ),
                  ),
                  IconButton.filledTonal(onPressed: () => context.go('/profil'), icon: const Icon(Icons.person_outline), tooltip: 'Profil'),
                ],
              ),
              const SizedBox(height: 16),
              // Kewajiban dari dokumen fitur: WhatsApp tiap karyawan harus tersambung.
              if (tautanWa != null && tautanWa.perluTindakan && tautanWa.driverAktif)
                Card(
                  color: warnaNada(tautanWa.belumPernah ? Nada.peringatan : Nada.bahaya, skema).withValues(alpha: 0.12),
                  child: ListTile(
                    onTap: () => context.push('/whatsapp'),
                    leading: Icon(Icons.link_off, color: warnaNada(tautanWa.belumPernah ? Nada.peringatan : Nada.bahaya, skema)),
                    title: Text(tautanWa.belumPernah ? 'WhatsApp belum ditautkan' : 'Tautan WhatsApp terputus', style: const TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: Text(tautanWa.belumPernah ? 'Wajib. Tautkan lewat aplikasi web HRD; ketuk untuk melihat caranya.' : 'Pesan tidak tersinkron. Masuk ke aplikasi web HRD untuk memindai ulang QR.'),
                    trailing: const Icon(Icons.chevron_right),
                  ),
                ),
              if (tautanWa != null && tautanWa.perluTindakan && tautanWa.driverAktif) const SizedBox(height: 12),
              if (tautanWa != null && tautanWa.tersambung && !tautanWa.adaGrup)
                Card(
                  color: warnaNada(Nada.info, skema).withValues(alpha: 0.12),
                  child: ListTile(
                    onTap: () => context.push('/whatsapp'),
                    leading: Icon(Icons.groups_outlined, color: warnaNada(Nada.info, skema)),
                    title: const Text('Pilih grup WhatsApp untuk foto absensi', style: TextStyle(fontWeight: FontWeight.w700)),
                    subtitle: const Text('Dipilih sekali di aplikasi web; setiap absensi mengirim foto ber-stempel ke grup itu.'),
                    trailing: const Icon(Icons.chevron_right),
                  ),
                ),
              if (tautanWa != null && tautanWa.tersambung && !tautanWa.adaGrup) const SizedBox(height: 12),
              // Kartu presensi hari ini — tindakan utama karyawan tiap hari.
              Card(
                color: skema.primary,
                child: Padding(
                  padding: const EdgeInsets.all(18),
                  child: presensi.when(
                    loading: () => const SizedBox(height: 90, child: Center(child: CircularProgressIndicator(color: Colors.white))),
                    error: (e, _) => Text('Status presensi tidak bisa dimuat. Tarik untuk menyegarkan.', style: TextStyle(color: skema.onPrimary)),
                    data: (hariIni) {
                      final s = shift.value;
                      final judul = hariIni == null ? 'Belum check-in' : hariIni.masihTerbuka ? 'Sedang bekerja sejak ${formatWaktu(hariIni.jamMasuk)}' : 'Presensi hari ini lengkap';
                      final sub = s == null ? (shift.isLoading ? 'Memuat jadwal…' : 'Tidak ada shift terjadwal hari ini') : 'Shift ${s.mulai} – ${s.selesai}${s.lintasHari ? ' (+1)' : ''}';
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(judul, style: TextStyle(color: skema.onPrimary, fontSize: 18, fontWeight: FontWeight.w800)),
                          Text(sub, style: TextStyle(color: skema.onPrimary.withValues(alpha: 0.85))),
                          const SizedBox(height: 14),
                          if (hariIni == null || hariIni.masihTerbuka)
                            FilledButton.icon(
                              style: FilledButton.styleFrom(backgroundColor: skema.onPrimary, foregroundColor: skema.primary),
                              onPressed: () async {
                                final hasil = await LayarAbsen.buka(context, pulang: hariIni != null);
                                if (hasil != null && context.mounted) {
                                  tampilkanPesan(context, hariIni == null ? 'Check-in tercatat ${formatWaktu(hasil.jamMasuk)}' : 'Check-out tercatat ${formatWaktu(hasil.jamPulang)}',
                                      rincian: hariIni == null ? (hasil.menitTerlambat ?? 0) > 0 ? 'Terlambat ${hasil.menitTerlambat} menit' : (hasil.namaLokasi ?? '') : 'Jam kerja ${formatDurasiMenit(hasil.menitKerja)}',
                                      nada: (hasil.menitTerlambat ?? 0) > 0 && hariIni == null ? Nada.peringatan : Nada.sukses);
                                }
                              },
                              icon: Icon(hariIni == null ? Icons.login : Icons.logout),
                              label: Text(hariIni == null ? 'Check-in' : 'Check-out'),
                            )
                          else
                            Text('Masuk ${formatWaktu(hariIni.jamMasuk)} · pulang ${formatWaktu(hariIni.jamPulang)} · ${formatDurasiMenit(hariIni.menitKerja)}', style: TextStyle(color: skema.onPrimary, fontWeight: FontWeight.w600)),
                        ],
                      );
                    },
                  ),
                ),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: saldo.when(
                      loading: () => const KartuStatistik(label: 'Sisa cuti tahunan', nilai: '…'),
                      error: (_, _) => const KartuStatistik(label: 'Sisa cuti', nilai: '—', nada: Nada.netral),
                      data: (d) {
                        final tahunan = d.where((s) => s.jenisNama.toLowerCase().contains('tahun')).firstOrNull ?? d.firstOrNull;
                        return KartuStatistik(label: tahunan == null ? 'Sisa cuti' : 'Sisa ${tahunan.jenisNama.toLowerCase()}', nilai: tahunan == null ? '—' : '${tahunan.sisa} hari', keterangan: tahunan == null ? null : 'dari ${tahunan.jatah}', ikon: Icons.beach_access_outlined, nada: Nada.info);
                      },
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: pengumuman.when(
                      loading: () => const KartuStatistik(label: 'Belum dibaca', nilai: '…', ikon: Icons.campaign_outlined),
                      error: (_, _) => const KartuStatistik(label: 'Pengumuman', nilai: '—', nada: Nada.netral),
                      data: (d) {
                        final belum = d.where((x) => !x.sudahDibaca).length;
                        return KartuStatistik(label: 'Pengumuman belum dibaca', nilai: '$belum', keterangan: d.any((x) => x.perluKonfirmasi) ? 'ada yang perlu konfirmasi' : null, ikon: Icons.campaign_outlined, nada: belum > 0 ? Nada.peringatan : Nada.sukses);
                      },
                    ),
                  ),
                ],
              ),
              const JudulBagian('Akses cepat'),
              GridView.count(
                crossAxisCount: 4,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 8,
                crossAxisSpacing: 8,
                childAspectRatio: 0.9,
                children: [
                  _Pintasan(ikon: Icons.calendar_month_outlined, label: 'Jadwal', onTap: () => context.push('/jadwal')),
                  _Pintasan(ikon: Icons.beach_access_outlined, label: 'Cuti', onTap: () => context.go('/cuti')),
                  _Pintasan(ikon: Icons.receipt_long_outlined, label: 'Slip Gaji', onTap: () => context.go('/gaji')),
                  _Pintasan(ikon: Icons.forum_outlined, label: 'Chat', onTap: () => context.push('/chat')),
                  _Pintasan(ikon: Icons.poll_outlined, label: 'Survei', onTap: () => context.push('/survei')),
                  _Pintasan(ikon: Icons.phone_android_outlined, label: 'WhatsApp', onTap: () => context.push('/whatsapp')),
                  _Pintasan(ikon: Icons.history, label: 'Riwayat', onTap: () => context.go('/presensi')),
                  _Pintasan(ikon: Icons.person_outline, label: 'Profil', onTap: () => context.go('/profil')),
                ],
              ),
              JudulBagian('Pengumuman terbaru', aksi: TextButton(onPressed: () => context.push('/pengumuman'), child: const Text('Semua'))),
              pengumuman.when(
                loading: () => const Pemuat(),
                error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(pengumumanProvider)),
                data: (d) => d.isEmpty
                    ? const KeadaanKosong(ikon: Icons.campaign_outlined, judul: 'Belum ada pengumuman')
                    : Column(children: [for (final x in d.take(3)) Padding(padding: const EdgeInsets.only(bottom: 8), child: KartuPengumuman(x))]),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Pintasan extends StatelessWidget {
  const _Pintasan({required this.ikon, required this.label, required this.onTap});
  final IconData ikon;
  final String label;
  final VoidCallback onTap;
  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: skema.surface, borderRadius: BorderRadius.circular(14), border: Border.all(color: skema.outlineVariant.withValues(alpha: 0.5))),
            child: Icon(ikon, color: skema.primary),
          ),
          const SizedBox(height: 6),
          Text(label, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600), maxLines: 1, overflow: TextOverflow.ellipsis),
        ],
      ),
    );
  }
}
