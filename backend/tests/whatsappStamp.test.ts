import request from 'supertest';
import sharp from 'sharp';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makeWorkLocation, MONAS } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth, expectStatus } from './helpers/api';
import { env } from '../src/config/env';
import { setPembuatSoket, shutdownSessions, tungguEventSelesai, type SesiDibuat, type MetadataGrup } from '../src/services/whatsapp/session';
import { tungguStempelSelesai, buatGambarStempel, barisStempel, teksKeterangan, LEBAR_STEMPEL } from '../src/services/whatsapp/attendanceStamp';

const app = bikinApp();

interface Kiriman { jid: string; content: { image?: Buffer; caption?: string; text?: string } }

class SoketPalsu {
  penangan = new Map<string, ((data: unknown) => void)[]>();
  user: { id?: string } | null = null;
  grup: Record<string, MetadataGrup> = {
    '120363001@g.us': { id: '120363001@g.us', subject: 'Tim Kitchen', participants: [{}, {}, {}] },
    '120363002@g.us': { id: '120363002@g.us', subject: 'Absensi Outlet Kemang', participants: [{}, {}] },
  };
  kiriman: Kiriman[] = [];
  gagalKirim = false;
  ev = {
    on: (nama: string, penangan: (data: unknown) => void) => {
      const daftar = this.penangan.get(nama) ?? [];
      daftar.push(penangan);
      this.penangan.set(nama, daftar);
    },
  };
  logout = async () => {};
  end = () => {};
  groupFetchAllParticipating = async () => this.grup;
  sendMessage = async (jid: string, content: Kiriman['content']) => {
    if (this.gagalKirim) throw new Error('rate-overlimit');
    this.kiriman.push({ jid, content });
    return {};
  };
  pancarkan(nama: string, data: unknown) {
    for (const p of this.penangan.get(nama) ?? []) p(data);
  }
}

const soket = new Map<string, SoketPalsu>();
let budiToken: string;
let budi: { id: string };
let lokasiId: string;
let fotoBase64: string;

beforeAll(async () => {
  const jpeg = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#888888' } }).jpeg().toBuffer();
  fotoBase64 = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
});

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1', name: 'Budi Cook' });
  budiToken = await login(app, 'budi@resto.id');
  lokasiId = (await makeWorkLocation({ name: 'Outlet Kemang' })).id;
  soket.clear();
  setPembuatSoket(async ({ accountId }): Promise<SesiDibuat> => {
    const s = new SoketPalsu();
    soket.set(accountId, s);
    return { sock: s, simpanKredensial: async () => {} };
  });
  (env as { WHATSAPP_BAILEYS_ENABLED: boolean }).WHATSAPP_BAILEYS_ENABLED = true;
});

afterEach(async () => {
  await tungguStempelSelesai();
  await shutdownSessions();
  setPembuatSoket(null);
});

const tautkan = async (nomor = '628111111111') => {
  const res = await request(app).post('/api/whatsapp/me/connect').set(auth(budiToken)).send({});
  expectStatus(res, 202);
  const s = soket.get(res.body.account.id)!;
  s.user = { id: `${nomor}:5@s.whatsapp.net` };
  s.pancarkan('connection.update', { connection: 'open' });
  await tungguEventSelesai();
  return { accountId: res.body.account.id as string, soket: s };
};

const pilihGrup = async (jid: string | null) => {
  const res = await request(app).put('/api/whatsapp/me/attendance-group').set(auth(budiToken)).send({ jid });
  expectStatus(res, 200);
  return res.body;
};

const laporanJujur = { mockLocation: false, mockApps: [], rooted: false, emulator: false, developerOptions: false, networkDistanceMeters: 50, positionAgeSeconds: 1, platform: 'android' as const };

const checkIn = (ubah: Record<string, unknown> = {}) =>
  request(app).post('/api/attendance/check-in').set(auth(budiToken)).send({ method: 'gps', workLocationId: lokasiId, ...MONAS, integrity: laporanJujur, ...ubah });

describe('Memilih grup tujuan foto absensi', () => {
  it('daftar grup butuh WhatsApp tertaut dan tersambung', async () => {
    const belum = await request(app).get('/api/whatsapp/me/groups').set(auth(budiToken));
    expectStatus(belum, 409);

    const res = await request(app).post('/api/whatsapp/me/connect').set(auth(budiToken)).send({});
    expectStatus(res, 202);
    const menunggu = await request(app).get('/api/whatsapp/me/groups').set(auth(budiToken));
    expectStatus(menunggu, 409);
    expect(menunggu.body.error).toContain('belum tersambung');
  });

  it('menampilkan grup yang diikuti, terurut nama, beserta jumlah anggota', async () => {
    await tautkan();
    const res = await request(app).get('/api/whatsapp/me/groups').set(auth(budiToken));
    expectStatus(res, 200);
    expect(res.body.data).toEqual([
      { jid: '120363002@g.us', nama: 'Absensi Outlet Kemang', jumlahAnggota: 2 },
      { jid: '120363001@g.us', nama: 'Tim Kitchen', jumlahAnggota: 3 },
    ]);
    expect(res.body.terpilih).toBeNull();
  });

  it('hanya grup yang benar-benar diikuti yang bisa dipilih; namanya disalin', async () => {
    await tautkan();
    const asing = await request(app).put('/api/whatsapp/me/attendance-group').set(auth(budiToken)).send({ jid: '120363999@g.us' });
    expectStatus(asing, 404);
    const salah = await request(app).put('/api/whatsapp/me/attendance-group').set(auth(budiToken)).send({ jid: 'bukan-grup' });
    expectStatus(salah, 400);

    const ok = await pilihGrup('120363002@g.us');
    expect(ok.account.attendanceGroup).toEqual({ jid: '120363002@g.us', name: 'Absensi Outlet Kemang' });

    const me = await request(app).get('/api/whatsapp/me').set(auth(budiToken));
    expect(me.body.account.attendanceGroup.name).toBe('Absensi Outlet Kemang');

    const batal = await pilihGrup(null);
    expect(batal.account.attendanceGroup).toBeNull();
  });
});

describe('Foto absensi ber-stempel dikirim ke grup', () => {
  it('check-in mengirim gambar JPEG lebar 1080 dengan keterangan lengkap ke grup pilihan', async () => {
    const { soket: s } = await tautkan();
    await pilihGrup('120363002@g.us');

    const res = await checkIn({ photo: fotoBase64 });
    expectStatus(res, 201);
    await tungguStempelSelesai();

    expect(s.kiriman).toHaveLength(1);
    expect(s.kiriman[0].jid).toBe('120363002@g.us');
    const gambar = s.kiriman[0].content.image!;
    expect(gambar.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect((await sharp(gambar).metadata()).width).toBe(LEBAR_STEMPEL);
    const caption = s.kiriman[0].content.caption!;
    expect(caption).toContain('CHECK-IN — Budi Cook (EMP-1)');
    expect(caption).toContain('Outlet Kemang');
    expect(caption).toContain('GPS');

    const baris = await prisma.attendance.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(baris.stampStatus).toBe('sent');
    expect(baris.stampNote).toContain('Absensi Outlet Kemang');
    expect(baris.stampSentAt).not.toBeNull();
  });

  it('tanpa grup terpilih tidak ada yang dikirim dan presensi tetap tercatat', async () => {
    const { soket: s } = await tautkan();
    const res = await checkIn({ photo: fotoBase64 });
    expectStatus(res, 201);
    await tungguStempelSelesai();
    expect(s.kiriman).toHaveLength(0);
    expect((await prisma.attendance.findUniqueOrThrow({ where: { id: res.body.id } })).stampStatus).toBe('skipped');
  });

  it('tanpa foto tetap mengirim stempel dari latar polos', async () => {
    const { soket: s } = await tautkan();
    await pilihGrup('120363001@g.us');
    const res = await checkIn();
    expectStatus(res, 201);
    await tungguStempelSelesai();
    expect(s.kiriman).toHaveLength(1);
    expect((await sharp(s.kiriman[0].content.image!).metadata()).height).toBe(720);
  });

  it('kegagalan WhatsApp tidak menggagalkan presensi; dicatat sebagai failed', async () => {
    const { soket: s } = await tautkan();
    await pilihGrup('120363001@g.us');
    s.gagalKirim = true;
    const res = await checkIn({ photo: fotoBase64 });
    expectStatus(res, 201);
    await tungguStempelSelesai();
    const baris = await prisma.attendance.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(baris.stampStatus).toBe('failed');
    expect(baris.stampNote).toContain('rate-overlimit');
  });

  it('sesi putus saat absen: presensi 201, stempel failed dengan alasan', async () => {
    const { soket: s } = await tautkan();
    await pilihGrup('120363001@g.us');
    s.pancarkan('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
    await tungguEventSelesai();
    const res = await checkIn({ photo: fotoBase64 });
    expectStatus(res, 201);
    await tungguStempelSelesai();
    const baris = await prisma.attendance.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(baris.stampStatus).toBe('failed');
    expect(baris.stampNote).toContain('tidak tersambung');
  });

  it('check-out mengirim stempel CHECK-OUT dengan jam kerja', async () => {
    const { soket: s } = await tautkan();
    await pilihGrup('120363002@g.us');
    const masuk = await checkIn({ photo: fotoBase64 });
    expectStatus(masuk, 201);
    await tungguStempelSelesai();

    const keluar = await request(app).post('/api/attendance/check-out').set(auth(budiToken)).send({ method: 'gps', ...MONAS, integrity: laporanJujur, photo: fotoBase64 });
    expectStatus(keluar, 200);
    await tungguStempelSelesai();

    expect(s.kiriman).toHaveLength(2);
    expect(s.kiriman[1].content.caption).toContain('CHECK-OUT — Budi Cook');
    expect(s.kiriman[1].content.caption).toContain('kerja');
    expect((await prisma.attendance.findUniqueOrThrow({ where: { id: masuk.body.id } })).stampStatus).toBe('sent');
  });
});

describe('Penyusunan stempel (murni)', () => {
  const data = { jenis: 'masuk' as const, nama: 'Siti <Waiter> & Co', nik: 'EMP-2', waktu: new Date('2026-09-21T01:02:00.000Z'), lokasi: 'Outlet HI', latitude: -6.1953, longitude: 106.8231, metode: 'face', wajahTerverifikasi: true, status: 'late', menitTerlambat: 7 };

  it('baris stempel memuat jam zona aplikasi, lokasi, koordinat, metode, dan status', () => {
    const baris = barisStempel(data);
    expect(baris[0]).toBe('CHECK-IN · Siti <Waiter> & Co (EMP-2)');
    expect(baris[1]).toMatch(/21 Sep 2026 08:02/);
    expect(baris[2]).toBe('Outlet HI · -6.19530, 106.82310');
    expect(baris[3]).toBe('Wajah · wajah terverifikasi · Terlambat 7 mnt');
    expect(teksKeterangan(data)).toContain('✅ CHECK-IN');
  });

  it('karakter khusus pada nama tidak merusak SVG dan gambar tetap terbentuk', async () => {
    const foto = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#3355aa' } }).png().toBuffer();
    const hasil = await buatGambarStempel(foto, data);
    const meta = await sharp(hasil).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(LEBAR_STEMPEL);
    expect(meta.height).toBe(810);
  });
});
