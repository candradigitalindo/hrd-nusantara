// src/controllers/locationTrackingController.ts
//
// Pemantauan Lokasi: aplikasi mobile mengirim lokasi karyawan secara
// berkala sesuai pengaturan Super Admin, dan hanya Super Admin yang bisa
// melihat hasilnya. Karyawan diberi tahu (layar persetujuan + notifikasi
// tetap di ponsel); setiap pembukaan data lokasi tercatat di jejak audit.
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { encryptJson, decryptJson } from '../utils/fieldCrypto';
import { generateULID } from '../utils/generateULID';
import { businessDayRange } from '../utils/shiftTime';
import { ACTIVE_STATUSES } from '../middleware/auth';
import type { LocationPingsInput, TrackingSettingsInput, TrackingStatusInput, TrailQuery } from '../schemas/locationTrackingSchema';

type Koordinat = { lat: number; lng: number };

const BAWAAN = { id: 'utama', enabled: false, mode: 'always', intervalMinutes: 15, retentionDays: 30 } as const;

export const bacaPengaturan = async () => (await prisma.locationTrackingSetting.findUnique({ where: { id: 'utama' } })) ?? { ...BAWAAN, updatedById: null, updatedAt: null };

/** Menghapus titik lokasi yang melewati masa simpan. Dipanggil berkala dan setelah pengaturan diubah. */
export const hapusLokasiKedaluwarsa = async () => {
  const { retentionDays } = await bacaPengaturan();
  const { count } = await prisma.locationPing.deleteMany({
    where: { recordedAt: { lt: new Date(Date.now() - retentionDays * 86_400_000) } },
  });
  return count;
};

/** Untuk aplikasi mobile: perlu mengirim atau tidak, kapan, dan seberapa sering. */
export const getTrackingConfig = async (_req: Request, res: Response) => {
  const p = await bacaPengaturan();
  res.json({ enabled: p.enabled, mode: p.mode, intervalMinutes: p.intervalMinutes });
};

export const postLocationPings = async (req: Request, res: Response) => {
  const { pings } = req.body as LocationPingsInput;
  const p = await bacaPengaturan();
  // Pemantauan dimatikan: jangan simpan, dan beri tahu ponsel untuk berhenti.
  if (!p.enabled) return res.json({ diterima: 0, dilewati: pings.length, enabled: false });

  const sekarang = Date.now();
  const terlamaMs = sekarang - p.retentionDays * 86_400_000;
  const layak = pings.filter((t) => {
    const waktu = new Date(t.recordedAt).getTime();
    // Masa depan (jam ponsel maju) atau sudah melewati masa simpan: tidak disimpan.
    return waktu <= sekarang + 5 * 60_000 && waktu >= terlamaMs;
  });

  const { count } = await prisma.locationPing.createMany({
    data: layak.map((t) => ({
      id: generateULID(),
      employeeId: req.user!.id,
      location: encryptJson({ lat: t.latitude, lng: t.longitude } satisfies Koordinat),
      accuracyMeters: t.accuracyMeters ?? null,
      isMocked: t.isMocked ?? false,
      recordedAt: new Date(t.recordedAt),
    })),
    // Kiriman ulang titik yang sama (jawaban sebelumnya hilang) tidak menggandakannya.
    skipDuplicates: true,
  });
  res.json({ diterima: count, dilewati: pings.length - count, enabled: true });
};

export const putTrackingStatus = async (req: Request, res: Response) => {
  const input = req.body as TrackingStatusInput;
  const data = {
    permission: input.permission ?? null,
    platform: input.platform ?? null,
    appVersion: input.appVersion ?? null,
  };
  const ada = await prisma.locationTrackingStatus.findUnique({ where: { employeeId: req.user!.id } });
  // Waktu persetujuan pertama dipertahankan; menarik persetujuan mengosongkannya.
  const consentAt = input.consent ? (ada?.consentAt ?? new Date()) : null;
  await prisma.locationTrackingStatus.upsert({
    where: { employeeId: req.user!.id },
    create: { id: generateULID(), employeeId: req.user!.id, consentAt, ...data },
    update: { consentAt, ...data },
  });
  res.status(204).end();
};

// ---------------------------------------------------------------- Super Admin

export const getTrackingSettings = async (_req: Request, res: Response) => {
  res.json(await bacaPengaturan());
};

export const putTrackingSettings = async (req: Request, res: Response) => {
  const input = req.body as TrackingSettingsInput;
  const hasil = await prisma.locationTrackingSetting.upsert({
    where: { id: 'utama' },
    create: { id: 'utama', ...input, updatedById: req.user!.id },
    update: { ...input, updatedById: req.user!.id },
  });
  // Masa simpan yang dipersingkat langsung berlaku, bukan menunggu jadwal.
  const dihapus = await hapusLokasiKedaluwarsa();
  res.locals.audit = {
    action: 'lokasi.pantau.pengaturan',
    entity: 'LocationTrackingSetting',
    entityId: 'utama',
    summary: `Pemantauan lokasi ${input.enabled ? 'aktif' : 'nonaktif'}: ${input.mode === 'always' ? '24 jam' : 'selama bekerja'}, tiap ${input.intervalMinutes} menit, simpan ${input.retentionDays} hari`,
    metadata: { ...input, titikDihapus: dihapus },
  };
  res.json(hasil);
};

/** Posisi terakhir tiap karyawan aktif, beserta keadaan pemantauan di ponselnya. */
export const getLatestLocations = async (_req: Request, res: Response) => {
  const [karyawan, terakhir, status, p] = await Promise.all([
    prisma.employee.findMany({
      where: { status: { in: [...ACTIVE_STATUSES] } },
      select: { id: true, nik: true, name: true, department: { select: { name: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.$queryRaw<{ employeeId: string; location: string; accuracyMeters: number | null; isMocked: boolean; recordedAt: Date; receivedAt: Date }[]>`
      SELECT DISTINCT ON ("employeeId") "employeeId", "location", "accuracyMeters", "isMocked", "recordedAt", "receivedAt"
      FROM "LocationPing"
      ORDER BY "employeeId", "recordedAt" DESC`,
    prisma.locationTrackingStatus.findMany(),
    bacaPengaturan(),
  ]);
  const titikPer = new Map(terakhir.map((t) => [t.employeeId, t]));
  const statusPer = new Map(status.map((s) => [s.employeeId, s]));

  res.locals.audit = {
    action: 'lokasi.pantau.lihat',
    entity: 'LocationPing',
    summary: 'Melihat posisi terakhir semua karyawan',
  };
  res.json({
    settings: p,
    data: karyawan.map((k) => {
      const t = titikPer.get(k.id);
      const s = statusPer.get(k.id);
      const koordinat = t ? decryptJson<Koordinat>(t.location) : null;
      return {
        employee: { id: k.id, nik: k.nik, name: k.name, department: k.department?.name ?? null },
        last: t && koordinat
          ? { latitude: koordinat.lat, longitude: koordinat.lng, accuracyMeters: t.accuracyMeters, isMocked: t.isMocked, recordedAt: t.recordedAt, receivedAt: t.receivedAt }
          : null,
        status: s ? { consentAt: s.consentAt, permission: s.permission, platform: s.platform, appVersion: s.appVersion, updatedAt: s.updatedAt } : null,
      };
    }),
  });
};

/** Jejak satu karyawan pada satu tanggal (zona operasional), urut waktu. */
export const getEmployeeTrail = async (req: Request, res: Response) => {
  const { date } = req.query as unknown as TrailQuery;
  const karyawan = await prisma.employee.findUnique({ where: { id: req.params.id }, select: { id: true, nik: true, name: true } });
  if (!karyawan) return res.status(404).json({ error: 'Karyawan tidak ditemukan' });

  const rentang = businessDayRange(date, date, env.APP_TIMEZONE);
  const titik = await prisma.locationPing.findMany({
    where: { employeeId: karyawan.id, recordedAt: { gte: rentang.gte, lt: rentang.lt } },
    orderBy: { recordedAt: 'asc' },
    select: { location: true, accuracyMeters: true, isMocked: true, recordedAt: true, receivedAt: true },
  });

  res.locals.audit = {
    action: 'lokasi.pantau.riwayat',
    entity: 'Employee',
    entityId: karyawan.id,
    summary: `Melihat riwayat lokasi ${karyawan.name} tanggal ${date.toISOString().slice(0, 10)}`,
  };
  res.json({
    employee: karyawan,
    data: titik.flatMap((t) => {
      const k = decryptJson<Koordinat>(t.location);
      return k ? [{ latitude: k.lat, longitude: k.lng, accuracyMeters: t.accuracyMeters, isMocked: t.isMocked, recordedAt: t.recordedAt, receivedAt: t.receivedAt }] : [];
    }),
  });
};

/** Pembersih berkala di proses server (lihat index.ts). */
let pembersih: NodeJS.Timeout | null = null;
export const mulaiPembersihLokasi = () => {
  const jalan = () => hapusLokasiKedaluwarsa().catch((e) => console.warn('[pemantauan] gagal menghapus lokasi lama:', e));
  void jalan();
  pembersih = setInterval(jalan, 60 * 60 * 1000);
  pembersih.unref();
};
export const hentikanPembersihLokasi = () => {
  if (pembersih) clearInterval(pembersih);
  pembersih = null;
};
