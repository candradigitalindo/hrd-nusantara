import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth, expectStatus } from './helpers/api';
import { env } from '../src/config/env';
import { decryptField } from '../src/utils/fieldCrypto';
import {
  getSession,
  setPembuatSoket,
  shutdownSessions,
  tungguEventSelesai,
  type SesiDibuat,
} from '../src/services/whatsapp/session';
import { ALASAN_PUTUS } from '../src/services/whatsapp/reconnect';
import * as ingest from '../src/services/whatsapp/ingest';

const app = bikinApp();

const NOMOR_PERUSAHAAN = '08111111111';
const NOMOR_PELANGGAN = '08222222222';

/**
 * Soket palsu yang meniru permukaan Baileys yang dipakai session.ts.
 *
 * Dengan ini seluruh alur — QR muncul, tersambung, putus, pesan masuk —
 * bisa diuji tanpa benar-benar menghubungi WhatsApp, yang selain mustahil
 * di CI juga akan membuat hasil test bergantung pada jaringan.
 */
class SoketPalsu {
  penangan = new Map<string, ((data: unknown) => void)[]>();
  logoutDipanggil = 0;
  endDipanggil = 0;

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

  end = () => {
    this.endDipanggil += 1;
  };

  pancarkan(nama: string, data: unknown) {
    for (const p of this.penangan.get(nama) ?? []) p(data);
  }
}

let soketTerakhir: SoketPalsu | null = null;
let hrToken: string;
let budi: { id: string };
let budiToken: string;
let sitiToken: string;

const pasangSoketPalsu = () => {
  setPembuatSoket(async (): Promise<SesiDibuat> => {
    soketTerakhir = new SoketPalsu();
    return { sock: soketTerakhir, simpanKredensial: async () => {} };
  });
};

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
  budiToken = await login(app, 'budi@resto.id');
  await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2' });
  sitiToken = await login(app, 'siti@resto.id');

  soketTerakhir = null;
  pasangSoketPalsu();
  (env as { WHATSAPP_BAILEYS_ENABLED: boolean }).WHATSAPP_BAILEYS_ENABLED = true;
});

afterEach(async () => {
  // Menunggu sampai benar-benar diam. Penangan event berjalan di luar siklus
  // request, jadi tanpa ini pekerjaan yang masih jalan bisa menulis ke
  // database saat berkas test BERIKUTNYA sudah mulai mengosongkannya.
  await shutdownSessions();
  setPembuatSoket(null);
  (env as { WHATSAPP_BAILEYS_ENABLED: boolean }).WHATSAPP_BAILEYS_ENABLED = false;
});

const buatAkun = async (ubah: Record<string, unknown> = {}) => {
  const res = await request(app)
    .post('/api/whatsapp/accounts')
    .set(auth(hrToken))
    .send({
      phoneNumber: NOMOR_PERUSAHAAN,
      label: 'CS Outlet Kemang',
      assignedEmployeeId: budi.id,
      ...ubah,
    });
  expectStatus(res, 201);
  return res.body.id as string;
};

const sambungkan = async (id: string) => {
  const res = await request(app)
    .post(`/api/whatsapp/accounts/${id}/connect`)
    .set(auth(hrToken))
    .send({});
  expectStatus(res, 202);
  return res.body;
};

describe('Menyambungkan nomor ke WhatsApp', () => {
  it('menolak kalau driver tidak dinyalakan', async () => {
    const id = await buatAkun();
    (env as { WHATSAPP_BAILEYS_ENABLED: boolean }).WHATSAPP_BAILEYS_ENABLED = false;

    const res = await request(app)
      .post(`/api/whatsapp/accounts/${id}/connect`)
      .set(auth(hrToken))
      .send({});

    expect(res.status).toBe(503);
  });

  it('menolak nomor yang sudah dinonaktifkan', async () => {
    const id = await buatAkun();
    expectStatus(
      await request(app)
        .put(`/api/whatsapp/accounts/${id}`)
        .set(auth(hrToken))
        .send({ isActive: false }),
      200
    );

    const res = await request(app)
      .post(`/api/whatsapp/accounts/${id}/connect`)
      .set(auth(hrToken))
      .send({});

    // Menyambungkan nomor nonaktif berarti membuka akses ke WhatsApp orang
    // untuk nomor yang sudah dinyatakan tidak dipantau lagi.
    expect(res.status).toBe(409);
  });

  it('menolak karyawan biasa menyambungkan nomor', async () => {
    const id = await buatAkun();

    const res = await request(app)
      .post(`/api/whatsapp/accounts/${id}/connect`)
      .set(auth(budiToken))
      .send({});

    expect(res.status).toBe(403);
  });
});

describe('QR dan scan ulang', () => {
  it('menyediakan QR sebagai gambar saat menunggu scan', async () => {
    const id = await buatAkun();
    await sambungkan(id);

    soketTerakhir!.pancarkan('connection.update', { qr: 'QR-STRING-DARI-WHATSAPP' });
    await tungguEventSelesai();

    const res = await request(app)
      .get(`/api/whatsapp/accounts/${id}/session`)
      .set(auth(hrToken));

    expectStatus(res, 200);
    expect(res.body.status).toBe('pending_scan');
    // Data URL supaya web dan mobile bisa langsung menampilkannya.
    expect(res.body.qr).toMatch(/^data:image\/png;base64,/);
  });

  it('mencatat kejadian scan sekali saja walau QR diperbarui berkali-kali', async () => {
    const id = await buatAkun();
    await sambungkan(id);

    // WhatsApp memperbarui QR tiap ~20 detik. Satu kejadian per pembaruan
    // akan membanjiri arsip dan memberi tahu pemegang nomor berulang-ulang
    // untuk satu keadaan yang sama.
    for (const qr of ['QR-1', 'QR-2', 'QR-3']) {
      soketTerakhir!.pancarkan('connection.update', { qr });
      await tungguEventSelesai();
    }

    const kejadian = await prisma.whatsAppSessionEvent.findMany({
      where: { eventType: 'scan_required' },
    });
    expect(kejadian).toHaveLength(1);
  });

  it('memperlihatkan QR kepada pemegang nomornya sendiri', async () => {
    // Yang harus memindai QR dengan ponsel perusahaan adalah dia, bukan HR.
    const id = await buatAkun();
    await sambungkan(id);
    soketTerakhir!.pancarkan('connection.update', { qr: 'QR-STRING' });
    await tungguEventSelesai();

    const res = await request(app)
      .get(`/api/whatsapp/accounts/${id}/session`)
      .set(auth(budiToken));

    expectStatus(res, 200);
    expect(res.body.qr).toMatch(/^data:image\/png;base64,/);
  });

  it('menolak karyawan lain melihat QR nomor yang bukan miliknya', async () => {
    // QR ini memberi akses penuh untuk menautkan perangkat ke akun WhatsApp
    // perusahaan. Bocor ke orang lain sama dengan menyerahkan akunnya.
    const id = await buatAkun();
    await sambungkan(id);
    soketTerakhir!.pancarkan('connection.update', { qr: 'QR-STRING' });
    await tungguEventSelesai();

    const res = await request(app)
      .get(`/api/whatsapp/accounts/${id}/session`)
      .set(auth(sitiToken));

    expect(res.status).toBe(403);
  });
});

describe('Perubahan keadaan sesi', () => {
  it('mencatat dan menandai tersambung', async () => {
    const id = await buatAkun();
    await sambungkan(id);

    soketTerakhir!.pancarkan('connection.update', { connection: 'open' });
    await tungguEventSelesai();

    const akun = await prisma.whatsAppAccount.findUniqueOrThrow({ where: { id } });
    expect(akun.sessionStatus).toBe('connected');
    expect(akun.lastConnectedAt).not.toBeNull();

    const kejadian = await prisma.whatsAppSessionEvent.findMany({ where: { accountId: id } });
    expect(kejadian.map((k) => k.eventType)).toContain('connected');
  });

  it('meminta scan ulang saat sesi di-logout dari ponsel', async () => {
    const id = await buatAkun();
    await sambungkan(id);
    soketTerakhir!.pancarkan('connection.update', { connection: 'open' });
    await tungguEventSelesai();

    soketTerakhir!.pancarkan('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: ALASAN_PUTUS.loggedOut } } },
    });
    await tungguEventSelesai();

    const akun = await prisma.whatsAppAccount.findUniqueOrThrow({ where: { id } });
    expect(akun.sessionStatus).toBe('pending_scan');

    const kejadian = await prisma.whatsAppSessionEvent.findMany({
      where: { accountId: id, eventType: 'scan_required' },
    });
    expect(kejadian).toHaveLength(1);
    expect(kejadian[0].note).toContain('scan QR ulang');
  });

  it('mencatat putus biasa sebagai disconnected, bukan minta scan', async () => {
    const id = await buatAkun();
    await sambungkan(id);

    soketTerakhir!.pancarkan('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: ALASAN_PUTUS.connectionClosed } } },
    });
    await tungguEventSelesai();

    // Gangguan jaringan tidak boleh menyuruh karyawan memindai QR lagi:
    // sesinya masih sah, hanya perlu disambungkan ulang.
    const kejadian = await prisma.whatsAppSessionEvent.findMany({ where: { accountId: id } });
    expect(kejadian.map((k) => k.eventType)).toEqual(['disconnected']);
  });
});

describe('Memutus sesi dari HR', () => {
  it('logout memaksa scan ulang', async () => {
    const id = await buatAkun();
    await sambungkan(id);
    const soket = soketTerakhir!;

    const res = await request(app)
      .post(`/api/whatsapp/accounts/${id}/disconnect`)
      .set(auth(hrToken))
      .send({ logout: true });

    expectStatus(res, 200);
    expect(soket.logoutDipanggil).toBe(1);

    const akun = await prisma.whatsAppAccount.findUniqueOrThrow({ where: { id } });
    expect(akun.sessionStatus).toBe('pending_scan');
  });

  it('memutus tanpa logout menyisakan sesi yang bisa disambung lagi', async () => {
    const id = await buatAkun();
    await sambungkan(id);
    const soket = soketTerakhir!;

    const res = await request(app)
      .post(`/api/whatsapp/accounts/${id}/disconnect`)
      .set(auth(hrToken))
      .send({ logout: false });

    expectStatus(res, 200);
    expect(soket.logoutDipanggil).toBe(0);
    expect(soket.endDipanggil).toBe(1);

    const akun = await prisma.whatsAppAccount.findUniqueOrThrow({ where: { id } });
    expect(akun.sessionStatus).toBe('disconnected');
  });

  it('sesi yang diputus HR lalu disambungkan lagi tetap menyambung ulang sendiri saat putus', async () => {
    const id = await buatAkun();
    await sambungkan(id);
    soketTerakhir!.pancarkan('connection.update', { connection: 'open' });
    await tungguEventSelesai();

    await request(app).post(`/api/whatsapp/accounts/${id}/disconnect`).set(auth(hrToken)).send({ logout: false });
    await sambungkan(id);
    const soketBaru = soketTerakhir!;
    soketBaru.pancarkan('connection.update', { connection: 'open' });
    await tungguEventSelesai();

    // Gangguan jaringan biasa pada sesi yang sudah dibuka ulang.
    soketBaru.pancarkan('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: ALASAN_PUTUS.connectionClosed } } },
    });
    await tungguEventSelesai();

    // Sebelum diperbaiki: penanda "ditutup sengaja" dari pemutusan pertama
    // masih terpasang, penanganan putus berhenti diam-diam tanpa mencatat
    // apa pun, dan nomor ini tidak pernah menyambung sendiri lagi.
    expect(getSession(id)?.status).toBe('connecting');
    const kejadian = await prisma.whatsAppSessionEvent.findMany({ where: { accountId: id }, orderBy: { occurredAt: 'asc' } });
    expect(kejadian.map((k) => k.eventType)).toEqual(['connected', 'disconnected', 'connected', 'disconnected']);
  });

  it('logout adalah pilihan, bukan bawaan', async () => {
    const id = await buatAkun();
    await sambungkan(id);
    const soket = soketTerakhir!;

    await request(app)
      .post(`/api/whatsapp/accounts/${id}/disconnect`)
      .set(auth(hrToken))
      .send({});

    // Memaksa scan QR ulang hanya karena body lupa diisi berarti mengganggu
    // pekerjaan pemegang nomor tanpa alasan.
    expect(soket.logoutDipanggil).toBe(0);
  });
});

describe('Pesan masuk lewat Baileys', () => {
  const pesanBaileys = (ubah: Record<string, unknown> = {}) => ({
    key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: false, id: 'WA-1' },
    message: { conversation: 'Keluhan: pesanan lama' },
    messageTimestamp: 1789000000,
    ...ubah,
  });

  const siapkanTersambung = async () => {
    const id = await buatAkun();
    await sambungkan(id);
    soketTerakhir!.pancarkan('connection.update', { connection: 'open' });
    await tungguEventSelesai();
    return id;
  };

  it('mengarsipkan pesan baru lewat jalur yang sama dengan webhook', async () => {
    const id = await siapkanTersambung();

    soketTerakhir!.pancarkan('messages.upsert', { type: 'notify', messages: [pesanBaileys()] });
    await tungguEventSelesai();

    const baris = await prisma.whatsAppConversation.findFirstOrThrow({
      where: { externalMessageId: 'WA-1' },
    });
    expect(baris.accountId).toBe(id);
    expect(baris.direction).toBe('incoming');
    expect(baris.contactNumber).toBe('628222222222');
    // Enkripsi dan indeks pencarian berlaku sama, karena jalur simpannya satu.
    expect(baris.messageBody).toMatch(/^v1\./);
    expect(decryptField(baris.messageBody)).toBe('Keluhan: pesanan lama');
    expect(baris.searchTokens.length).toBeGreaterThan(0);
    // Pemegang nomor ikut tercatat.
    expect(baris.employeeId).toBe(budi.id);
  });

  it('tidak mengarsipkan sinkronisasi riwayat lama', async () => {
    await siapkanTersambung();

    // type 'append' adalah riwayat yang ditarik WhatsApp saat perangkat baru
    // ditautkan. Mengarsipkannya berarti menyedot percakapan dari sebelum
    // pemantauan disetujui — jauh di luar ruang lingkup.
    soketTerakhir!.pancarkan('messages.upsert', { type: 'append', messages: [pesanBaileys()] });
    await tungguEventSelesai();

    expect(await prisma.whatsAppConversation.count()).toBe(0);
  });

  it('tidak mengarsipkan percakapan grup', async () => {
    await siapkanTersambung();

    soketTerakhir!.pancarkan('messages.upsert', {
      type: 'notify',
      messages: [pesanBaileys({ key: { remoteJid: '123-456@g.us', fromMe: false, id: 'G-1' } })],
    });
    await tungguEventSelesai();

    expect(await prisma.whatsAppConversation.count()).toBe(0);
  });

  it('menandai arah keluar untuk pesan yang dikirim dari nomor perusahaan', async () => {
    await siapkanTersambung();

    soketTerakhir!.pancarkan('messages.upsert', {
      type: 'notify',
      messages: [
        pesanBaileys({
          key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: true, id: 'WA-2' },
          message: { conversation: 'Baik, meja disiapkan' },
        }),
      ],
    });
    await tungguEventSelesai();

    const baris = await prisma.whatsAppConversation.findFirstOrThrow({
      where: { externalMessageId: 'WA-2' },
    });
    expect(baris.direction).toBe('outgoing');
  });

  it('tidak menggandakan arsip saat pesan yang sama datang dua kali', async () => {
    await siapkanTersambung();

    // WhatsApp bisa mengirim ulang pesan yang sama saat koneksi goyah.
    for (let i = 0; i < 2; i += 1) {
      soketTerakhir!.pancarkan('messages.upsert', { type: 'notify', messages: [pesanBaileys()] });
      await tungguEventSelesai();
    }

    expect(await prisma.whatsAppConversation.count()).toBe(1);
  });

  it('kegagalan menyimpan satu pesan tidak membuang sisa batch', async () => {
    await siapkanTersambung();

    // WhatsApp tidak mengirim ulang pesan yang sudah diterima. Kalau satu
    // kegagalan database menghentikan perulangan, pesan sesudahnya hilang
    // untuk selamanya tanpa jejak.
    const asli = jest
      .spyOn(ingest, 'ingestMessage')
      .mockRejectedValueOnce(new Error('database sedang bermasalah'));

    try {
      soketTerakhir!.pancarkan('messages.upsert', {
        type: 'notify',
        messages: [
          pesanBaileys({ key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: false, id: 'GAGAL' } }),
          pesanBaileys({ key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: false, id: 'LANJUT' } }),
        ],
      });
      await tungguEventSelesai();
    } finally {
      asli.mockRestore();
    }

    const semua = await prisma.whatsAppConversation.findMany({ select: { externalMessageId: true } });
    expect(semua.map((x) => x.externalMessageId)).toEqual(['LANJUT']);
  });

  it('satu pesan bermasalah tidak menghentikan pesan lain di batch yang sama', async () => {
    await siapkanTersambung();

    soketTerakhir!.pancarkan('messages.upsert', {
      type: 'notify',
      messages: [
        pesanBaileys({ message: { stickerMessage: {} }, key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: false, id: 'STK' } }),
        pesanBaileys({ key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: false, id: 'WA-3' } }),
      ],
    });
    await tungguEventSelesai();

    const semua = await prisma.whatsAppConversation.findMany({ select: { externalMessageId: true } });
    expect(semua.map((s) => s.externalMessageId)).toEqual(['WA-3']);
  });
});
