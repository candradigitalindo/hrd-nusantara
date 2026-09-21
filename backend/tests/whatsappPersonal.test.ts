import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth, expectStatus } from './helpers/api';
import { env } from '../src/config/env';
import { decryptField } from '../src/utils/fieldCrypto';
import { setPembuatSoket, shutdownSessions, tungguEventSelesai, type SesiDibuat } from '../src/services/whatsapp/session';
import { setPengirimPush, type PesanPush } from '../src/services/notification/push';

const app = bikinApp();

/** Soket palsu; `user` diisi test untuk meniru nomor yang dilaporkan WhatsApp saat tertaut. */
class SoketPalsu {
  penangan = new Map<string, ((data: unknown) => void)[]>();
  logoutDipanggil = 0;
  user: { id?: string } | null = null;
  ev = {
    on: (nama: string, penangan: (data: unknown) => void) => {
      const daftar = this.penangan.get(nama) ?? [];
      daftar.push(penangan);
      this.penangan.set(nama, daftar);
    },
  };
  logout = async () => {
    this.logoutDipanggil += 1;
  };
  end = () => {};
  pancarkan(nama: string, data: unknown) {
    for (const p of this.penangan.get(nama) ?? []) p(data);
  }
}

const soket = new Map<string, SoketPalsu>();
let hrToken: string;
let budi: { id: string };
let budiToken: string;
let siti: { id: string };
let sitiToken: string;
let pushTerkirim: { employeeTokens: string[]; pesan: PesanPush }[] = [];

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1', name: 'Budi Cook' });
  budiToken = await login(app, 'budi@resto.id');
  siti = await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2', name: 'Siti Waiter' });
  sitiToken = await login(app, 'siti@resto.id');

  soket.clear();
  setPembuatSoket(async ({ accountId }): Promise<SesiDibuat> => {
    const s = new SoketPalsu();
    soket.set(accountId, s);
    return { sock: s, simpanKredensial: async () => {} };
  });
  (env as { WHATSAPP_BAILEYS_ENABLED: boolean }).WHATSAPP_BAILEYS_ENABLED = true;

  pushTerkirim = [];
  setPengirimPush(async (tokens, pesan) => {
    pushTerkirim.push({ employeeTokens: tokens, pesan });
    return { terkirim: tokens.length, gagal: 0, tokenTidakSah: [] };
  });
});

afterEach(async () => {
  await shutdownSessions();
  setPembuatSoket(null);
  setPengirimPush(null);
});

const saya = async (token: string) => {
  const res = await request(app).get('/api/whatsapp/me').set(auth(token));
  expectStatus(res, 200);
  return res.body;
};

/** Menautkan WhatsApp seorang karyawan sampai tersambung dengan nomor tertentu. */
const tautkan = async (token: string, nomorTertaut: string) => {
  const res = await request(app).post('/api/whatsapp/me/connect').set(auth(token)).send({});
  expectStatus(res, 202);
  const accountId = res.body.account.id as string;
  const s = soket.get(accountId)!;
  s.pancarkan('connection.update', { qr: 'QR-1' });
  await tungguEventSelesai();
  s.user = { id: `${nomorTertaut}:5@s.whatsapp.net` };
  s.pancarkan('connection.update', { connection: 'open' });
  await tungguEventSelesai();
  return { accountId, soket: s };
};

const pesanBaileys = (ubah: Record<string, unknown> = {}) => ({
  key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: false, id: 'WA-1' },
  message: { conversation: 'Halo, jadwal besok gimana?' },
  messageTimestamp: 1789000000,
  ...ubah,
});

describe('Karyawan menautkan WhatsApp-nya sendiri', () => {
  it('membuat akun pribadi tanpa nomor, menyediakan QR, lalu mempelajari nomor saat tertaut', async () => {
    expect((await saya(budiToken)).status).toBe('never_linked');

    const res = await request(app).post('/api/whatsapp/me/connect').set(auth(budiToken)).send({});
    expectStatus(res, 202);
    expect(res.body.account).toMatchObject({ kind: 'personal', phoneNumber: null, label: 'Budi Cook' });
    expect(res.body.status).toBe('connecting');

    const s = soket.get(res.body.account.id)!;
    s.pancarkan('connection.update', { qr: 'QR-STRING' });
    await tungguEventSelesai();

    const menunggu = await saya(budiToken);
    expect(menunggu.status).toBe('pending_scan');
    expect(menunggu.qr).toMatch(/^data:image\/png;base64,/);

    s.user = { id: '628111111111:5@s.whatsapp.net' };
    s.pancarkan('connection.update', { connection: 'open' });
    await tungguEventSelesai();

    const tersambung = await saya(budiToken);
    expect(tersambung.status).toBe('connected');
    expect(tersambung.account.phoneNumber).toBe('628111111111');
    expect(tersambung.qr).toBeNull();

    const akun = await prisma.whatsAppAccount.findUniqueOrThrow({ where: { id: res.body.account.id } });
    expect(akun.assignedEmployeeId).toBe(budi.id);
    expect(akun.sessionStatus).toBe('connected');
  });

  it('nomor WhatsApp yang tertaut mengisi nomor HP karyawan yang masih kosong (username login)', async () => {
    await tautkan(budiToken, '628111111111');
    const budiDb = await prisma.employee.findUniqueOrThrow({ where: { id: budi.id } });
    expect(budiDb.phoneNumber).toBe('628111111111');
    // Kini Budi bisa login dengan nomornya.
    const login = await request(app).post('/api/auth/login').send({ username: '08111111111', password: 'RahasiaUji123' });
    expect(login.status).toBe(200);
  });

  it('nomor HP karyawan yang sudah diisi HR tidak ditimpa oleh WhatsApp', async () => {
    await prisma.employee.update({ where: { id: budi.id }, data: { phoneNumber: '628999999999' } });
    await tautkan(budiToken, '628111111111');
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: budi.id } })).phoneNumber).toBe('628999999999');
  });

  it('menautkan dua kali tidak membuat akun kedua', async () => {
    await tautkan(budiToken, '628111111111');
    const lagi = await request(app).post('/api/whatsapp/me/connect').set(auth(budiToken)).send({});
    expectStatus(lagi, 202);
    expect(await prisma.whatsAppAccount.count({ where: { assignedEmployeeId: budi.id } })).toBe(1);
  });

  it('karyawan lain tidak melihat tautan saya', async () => {
    await tautkan(budiToken, '628111111111');
    expect((await saya(sitiToken)).status).toBe('never_linked');
  });

  it('menolak bila driver WhatsApp tidak dinyalakan', async () => {
    (env as { WHATSAPP_BAILEYS_ENABLED: boolean }).WHATSAPP_BAILEYS_ENABLED = false;
    const res = await request(app).post('/api/whatsapp/me/connect').set(auth(budiToken)).send({});
    expectStatus(res, 503);
    expect((await saya(budiToken)).driverAktif).toBe(false);
  });
});

describe('Arsip pesan nomor pribadi', () => {
  it('mengarsipkan pesan masuk dan keluar atas nama karyawan pemilik nomor', async () => {
    const { accountId, soket: s } = await tautkan(budiToken, '628111111111');

    s.pancarkan('messages.upsert', { type: 'notify', messages: [pesanBaileys()] });
    s.pancarkan('messages.upsert', {
      type: 'notify',
      messages: [pesanBaileys({ key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: true, id: 'WA-2' }, message: { conversation: 'Shift pagi ya' } })],
    });
    await tungguEventSelesai();

    const baris = await prisma.whatsAppConversation.findMany({ where: { accountId }, orderBy: { externalMessageId: 'asc' } });
    expect(baris).toHaveLength(2);
    expect(baris[0]).toMatchObject({ direction: 'incoming', contactNumber: '628222222222', employeeId: budi.id });
    expect(baris[1]).toMatchObject({ direction: 'outgoing', senderWhatsappNumber: '628111111111', employeeId: budi.id });
    expect(decryptField(baris[0].messageBody)).toBe('Halo, jadwal besok gimana?');
  });

  it('dua karyawan yang saling berkirim pesan masing-masing punya salinan di arsipnya', async () => {
    const b = await tautkan(budiToken, '628111111111');
    const t = await tautkan(sitiToken, '628222222222');

    // Pesan yang sama (id WA-9) tiba di kedua sesi: keluar dari Siti, masuk ke Budi.
    t.soket.pancarkan('messages.upsert', {
      type: 'notify',
      messages: [pesanBaileys({ key: { remoteJid: '628111111111@s.whatsapp.net', fromMe: true, id: 'WA-9' }, message: { conversation: 'Tukar shift?' } })],
    });
    b.soket.pancarkan('messages.upsert', {
      type: 'notify',
      messages: [pesanBaileys({ key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: false, id: 'WA-9' }, message: { conversation: 'Tukar shift?' } })],
    });
    await tungguEventSelesai();

    const baris = await prisma.whatsAppConversation.findMany({ where: { externalMessageId: 'WA-9' } });
    expect(baris).toHaveLength(2);
    const milikSiti = baris.find((r) => r.accountId === t.accountId)!;
    const milikBudi = baris.find((r) => r.accountId === b.accountId)!;
    expect(milikSiti).toMatchObject({ direction: 'outgoing', employeeId: siti.id, contactNumber: '628111111111' });
    expect(milikBudi).toMatchObject({ direction: 'incoming', employeeId: budi.id, contactNumber: '628222222222' });
  });
});

describe('Nomor yang dipindai harus benar', () => {
  it('menolak nomor pribadi yang sudah terdaftar sebagai nomor perusahaan', async () => {
    const perusahaan = await request(app)
      .post('/api/whatsapp/accounts')
      .set(auth(hrToken))
      .send({ phoneNumber: '08111111111', label: 'CS Outlet Kemang' });
    expectStatus(perusahaan, 201);

    const { accountId, soket: s } = await tautkan(budiToken, '628111111111');

    expect(s.logoutDipanggil).toBe(1);
    const akun = await prisma.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(akun.phoneNumber).toBeNull();
    expect(akun.sessionStatus).toBe('pending_scan');
    const kejadian = await prisma.whatsAppSessionEvent.findFirst({ where: { accountId }, orderBy: { occurredAt: 'desc' } });
    expect(kejadian?.eventType).toBe('scan_required');
    expect(kejadian?.note).toContain('CS Outlet Kemang');
    expect((await saya(budiToken)).status).toBe('pending_scan');
  });

  it('menolak QR nomor perusahaan yang dipindai ponsel bernomor lain', async () => {
    const perusahaan = await request(app)
      .post('/api/whatsapp/accounts')
      .set(auth(hrToken))
      .send({ phoneNumber: '08111111111', label: 'CS Outlet Kemang', assignedEmployeeId: budi.id });
    const id = perusahaan.body.id as string;
    const sambung = await request(app).post(`/api/whatsapp/accounts/${id}/connect`).set(auth(hrToken)).send({});
    expectStatus(sambung, 202);

    const s = soket.get(id)!;
    s.user = { id: '628999999999:3@s.whatsapp.net' };
    s.pancarkan('connection.update', { connection: 'open' });
    await tungguEventSelesai();

    expect(s.logoutDipanggil).toBe(1);
    const akun = await prisma.whatsAppAccount.findUniqueOrThrow({ where: { id } });
    expect(akun.phoneNumber).toBe('628111111111');
    expect(akun.sessionStatus).toBe('pending_scan');
    // Tidak ada pesan yang boleh masuk atas nama nomor yang salah.
    expect(await prisma.whatsAppConversation.count()).toBe(0);
  });

  it('karyawan ganti nomor: nomor pribadi diperbarui saat tertaut ulang', async () => {
    const { accountId } = await tautkan(budiToken, '628111111111');
    await shutdownSessions();
    const { accountId: sama } = await tautkan(budiToken, '628133333333');
    expect(sama).toBe(accountId);
    const akun = await prisma.whatsAppAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(akun.phoneNumber).toBe('628133333333');
  });
});

describe('Kepatuhan: HR melihat siapa yang belum menautkan', () => {
  it('melaporkan status tiap karyawan aktif beserta ringkasannya', async () => {
    await tautkan(budiToken, '628111111111');
    await makeEmployee({ email: 'mantan@resto.id', nik: 'EMP-9', status: 'resign' });

    const res = await request(app).get('/api/whatsapp/compliance').set(auth(hrToken));
    expectStatus(res, 200);

    const status = Object.fromEntries(res.body.data.map((d: { employee: { nik: string }; status: string }) => [d.employee.nik, d.status]));
    expect(status).toEqual({ 'HR-1': 'never_linked', 'EMP-1': 'connected', 'EMP-2': 'never_linked' });
    expect(res.body.summary).toEqual({ total: 3, connected: 1, disconnected: 0, pendingScan: 0, neverLinked: 2 });
    expect(res.body.data.find((d: { employee: { nik: string } }) => d.employee.nik === 'EMP-1').phoneNumber).toBe('628111111111');
  });

  it('karyawan biasa tidak boleh membuka laporan kepatuhan', async () => {
    const res = await request(app).get('/api/whatsapp/compliance').set(auth(budiToken));
    expectStatus(res, 403);
  });

  it('pengingat push hanya dikirim ke yang belum tersambung', async () => {
    await tautkan(budiToken, '628111111111');
    for (const [token, tokenPush] of [[budiToken, 'token-budi-panjang-sekali-0001'], [sitiToken, 'token-siti-panjang-sekali-0002']]) {
      const daftar = await request(app).post('/api/devices').set(auth(token)).send({ token: tokenPush, platform: 'android' });
      expectStatus(daftar, 201);
    }

    const res = await request(app).post('/api/whatsapp/compliance/remind').set(auth(hrToken)).send({});
    expectStatus(res, 200);
    // HR-1 tidak punya perangkat, Siti punya; Budi sudah tersambung.
    expect(res.body).toEqual({ diminta: 2, terkirim: 1 });
    expect(pushTerkirim).toHaveLength(1);
    expect(pushTerkirim[0].employeeTokens).toEqual(['token-siti-panjang-sekali-0002']);
    expect(pushTerkirim[0].pesan.title).toBe('Sambungkan WhatsApp Anda');
    expect(pushTerkirim[0].pesan.data).toMatchObject({ jenis: 'whatsapp_session', eventType: 'link_required' });
  });

  it('pengingat bisa dibatasi ke karyawan tertentu', async () => {
    const res = await request(app).post('/api/whatsapp/compliance/remind').set(auth(hrToken)).send({ employeeIds: [siti.id] });
    expectStatus(res, 200);
    expect(res.body.diminta).toBe(1);
  });
});

describe('Pemberitahuan putus sesi nomor pribadi', () => {
  it('memberi tahu karyawan dengan kalimat untuk nomor pribadi', async () => {
    const daftar = await request(app).post('/api/devices').set(auth(budiToken)).send({ token: 'token-budi-panjang-sekali-0001', platform: 'android' });
    expectStatus(daftar, 201);
    const { soket: s } = await tautkan(budiToken, '628111111111');
    pushTerkirim = [];

    s.pancarkan('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
    await tungguEventSelesai();

    expect(pushTerkirim).toHaveLength(1);
    expect(pushTerkirim[0].pesan.title).toBe('WhatsApp perlu discan ulang');
    expect(pushTerkirim[0].pesan.body).toContain('WhatsApp Anda');
    expect((await saya(budiToken)).status).toBe('pending_scan');
  });
});
