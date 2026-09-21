import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import '../auth/model_pengguna.dart';
import '../profil/layar_profil.dart' show labelPeran;
import '../auth/sesi_provider.dart';
import '../cuti/model_cuti.dart';
import '../cuti/repo_cuti.dart';
import '../gaji/model_gaji.dart';
import '../gaji/repo_gaji.dart';
import '../jadwal/model_shift.dart';
import '../jadwal/repo_jadwal.dart';
import '../pelatihan/repo_pelatihan.dart';
import '../pengumuman/layar_pengumuman.dart';
import '../pengumuman/model_pengumuman.dart';
import '../pengumuman/repo_pengumuman.dart';
import '../presensi/layar_absen.dart';
import '../presensi/model_presensi.dart';
import '../presensi/repo_presensi.dart';
import '../survei/model_survei.dart';
import '../survei/repo_survei.dart';
import '../whatsapp/repo_whatsapp.dart';

/// Beranda karyawan: apa yang harus dikerjakan hari ini, lalu ringkasan
/// kehadiran, jadwal, cuti, gaji, pelatihan, dan pengumuman. Setiap bagian
/// hanya tampil bila menunya termasuk peran pengguna (izin halaman.*), dan
/// datanya baru diminta bila bagian itu memang tampil.
class LayarBeranda extends ConsumerWidget {
  const LayarBeranda({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(penggunaProvider);
    bool boleh(String izin) => p == null || p.punyaIzin(izin);
    final bolehPresensi = boleh('halaman.presensi');
    final bolehCuti = boleh('halaman.cuti');
    final bolehGaji = boleh('halaman.gaji');
    final bolehPengumuman = boleh('halaman.pengumuman');
    final bolehChat = boleh('halaman.chat');
    final bolehWa = boleh('halaman.whatsapp_saya');
    final bolehPelatihan = boleh('halaman.pelatihan');

    // ref.watch bersyarat sengaja: bagian yang tidak tampil tidak perlu
    // memanggil API-nya (server toh akan menolak dengan 403).
    final presensi = bolehPresensi ? ref.watch(presensiHariIniProvider) : null;
    final shift = bolehPresensi ? ref.watch(shiftHariIniProvider) : null;
    final jadwal = bolehPresensi ? ref.watch(jadwalProvider) : null;
    final riwayat = bolehPresensi ? ref.watch(riwayatPresensiProvider) : null;
    final saldo = bolehCuti ? ref.watch(saldoCutiProvider) : null;
    final cuti = bolehCuti ? ref.watch(riwayatCutiProvider) : null;
    final slip = bolehGaji ? ref.watch(slipSayaProvider) : null;
    final pengumuman = bolehPengumuman ? ref.watch(pengumumanProvider) : null;
    final survei = bolehPengumuman ? ref.watch(surveiProvider) : null;
    final pelatihan = bolehPelatihan
        ? ref.watch(pelatihanMendatangProvider)
        : null;
    final tautanWa = bolehWa ? ref.watch(tautanWhatsAppProvider).value : null;

    Future<void> segarkan() async {
      for (final prov in [
        if (bolehPresensi) ...[
          presensiHariIniProvider,
          shiftHariIniProvider,
          jadwalProvider,
          riwayatPresensiProvider,
        ],
        if (bolehCuti) ...[saldoCutiProvider, riwayatCutiProvider],
        if (bolehGaji) slipSayaProvider,
        if (bolehPengumuman) ...[pengumumanProvider, surveiProvider],
        if (bolehPelatihan) pelatihanMendatangProvider,
        if (bolehWa) tautanWhatsAppProvider,
      ]) {
        ref.invalidate(prov);
      }
      await Future.wait([
        if (bolehPresensi) ref.read(presensiHariIniProvider.future),
        if (bolehPengumuman) ref.read(pengumumanProvider.future),
      ]);
    }

    final tindakan = _susunTindakan(
      context,
      pengumuman: pengumuman?.value,
      survei: survei?.value,
      cuti: cuti?.value,
      waPerluTindakan:
          tautanWa != null && tautanWa.perluTindakan && tautanWa.driverAktif,
      waBelumPernah: tautanWa?.belumPernah ?? false,
      waTanpaGrup: tautanWa != null && tautanWa.tersambung && !tautanWa.adaGrup,
    );

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: segarkan,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 32),
          children: [
            _Kepala(
              pengguna: p,
              kartu: bolehPresensi
                  ? _KartuPresensiHariIni(presensi: presensi!, shift: shift!)
                  : null,
            ),
            if (tindakan.isNotEmpty) ...[
              const _Judul('Perlu tindakan'),
              _DaftarTindakan(tindakan),
            ],
            if (bolehPresensi) ...[
              const _Judul('Kehadiran 30 hari terakhir'),
              _RingkasanKehadiran(riwayat: riwayat!, jadwal: jadwal!),
              _Judul(
                'Jadwal 7 hari ke depan',
                aksi: TextButton(
                  onPressed: () => context.push('/jadwal'),
                  child: const Text('Selengkapnya'),
                ),
              ),
              _JadwalMingguIni(jadwal: jadwal),
            ],
            if (bolehCuti || bolehGaji) ...[
              const _Judul('Cuti & gaji'),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (bolehCuti)
                      Expanded(
                        child: _KartuCuti(saldo: saldo!, riwayat: cuti!),
                      ),
                    if (bolehCuti && bolehGaji) const SizedBox(width: 10),
                    if (bolehGaji) Expanded(child: _KartuGaji(slip: slip!)),
                  ],
                ),
              ),
            ],
            if (bolehPelatihan)
              pelatihan!.maybeWhen(
                data: (d) => d.isEmpty
                    ? const SizedBox.shrink()
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const _Judul('Pelatihan mendatang'),
                          _KartuPelatihan(d.first),
                        ],
                      ),
                orElse: () => const SizedBox.shrink(),
              ),
            const _Judul('Akses cepat'),
            _AksesCepat(
              bolehPresensi: bolehPresensi,
              bolehCuti: bolehCuti,
              bolehGaji: bolehGaji,
              bolehPengumuman: bolehPengumuman,
              bolehChat: bolehChat,
              bolehWa: bolehWa,
            ),
            if (bolehPengumuman) ...[
              _Judul(
                'Pengumuman terbaru',
                aksi: TextButton(
                  onPressed: () => context.push('/pengumuman'),
                  child: const Text('Semua'),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: pengumuman!.when(
                  loading: () => const Pemuat(),
                  error: (e, _) => PanelGalat(
                    galat: e,
                    cobaLagi: () => ref.invalidate(pengumumanProvider),
                  ),
                  data: (d) => d.isEmpty
                      ? const KeadaanKosong(
                          ikon: Icons.campaign_outlined,
                          judul: 'Belum ada pengumuman',
                        )
                      : Column(
                          children: [
                            for (final x in d.take(3))
                              Padding(
                                padding: const EdgeInsets.only(bottom: 8),
                                child: KartuPengumuman(x),
                              ),
                          ],
                        ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  List<_Tindakan> _susunTindakan(
    BuildContext context, {
    List<Pengumuman>? pengumuman,
    List<Survei>? survei,
    List<Cuti>? cuti,
    required bool waPerluTindakan,
    required bool waBelumPernah,
    required bool waTanpaGrup,
  }) {
    final daftar = <_Tindakan>[];
    if (waPerluTindakan) {
      daftar.add(
        _Tindakan(
          ikon: Icons.link_off,
          nada: waBelumPernah ? Nada.peringatan : Nada.bahaya,
          judul: waBelumPernah
              ? 'WhatsApp belum ditautkan'
              : 'Tautan WhatsApp terputus',
          keterangan: waBelumPernah
              ? 'Wajib. Tautkan lewat aplikasi web HRD.'
              : 'Pesan tidak tersinkron. Pindai ulang QR di aplikasi web.',
          onTap: () => context.push('/whatsapp'),
        ),
      );
    } else if (waTanpaGrup) {
      daftar.add(
        _Tindakan(
          ikon: Icons.groups_outlined,
          nada: Nada.info,
          judul: 'Pilih grup WhatsApp untuk foto absensi',
          keterangan:
              'Dipilih sekali di aplikasi web; setiap absensi mengirim foto ber-stempel ke grup itu.',
          onTap: () => context.push('/whatsapp'),
        ),
      );
    }
    final konfirmasi = (pengumuman ?? const [])
        .where((x) => x.perluKonfirmasi && x.dikonfirmasiPada == null)
        .length;
    if (konfirmasi > 0) {
      daftar.add(
        _Tindakan(
          ikon: Icons.campaign_outlined,
          nada: Nada.peringatan,
          judul: '$konfirmasi pengumuman perlu konfirmasi',
          keterangan: 'Baca lalu tekan "Saya sudah membaca".',
          onTap: () => context.push('/pengumuman'),
        ),
      );
    }
    final surveiTerbuka = (survei ?? const [])
        .where((s) => s.bisaDiisi)
        .toList();
    if (surveiTerbuka.isNotEmpty) {
      daftar.add(
        _Tindakan(
          ikon: Icons.poll_outlined,
          nada: Nada.info,
          judul: surveiTerbuka.length == 1
              ? 'Survei "${surveiTerbuka.first.judul}" menunggu jawaban Anda'
              : '${surveiTerbuka.length} survei belum diisi',
          keterangan:
              'Ditutup ${formatTanggalSaja(surveiTerbuka.first.selesai)}',
          onTap: () => context.push('/survei'),
        ),
      );
    }
    final menunggu = (cuti ?? const [])
        .where((c) => c.status == 'pending')
        .toList();
    if (menunggu.isNotEmpty) {
      final c = menunggu.first;
      daftar.add(
        _Tindakan(
          ikon: Icons.hourglass_top_rounded,
          nada: Nada.netral,
          judul: menunggu.length == 1
              ? 'Pengajuan ${c.jenisNama.toLowerCase()} menunggu persetujuan'
              : '${menunggu.length} pengajuan cuti menunggu persetujuan',
          keterangan:
              '${formatTanggalSaja(c.mulai, pola: 'd MMM')} – ${formatTanggalSaja(c.selesai, pola: 'd MMM')} · ${c.totalHari} hari',
          onTap: () => context.go('/cuti'),
        ),
      );
    }
    return daftar;
  }
}

// ---------------------------------------------------------------------------
// Kepala hijau: identitas + kartu presensi hari ini yang menumpang di atasnya.
// ---------------------------------------------------------------------------

class _Kepala extends StatelessWidget {
  const _Kepala({required this.pengguna, required this.kartu});
  final Pengguna? pengguna;
  final Widget? kartu;

  String _sapaan() {
    final jam = DateTime.now().hour;
    if (jam < 11) return 'Selamat pagi';
    if (jam < 15) return 'Selamat siang';
    if (jam < 18) return 'Selamat sore';
    return 'Selamat malam';
  }

  String _inisial(String nama) {
    final bagian = nama
        .trim()
        .split(RegExp(r'\s+'))
        .where((s) => s.isNotEmpty)
        .toList();
    if (bagian.isEmpty) return '?';
    return bagian.length == 1
        ? bagian.first[0].toUpperCase()
        : (bagian.first[0] + bagian.last[0]).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final atas = MediaQuery.paddingOf(context).top;
    final p = pengguna;
    final peran = p?.namaPeran ?? (p == null ? '' : labelPeran(p.peran));
    final unit = [p?.jabatan, p?.departemen].whereType<String>().join(' · ');

    return Stack(
      children: [
        Container(
          height: atas + (kartu == null ? 150 : 210),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                skema.primary,
                Color.lerp(skema.primary, Colors.black, 0.18)!,
              ],
            ),
            borderRadius: const BorderRadius.vertical(
              bottom: Radius.circular(28),
            ),
          ),
        ),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(height: atas + 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 26,
                    backgroundColor: skema.secondary,
                    child: Text(
                      _inisial(p?.nama ?? ''),
                      style: TextStyle(
                        color: skema.onSecondary,
                        fontWeight: FontWeight.w800,
                        fontSize: 18,
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${_sapaan()},',
                          style: TextStyle(
                            color: skema.onPrimary.withValues(alpha: 0.85),
                            fontSize: 13,
                          ),
                        ),
                        Text(
                          p?.nama ?? '',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: skema.onPrimary,
                            fontSize: 21,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        Text(
                          unit.isEmpty ? peran : unit,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: skema.onPrimary.withValues(alpha: 0.85),
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    onPressed: () => context.go('/profil'),
                    icon: const Icon(Icons.account_circle_outlined),
                    color: skema.onPrimary,
                    tooltip: 'Profil',
                    style: IconButton.styleFrom(
                      backgroundColor: Colors.white.withValues(alpha: 0.14),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  Icon(
                    Icons.calendar_today_outlined,
                    size: 14,
                    color: skema.onPrimary.withValues(alpha: 0.85),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      formatTanggal(DateTime.now(), pola: 'EEEE, d MMMM yyyy'),
                      style: TextStyle(
                        color: skema.onPrimary,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  if (p != null && p.nik.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.16),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        'NIK ${p.nik}',
                        style: TextStyle(
                          color: skema.onPrimary,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            if (kartu != null)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: kartu,
              ),
          ],
        ),
      ],
    );
  }
}

class _KartuPresensiHariIni extends ConsumerWidget {
  const _KartuPresensiHariIni({required this.presensi, required this.shift});
  final AsyncValue<Presensi?> presensi;
  final AsyncValue<Shift?> shift;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final skema = Theme.of(context).colorScheme;
    final s = shift.value;
    final hariIni = presensi.value;
    final adaShift = s != null;

    final (String labelStatus, Nada nadaStatusHariIni) = presensi.isLoading
        ? ('Memuat…', Nada.netral)
        : hariIni == null
        ? (adaShift
              ? ('Belum check-in', Nada.peringatan)
              : (shift.isLoading
                    ? ('Memuat…', Nada.netral)
                    : ('Hari libur', Nada.netral)))
        : hariIni.masihTerbuka
        ? ('Sedang bekerja', Nada.info)
        : ('Lengkap', Nada.sukses);
    final warnaStatus = warnaNada(nadaStatusHariIni, skema);

    return Card(
      elevation: 3,
      shadowColor: Colors.black.withValues(alpha: 0.18),
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: skema.primaryContainer,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(Icons.schedule_rounded, color: skema.primary),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'SHIFT HARI INI',
                        style: TextStyle(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.8,
                          color: skema.onSurfaceVariant,
                        ),
                      ),
                      Text(
                        adaShift
                            ? '${s.mulai} – ${s.selesai}${s.lintasHari ? ' (+1)' : ''}'
                            : (shift.isLoading ? '…' : 'Tidak ada shift'),
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      Text(
                        adaShift
                            ? (hariIni?.namaLokasi ??
                                  (s.catatan ??
                                      'Istirahat ${s.istirahatJam ?? 1} jam'))
                            : 'Nikmati hari libur Anda',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12,
                          color: skema.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: warnaStatus.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    labelStatus,
                    style: TextStyle(
                      color: warnaStatus,
                      fontSize: 11.5,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            presensi.when(
              loading: () => const SizedBox(
                height: 44,
                child: Center(
                  child: SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
              ),
              error: (e, _) => Text(
                'Status presensi tidak bisa dimuat. Tarik untuk menyegarkan.',
                style: TextStyle(color: skema.error, fontSize: 12),
              ),
              data: (h) => Column(
                children: [
                  Row(
                    children: [
                      _Waktu(
                        label: 'Masuk',
                        nilai: h?.jamMasuk == null
                            ? '—'
                            : formatWaktu(h!.jamMasuk),
                        catatan: (h?.menitTerlambat ?? 0) > 0
                            ? 'terlambat ${h!.menitTerlambat} mnt'
                            : null,
                        nadaCatatan: Nada.peringatan,
                      ),
                      _Waktu(
                        label: 'Pulang',
                        nilai: h?.jamPulang == null
                            ? '—'
                            : formatWaktu(h!.jamPulang),
                      ),
                      _Waktu(
                        label: 'Jam kerja',
                        nilai: h == null
                            ? '—'
                            : formatDurasiMenit(
                                h.menitKerja ?? _menitBerjalan(h),
                              ),
                        catatan: (h?.jamLembur ?? 0) > 0
                            ? 'lembur ${h!.jamLembur} jam'
                            : null,
                        nadaCatatan: Nada.info,
                      ),
                    ],
                  ),
                  const SizedBox(height: 14),
                  if (h == null || h.masihTerbuka)
                    SizedBox(
                      width: double.infinity,
                      child: FilledButton.icon(
                        style: h == null
                            ? null
                            : FilledButton.styleFrom(
                                backgroundColor: skema.secondary,
                                foregroundColor: skema.onSecondary,
                              ),
                        onPressed: () async {
                          final hasil = await LayarAbsen.buka(
                            context,
                            pulang: h != null,
                          );
                          if (hasil != null && context.mounted) {
                            tampilkanPesan(
                              context,
                              h == null
                                  ? 'Check-in tercatat ${formatWaktu(hasil.jamMasuk)}'
                                  : 'Check-out tercatat ${formatWaktu(hasil.jamPulang)}',
                              rincian: h == null
                                  ? ((hasil.menitTerlambat ?? 0) > 0
                                        ? 'Terlambat ${hasil.menitTerlambat} menit'
                                        : (hasil.namaLokasi ?? ''))
                                  : 'Jam kerja ${formatDurasiMenit(hasil.menitKerja)}',
                              nada: (hasil.menitTerlambat ?? 0) > 0 && h == null
                                  ? Nada.peringatan
                                  : Nada.sukses,
                            );
                          }
                        },
                        icon: Icon(
                          h == null
                              ? Icons.login_rounded
                              : Icons.logout_rounded,
                        ),
                        label: Text(
                          h == null ? 'Check-in sekarang' : 'Check-out',
                        ),
                      ),
                    )
                  else
                    Row(
                      children: [
                        Icon(
                          Icons.check_circle_rounded,
                          size: 18,
                          color: warnaNada(Nada.sukses, skema),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            'Presensi hari ini lengkap. Terima kasih sudah bekerja!',
                            style: TextStyle(
                              fontSize: 12.5,
                              color: skema.onSurfaceVariant,
                            ),
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Menit kerja berjalan untuk presensi yang belum check-out.
  int? _menitBerjalan(Presensi h) {
    if (h.jamMasuk == null) return null;
    if (h.jamPulang != null) return h.menitKerja;
    return DateTime.now().difference(h.jamMasuk!).inMinutes;
  }
}

class _Waktu extends StatelessWidget {
  const _Waktu({
    required this.label,
    required this.nilai,
    this.catatan,
    this.nadaCatatan = Nada.netral,
  });
  final String label;
  final String nilai;
  final String? catatan;
  final Nada nadaCatatan;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return Expanded(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: TextStyle(fontSize: 11, color: skema.onSurfaceVariant),
          ),
          Text(
            nilai,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
          ),
          if (catatan != null)
            Text(
              catatan!,
              style: TextStyle(
                fontSize: 10.5,
                color: warnaNada(nadaCatatan, skema),
                fontWeight: FontWeight.w600,
              ),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Perlu tindakan
// ---------------------------------------------------------------------------

class _Tindakan {
  const _Tindakan({
    required this.ikon,
    required this.nada,
    required this.judul,
    required this.keterangan,
    required this.onTap,
  });
  final IconData ikon;
  final Nada nada;
  final String judul;
  final String keterangan;
  final VoidCallback onTap;
}

class _DaftarTindakan extends StatelessWidget {
  const _DaftarTindakan(this.daftar);
  final List<_Tindakan> daftar;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Card(
        margin: EdgeInsets.zero,
        child: Column(
          children: [
            for (var i = 0; i < daftar.length; i++) ...[
              if (i > 0) const Divider(height: 1, indent: 60),
              ListTile(
                onTap: daftar[i].onTap,
                leading: Container(
                  padding: const EdgeInsets.all(9),
                  decoration: BoxDecoration(
                    color: warnaNada(
                      daftar[i].nada,
                      skema,
                    ).withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Icon(
                    daftar[i].ikon,
                    color: warnaNada(daftar[i].nada, skema),
                    size: 20,
                  ),
                ),
                title: Text(
                  daftar[i].judul,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 14,
                  ),
                ),
                subtitle: Text(
                  daftar[i].keterangan,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12),
                ),
                trailing: const Icon(Icons.chevron_right),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Kehadiran 30 hari & strip 7 hari
// ---------------------------------------------------------------------------

DateTime _tanggalShift(Shift s) {
  final t = DateTime.tryParse(s.tanggal);
  if (t == null) return DateTime(1970);
  final u = s.tanggal.contains('T') ? t.toUtc() : t;
  return DateTime(u.year, u.month, u.day);
}

bool _hariSama(DateTime? a, DateTime b) =>
    a != null && a.year == b.year && a.month == b.month && a.day == b.day;

class _RingkasanKehadiran extends StatelessWidget {
  const _RingkasanKehadiran({required this.riwayat, required this.jadwal});
  final AsyncValue<List<Presensi>> riwayat;
  final AsyncValue<List<Shift>> jadwal;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final daftar = riwayat.value ?? const <Presensi>[];
    final shifts = jadwal.value ?? const <Shift>[];
    final hadir = daftar
        .where(
          (x) =>
              x.status == 'present' ||
              x.status == 'late' ||
              x.status == 'no_checkout',
        )
        .length;
    final terlambat = daftar
        .where((x) => (x.menitTerlambat ?? 0) > 0 || x.status == 'late')
        .length;
    final lembur = daftar.fold<num>(0, (a, x) => a + (x.jamLembur ?? 0));
    final menit = daftar.fold<int>(0, (a, x) => a + (x.menitKerja ?? 0));

    final sekarang = DateTime.now();
    final hariIni = DateTime(sekarang.year, sekarang.month, sekarang.day);
    final hari = <_TitikHari>[];
    for (var i = 6; i >= 0; i--) {
      final d = hariIni.subtract(Duration(days: i));
      final pres = daftar.where((x) => _hariSama(x.tanggal, d)).firstOrNull;
      final adaShift = shifts.any((s) => _hariSama(_tanggalShift(s), d));
      final Nada nada;
      final String ket;
      if (pres != null) {
        final telat = (pres.menitTerlambat ?? 0) > 0 || pres.status == 'late';
        nada = telat ? Nada.peringatan : Nada.sukses;
        ket = telat ? 'Terlambat' : 'Hadir';
      } else if (!adaShift) {
        nada = Nada.netral;
        ket = 'Libur';
      } else if (i == 0) {
        nada = Nada.info;
        ket = 'Belum';
      } else {
        nada = Nada.bahaya;
        ket = 'Absen';
      }
      hari.add(
        _TitikHari(
          label: formatTanggal(d, pola: 'EEE').substring(0, 3),
          tanggal: d.day,
          nada: nada,
          keterangan: ket,
          hariIni: i == 0,
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Card(
        margin: EdgeInsets.zero,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
          child: Column(
            children: [
              if (riwayat.isLoading)
                const SizedBox(
                  height: 48,
                  child: Center(
                    child: SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  ),
                )
              else
                Row(
                  children: [
                    _Angka(
                      label: 'Hadir',
                      nilai: '$hadir',
                      satuan: 'hari',
                      nada: Nada.sukses,
                    ),
                    _pemisah(skema),
                    _Angka(
                      label: 'Terlambat',
                      nilai: '$terlambat',
                      satuan: 'kali',
                      nada: terlambat > 0 ? Nada.peringatan : Nada.netral,
                    ),
                    _pemisah(skema),
                    _Angka(
                      label: 'Lembur',
                      nilai: formatAngka(
                        lembur == lembur.roundToDouble()
                            ? lembur.toInt()
                            : double.parse(lembur.toStringAsFixed(1)),
                      ),
                      satuan: 'jam',
                      nada: Nada.info,
                    ),
                    _pemisah(skema),
                    _Angka(
                      label: 'Jam kerja',
                      nilai: '${menit ~/ 60}',
                      satuan: 'jam',
                      nada: Nada.utama,
                    ),
                  ],
                ),
              const SizedBox(height: 14),
              Row(children: [for (final h in hari) Expanded(child: h)]),
            ],
          ),
        ),
      ),
    );
  }

  Widget _pemisah(ColorScheme skema) => Container(
    width: 1,
    height: 34,
    color: skema.outlineVariant.withValues(alpha: 0.6),
  );
}

class _Angka extends StatelessWidget {
  const _Angka({
    required this.label,
    required this.nilai,
    required this.satuan,
    required this.nada,
  });
  final String label;
  final String nilai;
  final String satuan;
  final Nada nada;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return Expanded(
      child: Column(
        children: [
          Text.rich(
            TextSpan(
              children: [
                TextSpan(
                  text: nilai,
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: warnaNada(nada, skema),
                  ),
                ),
                TextSpan(
                  text: ' $satuan',
                  style: TextStyle(
                    fontSize: 10.5,
                    color: skema.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            textAlign: TextAlign.center,
          ),
          Text(
            label,
            style: TextStyle(fontSize: 11, color: skema.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _TitikHari extends StatelessWidget {
  const _TitikHari({
    required this.label,
    required this.tanggal,
    required this.nada,
    required this.keterangan,
    required this.hariIni,
  });
  final String label;
  final int tanggal;
  final Nada nada;
  final String keterangan;
  final bool hariIni;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final warna = warnaNada(nada, skema);
    final pudar = nada == Nada.netral;
    return Tooltip(
      message: '$keterangan · $label $tanggal',
      child: Column(
        children: [
          Text(
            label,
            style: TextStyle(
              fontSize: 10.5,
              fontWeight: hariIni ? FontWeight.w800 : FontWeight.w500,
              color: hariIni ? skema.primary : skema.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 4),
          Container(
            width: 30,
            height: 30,
            decoration: BoxDecoration(
              color: pudar
                  ? skema.surfaceContainerHighest
                  : warna.withValues(alpha: 0.15),
              shape: BoxShape.circle,
              border: hariIni
                  ? Border.all(color: skema.primary, width: 1.5)
                  : null,
            ),
            child: Center(
              child: pudar
                  ? Text(
                      '$tanggal',
                      style: TextStyle(
                        fontSize: 11,
                        color: skema.onSurfaceVariant,
                      ),
                    )
                  : Icon(
                      nada == Nada.sukses
                          ? Icons.check_rounded
                          : nada == Nada.peringatan
                          ? Icons.schedule_rounded
                          : nada == Nada.bahaya
                          ? Icons.close_rounded
                          : Icons.more_horiz_rounded,
                      size: 16,
                      color: warna,
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Jadwal 7 hari ke depan
// ---------------------------------------------------------------------------

class _JadwalMingguIni extends StatelessWidget {
  const _JadwalMingguIni({required this.jadwal});
  final AsyncValue<List<Shift>> jadwal;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final shifts = jadwal.value ?? const <Shift>[];
    final sekarang = DateTime.now();
    final hariIni = DateTime(sekarang.year, sekarang.month, sekarang.day);
    return SizedBox(
      height: 100,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: 7,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final d = hariIni.add(Duration(days: i));
          final s = shifts
              .where(
                (x) =>
                    _hariSama(_tanggalShift(x), d) && x.status != 'cancelled',
              )
              .firstOrNull;
          final aktif = i == 0;
          final libur = s == null;
          return InkWell(
            onTap: () => context.push('/jadwal'),
            borderRadius: BorderRadius.circular(14),
            child: Container(
              width: 86,
              padding: const EdgeInsets.symmetric(vertical: 9, horizontal: 6),
              decoration: BoxDecoration(
                color: aktif ? skema.primary : skema.surface,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: aktif
                      ? skema.primary
                      : skema.outlineVariant.withValues(alpha: 0.7),
                ),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    formatTanggal(d, pola: 'EEE'),
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: aktif
                          ? skema.onPrimary.withValues(alpha: 0.85)
                          : skema.onSurfaceVariant,
                    ),
                  ),
                  Text(
                    '${d.day}',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                      color: aktif ? skema.onPrimary : skema.onSurface,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    jadwal.isLoading
                        ? '…'
                        : libur
                        ? 'Libur'
                        : '${s.mulai}–${s.selesai}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 10.5,
                      fontWeight: FontWeight.w600,
                      color: aktif
                          ? skema.onPrimary
                          : libur
                          ? skema.onSurfaceVariant
                          : skema.primary,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Cuti & gaji
// ---------------------------------------------------------------------------

class _KartuCuti extends StatelessWidget {
  const _KartuCuti({required this.saldo, required this.riwayat});
  final AsyncValue<List<SaldoCuti>> saldo;
  final AsyncValue<List<Cuti>> riwayat;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final d = saldo.value ?? const <SaldoCuti>[];
    final tahunan =
        d
            .where((s) => s.jenisNama.toLowerCase().contains('tahun'))
            .firstOrNull ??
        d.firstOrNull;
    final menunggu = (riwayat.value ?? const <Cuti>[])
        .where((c) => c.status == 'pending')
        .length;
    final rasio = tahunan == null || tahunan.jatah == 0
        ? 0.0
        : (tahunan.sisa / tahunan.jatah).clamp(0, 1).toDouble();
    return _KartuRingkas(
      ikon: Icons.beach_access_outlined,
      nada: Nada.utama,
      label: tahunan == null
          ? 'Sisa cuti'
          : 'Sisa ${tahunan.jenisNama.toLowerCase()}',
      nilai: saldo.isLoading
          ? '…'
          : tahunan == null
          ? '—'
          : '${tahunan.sisa} hari',
      keterangan: tahunan == null
          ? 'belum ditetapkan HR'
          : 'dari ${tahunan.jatah} hari · ${menunggu > 0 ? '$menunggu menunggu' : 'ajukan cuti'}',
      onTap: () => context.go('/cuti'),
      bawah: ClipRRect(
        borderRadius: BorderRadius.circular(999),
        child: LinearProgressIndicator(
          value: rasio,
          minHeight: 6,
          backgroundColor: skema.surfaceContainerHighest,
        ),
      ),
    );
  }
}

class _KartuGaji extends StatelessWidget {
  const _KartuGaji({required this.slip});
  final AsyncValue<List<SlipGaji>> slip;

  @override
  Widget build(BuildContext context) {
    final terakhir = (slip.value ?? const <SlipGaji>[]).firstOrNull;
    return _KartuRingkas(
      ikon: Icons.receipt_long_outlined,
      nada: Nada.peringatan,
      label: 'Slip gaji terakhir',
      nilai: slip.isLoading
          ? '…'
          : terakhir == null
          ? '—'
          : formatRupiah(terakhir.bersih),
      keterangan: terakhir == null
          ? 'belum ada slip'
          : '${formatTanggalSaja(terakhir.periodeMulai, pola: 'MMM yyyy')} · ${labelUntuk(terakhir.status)}',
      onTap: () => context.go('/gaji'),
      bawah: terakhir == null ? null : LencanaStatus(terakhir.status),
    );
  }
}

class _KartuRingkas extends StatelessWidget {
  const _KartuRingkas({
    required this.ikon,
    required this.nada,
    required this.label,
    required this.nilai,
    required this.keterangan,
    required this.onTap,
    this.bawah,
  });
  final IconData ikon;
  final Nada nada;
  final String label;
  final String nilai;
  final String keterangan;
  final VoidCallback onTap;
  final Widget? bawah;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final warna = warnaNada(nada, skema);
    return Card(
      margin: EdgeInsets.zero,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(7),
                    decoration: BoxDecoration(
                      color: warna.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(ikon, color: warna, size: 18),
                  ),
                  const Spacer(),
                  Icon(
                    Icons.chevron_right,
                    size: 18,
                    color: skema.onSurfaceVariant,
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                label,
                style: TextStyle(fontSize: 11.5, color: skema.onSurfaceVariant),
              ),
              Text(
                nilai,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 19,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                keterangan,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, color: skema.onSurfaceVariant),
              ),
              if (bawah != null)
                Padding(padding: const EdgeInsets.only(top: 8), child: bawah),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Pelatihan mendatang
// ---------------------------------------------------------------------------

class _KartuPelatihan extends StatelessWidget {
  const _KartuPelatihan(this.p);
  final PendaftaranPelatihan p;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final rincian = [
      if (p.mulai != null)
        '${formatTanggal(p.mulai, pola: 'EEEE, d MMM')} · ${formatWaktu(p.mulai)}${p.selesai != null ? '–${formatWaktu(p.selesai)}' : ''}',
      [p.pelatih, p.lokasi].whereType<String>().join(' · '),
    ].where((s) => s.isNotEmpty).join('\n');
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Card(
        margin: EdgeInsets.zero,
        child: ListTile(
          leading: Container(
            width: 46,
            padding: const EdgeInsets.symmetric(vertical: 6),
            decoration: BoxDecoration(
              color: skema.secondaryContainer,
              borderRadius: BorderRadius.circular(12),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  p.mulai == null ? '—' : '${p.mulai!.day}',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                    color: skema.onSecondaryContainer,
                    height: 1,
                  ),
                ),
                Text(
                  p.mulai == null ? '' : formatTanggal(p.mulai, pola: 'MMM'),
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w600,
                    color: skema.onSecondaryContainer,
                  ),
                ),
              ],
            ),
          ),
          title: Text(
            p.judul,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 14),
          ),
          subtitle: Text(rincian, style: const TextStyle(fontSize: 12)),
          trailing: LencanaStatus(p.status),
          isThreeLine: rincian.contains('\n'),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Akses cepat
// ---------------------------------------------------------------------------

class _AksesCepat extends StatelessWidget {
  const _AksesCepat({
    required this.bolehPresensi,
    required this.bolehCuti,
    required this.bolehGaji,
    required this.bolehPengumuman,
    required this.bolehChat,
    required this.bolehWa,
  });
  final bool bolehPresensi;
  final bool bolehCuti;
  final bool bolehGaji;
  final bool bolehPengumuman;
  final bool bolehChat;
  final bool bolehWa;

  @override
  Widget build(BuildContext context) {
    final item = <_Pintasan>[
      if (bolehPresensi)
        _Pintasan(
          ikon: Icons.calendar_month_outlined,
          label: 'Jadwal',
          nada: Nada.utama,
          onTap: () => context.push('/jadwal'),
        ),
      if (bolehPresensi)
        _Pintasan(
          ikon: Icons.history_rounded,
          label: 'Riwayat',
          nada: Nada.info,
          onTap: () => context.go('/presensi'),
        ),
      if (bolehCuti)
        _Pintasan(
          ikon: Icons.beach_access_outlined,
          label: 'Cuti',
          nada: Nada.sukses,
          onTap: () => context.go('/cuti'),
        ),
      if (bolehGaji)
        _Pintasan(
          ikon: Icons.receipt_long_outlined,
          label: 'Slip Gaji',
          nada: Nada.peringatan,
          onTap: () => context.go('/gaji'),
        ),
      if (bolehPengumuman)
        _Pintasan(
          ikon: Icons.campaign_outlined,
          label: 'Pengumuman',
          nada: Nada.info,
          onTap: () => context.push('/pengumuman'),
        ),
      if (bolehPengumuman)
        _Pintasan(
          ikon: Icons.poll_outlined,
          label: 'Survei',
          nada: Nada.utama,
          onTap: () => context.push('/survei'),
        ),
      if (bolehChat)
        _Pintasan(
          ikon: Icons.forum_outlined,
          label: 'Chat Tim',
          nada: Nada.sukses,
          onTap: () => context.push('/chat'),
        ),
      if (bolehWa)
        _Pintasan(
          ikon: Icons.phone_android_outlined,
          label: 'WhatsApp',
          nada: Nada.sukses,
          onTap: () => context.push('/whatsapp'),
        ),
    ];
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: GridView.count(
        crossAxisCount: 4,
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        mainAxisSpacing: 10,
        crossAxisSpacing: 8,
        childAspectRatio: 0.95,
        children: item,
      ),
    );
  }
}

class _Pintasan extends StatelessWidget {
  const _Pintasan({
    required this.ikon,
    required this.label,
    required this.nada,
    required this.onTap,
  });
  final IconData ikon;
  final String label;
  final Nada nada;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    final warna = nada == Nada.netral
        ? skema.onSurfaceVariant
        : warnaNada(nada, skema);
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 54,
            height: 54,
            decoration: BoxDecoration(
              color: warna.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(16),
            ),
            child: Icon(ikon, color: warna, size: 26),
          ),
          const SizedBox(height: 6),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Judul bagian dengan jarak kiri-kanan yang sama dengan kartu.
// ---------------------------------------------------------------------------

class _Judul extends StatelessWidget {
  const _Judul(this.teks, {this.aksi});
  final String teks;
  final Widget? aksi;
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 12),
    child: JudulBagian(teks, aksi: aksi),
  );
}
