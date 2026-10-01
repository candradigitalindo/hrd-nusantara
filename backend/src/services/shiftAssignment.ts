// src/services/shiftAssignment.ts
//
// Penugasan shift berjangka ("Pagi, Senin–Sabtu, mulai 1 Okt, seterusnya")
// dimaterialisasi menjadi baris ShiftSchedule sungguhan, bukan dihitung saat
// dibaca. Alasannya: presensi, payroll, cuti, laporan, dan aplikasi mobile
// semuanya sudah membaca ShiftSchedule, dan Attendance.shiftScheduleId harus
// tetap menunjuk baris nyata. Penugasan "seterusnya" tidak bisa dibuat
// barisnya tanpa batas, jadi dibuat sampai cakrawala (HORIZON_HARI) lalu
// diperpanjang berkala — dan diperpanjang lebih jauh sesuai kebutuhan oleh
// pembaca yang melihat ke depan (pastikanJadwalTerbit).
import { DateTime } from 'luxon';
import { Prisma } from '@prisma/client';
import { prisma, type PrismaTransactionClient } from '../lib/prisma';
import { env } from '../config/env';
import { generateULID } from '../utils/generateULID';
import { resolveShiftWindow, type ShiftWindow } from '../utils/shiftTime';
import { calendarKey } from '../utils/leaveDays';
import { ACTIVE_STATUSES } from '../middleware/auth';

/**
 * Berapa hari ke depan baris penugasan dibuat. Dua bulan cukup untuk roster
 * dan pengajuan cuti yang lazim, tanpa menimbun ribuan baris per orang.
 */
export const HORIZON_HARI = 62;

/**
 * Batas pembaca yang meminta jadwal lebih jauh (cuti panjang, laporan
 * setahun). Tanpa batas, satu permintaan dengan tanggal tahun 2100 akan
 * membuat puluhan ribu baris.
 */
export const BATAS_TERBIT_HARI = 400;

const SEHARI = 24 * 60 * 60 * 1000;

/** Client transaksi yang sudah berextension ULID (lihat lib/prisma.ts). */
export type Db = PrismaTransactionClient;

export type AlasanLewat = 'bentrok' | 'libur_nasional' | 'karyawan_keluar' | 'fleksibel';

export interface TanggalDilewati {
  date: string;
  alasan: AlasanLewat;
}

export interface HasilMaterialisasi {
  dibuat: number;
  dilewati: TanggalDilewati[];
}

/** Tanggal bisnis (zona operasional) dari sebuah waktu, sebagai tengah malam UTC. */
export const tanggalBisnis = (waktu: Date = new Date()): Date => {
  const iso = DateTime.fromJSDate(waktu).setZone(env.APP_TIMEZONE).toISODate();
  if (!iso) throw new Error('Waktu tidak valid');
  return new Date(`${iso}T00:00:00.000Z`);
};

/** Hari ini menurut jam operasional, bukan menurut UTC: pukul 05:00 WIB masih "kemarin" di UTC. */
export const hariIni = (): Date => tanggalBisnis(new Date());

/** Tanggal kalender tersimpan sebagai tengah malam UTC, jadi menggeser hari cukup dengan milidetik. */
export const geserHari = (tanggal: Date, hari: number): Date => new Date(tanggal.getTime() + hari * SEHARI);

const terbesar = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);
const terkecil = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);

const bertumpuk = (a: ShiftWindow, b: ShiftWindow) => a.start < b.end && b.start < a.end;

const pilihPenugasan = {
  id: true,
  employeeId: true,
  startDate: true,
  endDate: true,
  weekdays: true,
  skipPublicHolidays: true,
  status: true,
  notes: true,
  materializedUntil: true,
  template: { select: { id: true, startTime: true, endTime: true, breakDuration: true } },
  employee: { select: { status: true, exitDate: true, flexibleHours: true } },
} satisfies Prisma.ShiftAssignmentSelect;

type PenugasanLengkap = Prisma.ShiftAssignmentGetPayload<{ select: typeof pilihPenugasan }>;

/**
 * Membuat baris untuk rentang [dari, hingga] tanpa menyentuh materializedUntil.
 *
 * Shift lain karyawan itu dibaca SEKALI untuk seluruh rentang (±1 hari karena
 * shift malam melewati tengah malam), bukan per tanggal: penugasan seterusnya
 * menghasilkan puluhan tanggal sekaligus.
 */
const bangunBaris = async (
  db: Db,
  p: PenugasanLengkap,
  dari: Date,
  hingga: Date
): Promise<HasilMaterialisasi> => {
  const hariDipakai = new Set(p.weekdays);
  const tanggal: Date[] = [];
  for (let t = dari.getTime(); t <= hingga.getTime(); t += SEHARI) {
    const hari = new Date(t);
    if (hariDipakai.has(hari.getUTCDay())) tanggal.push(hari);
  }
  if (tanggal.length === 0) return { dibuat: 0, dilewati: [] };

  // Berurutan, bukan Promise.all: keduanya berjalan di satu koneksi transaksi.
  const libur = p.skipPublicHolidays
    ? await db.holiday.findMany({ where: { date: { gte: dari, lte: hingga } }, select: { date: true } })
    : [];
  const lain = await db.shiftSchedule.findMany({
    where: {
      employeeId: p.employeeId,
      date: { gte: geserHari(dari, -1), lte: geserHari(hingga, 1) },
    },
    select: { date: true, startTime: true, endTime: true, status: true, assignmentId: true },
  });

  const kunciLibur = new Set(libur.map((h) => calendarKey(h.date)));
  // Tanggal yang barisnya dari penugasan ini sudah ada (termasuk yang
  // dibatalkan) dilewati diam-diam: itu bukan bentrok, hanya sudah dibuat.
  const sudahAda = new Set(lain.filter((r) => r.assignmentId === p.id).map((r) => calendarKey(r.date)));
  const jendelaLain = lain
    .filter((r) => r.status !== 'cancelled')
    .map((r) => resolveShiftWindow(r.date, r.startTime, r.endTime, env.APP_TIMEZONE));

  const aktif = ACTIVE_STATUSES.has(p.employee.status);
  const kunciKeluar = p.employee.exitDate ? calendarKey(tanggalBisnis(p.employee.exitDate)) : null;

  const dilewati: TanggalDilewati[] = [];
  const rencana: Date[] = [];
  const jendelaRencana: ShiftWindow[] = [];

  for (const hari of tanggal) {
    const kunci = calendarKey(hari);
    if (sudahAda.has(kunci)) continue;

    if (p.employee.flexibleHours) {
      dilewati.push({ date: kunci, alasan: 'fleksibel' });
      continue;
    }
    // Karyawan yang sudah keluar tidak dijadwalkan sesudah tanggal keluarnya.
    // Yang aktif kembali (dipekerjakan ulang) tetap dijadwalkan walau
    // exitDate lamanya masih tersimpan.
    if (!aktif && (kunciKeluar === null || kunci > kunciKeluar)) {
      dilewati.push({ date: kunci, alasan: 'karyawan_keluar' });
      continue;
    }
    if (kunciLibur.has(kunci)) {
      dilewati.push({ date: kunci, alasan: 'libur_nasional' });
      continue;
    }

    const jendela = resolveShiftWindow(hari, p.template.startTime, p.template.endTime, env.APP_TIMEZONE);
    if (jendelaLain.some((j) => bertumpuk(j, jendela)) || jendelaRencana.some((j) => bertumpuk(j, jendela))) {
      dilewati.push({ date: kunci, alasan: 'bentrok' });
      continue;
    }

    rencana.push(hari);
    jendelaRencana.push(jendela);
  }

  if (rencana.length === 0) return { dibuat: 0, dilewati };

  // skipDuplicates bersandar pada unik (assignmentId, date): dua proses yang
  // memperpanjang penugasan yang sama bersamaan tidak menggandakan baris.
  const dibuat = await db.shiftSchedule.createMany({
    data: rencana.map((hari) => ({
      id: generateULID(),
      employeeId: p.employeeId,
      date: hari,
      startTime: p.template.startTime,
      endTime: p.template.endTime,
      breakDuration: p.template.breakDuration,
      status: p.status,
      notes: p.notes,
      templateId: p.template.id,
      assignmentId: p.id,
    })),
    skipDuplicates: true,
  });

  return { dibuat: dibuat.count, dilewati };
};

const kunciBaris = async (db: Db, assignmentId: string) => {
  // Dua materialisasi bersamaan untuk penugasan yang sama (perpanjangan
  // berkala dan pembaca roster, misalnya) diantrikan di sini, supaya
  // materializedUntil tidak saling menimpa mundur.
  await db.$queryRaw`SELECT 1 FROM "ShiftAssignment" WHERE "id" = ${assignmentId} FOR UPDATE`;
};

const dalamTransaksi = <T>(fn: (tx: Db) => Promise<T>, db?: Db): Promise<T> =>
  db ? fn(db) : prisma.$transaction(fn, { timeout: 60_000, maxWait: 10_000 });

/**
 * Membuat baris penugasan dari tanggal sesudah materializedUntil sampai
 * `sampai` (atau endDate bila lebih awal), lalu mencatat materializedUntil.
 *
 * Tanggal yang sudah pernah dimaterialisasi tidak disentuh lagi: baris yang
 * sengaja dihapus HR dari roster tidak boleh muncul kembali sendiri.
 */
export const materialisasi = (assignmentId: string, sampai: Date, db?: Db): Promise<HasilMaterialisasi> =>
  dalamTransaksi(async (tx) => {
    await kunciBaris(tx, assignmentId);
    const p = await tx.shiftAssignment.findUnique({ where: { id: assignmentId }, select: pilihPenugasan });
    if (!p) return { dibuat: 0, dilewati: [] };

    const dari = p.materializedUntil ? terbesar(p.startDate, geserHari(p.materializedUntil, 1)) : p.startDate;
    const hingga = p.endDate ? terkecil(p.endDate, sampai) : sampai;
    if (dari.getTime() > hingga.getTime()) return { dibuat: 0, dilewati: [] };

    const hasil = await bangunBaris(tx, p, dari, hingga);
    await tx.shiftAssignment.update({ where: { id: p.id }, data: { materializedUntil: hingga } });
    return hasil;
  }, db);

/**
 * Penugasan yang masih punya tanggal belum dibuat barisnya sebelum `sampai`.
 * endDate dibandingkan langsung dengan kolom materializedUntil (field
 * reference) supaya penugasan yang sudah tuntas tidak ikut dibaca.
 */
const belumTuntas = (sampai: Date): Prisma.ShiftAssignmentWhereInput => ({
  startDate: { lte: sampai },
  OR: [
    { materializedUntil: null },
    {
      materializedUntil: { lt: sampai },
      OR: [{ endDate: null }, { endDate: { gt: prisma.shiftAssignment.fields.materializedUntil } }],
    },
  ],
});

/**
 * Memperpanjang semua penugasan sampai hari ini + HORIZON_HARI. Idempoten:
 * menjalankannya dua kali tidak menggandakan apa pun.
 */
export const perpanjangSemua = async (): Promise<{ penugasan: number; dibuat: number }> => {
  const sampai = geserHari(hariIni(), HORIZON_HARI);
  const kandidat = await prisma.shiftAssignment.findMany({ where: belumTuntas(sampai), select: { id: true } });

  let dibuat = 0;
  for (const { id } of kandidat) {
    // Satu penugasan yang gagal (mis. kunci baris habis waktu) tidak boleh
    // menghentikan perpanjangan penugasan lain; ia dicoba lagi putaran
    // berikutnya karena materializedUntil-nya belum bergeser.
    try {
      dibuat += (await materialisasi(id, sampai)).dibuat;
    } catch (error) {
      console.warn('[shift] gagal memperpanjang penugasan', id, error);
    }
  }
  return { penugasan: kandidat.length, dibuat };
};

/**
 * Memastikan baris penugasan karyawan tertentu (null = semua) sudah dibuat
 * sampai tanggal `sampai`. Dipanggil oleh pembaca jadwal yang bisa melihat
 * melewati cakrawala: cuti tiga bulan lagi, payroll, laporan, roster.
 */
export const pastikanJadwalTerbit = async (employeeIds: string[] | null, sampai: Date): Promise<void> => {
  if (employeeIds && employeeIds.length === 0) return;
  const batas = terkecil(sampai, geserHari(hariIni(), BATAS_TERBIT_HARI));

  const kandidat = await prisma.shiftAssignment.findMany({
    where: { ...(employeeIds ? { employeeId: { in: employeeIds } } : {}), ...belumTuntas(batas) },
    select: { id: true },
  });
  for (const { id } of kandidat) {
    await materialisasi(id, batas);
  }
};

/** Baris yang masih boleh dihapus: belum pernah dipakai presensi. */
const tanpaPresensi = { attendances: { none: {} } } satisfies Prisma.ShiftScheduleWhereInput;

/**
 * Mengakhiri semua penugasan karyawan yang masih berjalan sesudah `akhir`,
 * lalu menghapus baris jadwalnya sesudah tanggal itu yang belum berpresensi.
 *
 * Penugasan yang belum mulai dihapus sekalian — mengakhirinya sebelum tanggal
 * mulai hanya meninggalkan penugasan kosong di daftar.
 *
 * @param hapusOverride juga menghapus baris yang sudah dikoreksi manual.
 *   Dipakai saat jam fleksibel dinyalakan (orangnya tidak memakai roster sama
 *   sekali lagi); saat karyawan keluar, koreksi manual dibiarkan.
 */
export const akhiriPenugasanKaryawan = async (
  db: Db,
  employeeId: string,
  akhir: Date,
  opsi: { hapusOverride: boolean }
): Promise<{ assignmentsEnded: number; rowsDeleted: number }> => {
  const berjalan = await db.shiftAssignment.findMany({
    where: { employeeId, OR: [{ endDate: null }, { endDate: { gt: akhir } }] },
    select: { id: true, startDate: true },
  });

  const hapus = await db.shiftSchedule.deleteMany({
    where: {
      employeeId,
      date: { gt: akhir },
      ...tanpaPresensi,
      ...(opsi.hapusOverride ? {} : { isOverride: false }),
    },
  });

  const belumMulai = berjalan.filter((p) => p.startDate.getTime() > akhir.getTime()).map((p) => p.id);
  const sudahMulai = berjalan.filter((p) => p.startDate.getTime() <= akhir.getTime()).map((p) => p.id);

  if (belumMulai.length > 0) {
    await db.shiftAssignment.deleteMany({ where: { id: { in: belumMulai } } });
  }
  if (sudahMulai.length > 0) {
    await db.shiftAssignment.updateMany({ where: { id: { in: sudahMulai } }, data: { endDate: akhir } });
  }

  return { assignmentsEnded: berjalan.length, rowsDeleted: hapus.count };
};

/**
 * Hari libur baru: baris dari penugasan yang melewati libur nasional dihapus
 * untuk tanggal itu, selama belum berpresensi dan belum dikoreksi manual.
 */
export const terapkanLiburBaru = async (tanggal: Date): Promise<number> => {
  const hapus = await prisma.shiftSchedule.deleteMany({
    where: {
      date: tanggal,
      isOverride: false,
      assignment: { skipPublicHolidays: true },
      ...tanpaPresensi,
    },
  });
  return hapus.count;
};

/**
 * Hari libur dihapus: tanggal itu dibuat kembali barisnya untuk penugasan
 * yang melewatinya — hanya yang sudah dimaterialisasi sampai tanggal itu;
 * sisanya akan terbentuk sendiri saat diperpanjang.
 */
export const pulihkanLiburDihapus = async (tanggal: Date): Promise<number> => {
  const penugasan = await prisma.shiftAssignment.findMany({
    where: {
      skipPublicHolidays: true,
      startDate: { lte: tanggal },
      materializedUntil: { gte: tanggal },
      OR: [{ endDate: null }, { endDate: { gte: tanggal } }],
    },
    select: { id: true },
  });

  let dibuat = 0;
  for (const { id } of penugasan) {
    dibuat += await prisma.$transaction(async (tx) => {
      await kunciBaris(tx, id);
      const p = await tx.shiftAssignment.findUnique({ where: { id }, select: pilihPenugasan });
      return p ? (await bangunBaris(tx, p, tanggal, tanggal)).dibuat : 0;
    });
  }
  return dibuat;
};

/** Perpanjangan berkala di proses server (lihat index.ts). */
let pemanjang: NodeJS.Timeout | null = null;
export const mulaiPerpanjanganPenugasan = () => {
  // Test memanggil perpanjangSemua sendiri; timer di latar hanya akan
  // menulis ke database test di tengah test lain.
  if (env.NODE_ENV === 'test') return;
  const jalan = () =>
    perpanjangSemua().catch((e) => console.warn('[shift] gagal memperpanjang penugasan shift:', e));
  void jalan();
  pemanjang = setInterval(jalan, 6 * 60 * 60 * 1000);
  pemanjang.unref();
};
export const hentikanPerpanjanganPenugasan = () => {
  if (pemanjang) clearInterval(pemanjang);
  pemanjang = null;
};
