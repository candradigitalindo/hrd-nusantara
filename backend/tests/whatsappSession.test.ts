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
  type KunciPesanWhatsApp,
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

  /** Berkas yang akan dikembalikan unduhMedia; null = driver tanpa dukungan. */
  isiMedia: Buffer | null = null;
  mediaDiminta = 0;
  namaGrup = 'Tim Outlet Kemang';

  groupMetadata = async (jid: string) => ({ id: jid, subject: this.namaGrup });

  unduhMedia = async () => {
    this.mediaDiminta += 1;
    if (!this.isiMedia) throw new Error('media kedaluwarsa di server WhatsApp');
    return this.isiMedia;
  };

  /** Permintaan riwayat yang diterima, untuk diperiksa test. */
  permintaanRiwayat: { jumlah: number; kunci: KunciPesanWhatsApp; waktu: number }[] = [];

  fetchMessageHistory = async (jumlah: number, kunci: KunciPesanWhatsApp, waktu: number) => {
    this.permintaanRiwayat.push({ jumlah, kunci, waktu });
    return 'permintaan-1';
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

  it('menandai sedang menyambung ulang saat putus sementara, dan berhenti menandainya setelah menyerah', async () => {
    // Antarmuka memakai penanda ini untuk membedakan gangguan yang sedang
    // dipulihkan sendiri dari sesi yang benar-benar menunggu orang.
    const id = await buatAkun();
    await sambungkan(id);

    soketTerakhir!.pancarkan('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: ALASAN_PUTUS.timedOut } } },
    });
    await tungguEventSelesai();

    expect(getSession(id)?.sedangSambungUlang).toBe(true);
    expect(getSession(id)?.catatan).toContain('Menyambung ulang');

    // Sesi yang sudah tidak sah: tidak ada percobaan berikutnya.
    soketTerakhir!.pancarkan('connection.update', {
      connection: 'close',
      lastDisconnect: { error: { output: { statusCode: ALASAN_PUTUS.loggedOut } } },
    });
    await tungguEventSelesai();

    expect(getSession(id)?.sedangSambungUlang).toBe(false);
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

describe('Menarik percakapan lama atas permintaan', () => {
  const pesanBaileys = (ubah: Record<string, unknown> = {}) => ({
    key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: false, id: 'WA-1' },
    message: { conversation: 'Keluhan: pesanan lama' },
    messageTimestamp: 1789000000,
    ...ubah,
  });

  const siapkan = async () => {
    const id = await buatAkun();
    await sambungkan(id);
    soketTerakhir!.pancarkan('connection.update', { connection: 'open' });
    await tungguEventSelesai();
    return id;
  };

  const tarik = (id: string, token: string, body: Record<string, unknown> = {}) =>
    request(app).post(`/api/whatsapp/accounts/${id}/riwayat`).set(auth(token)).send(body);

  let superToken: string;

  beforeEach(async () => {
    await makeEmployee({ email: 'super@resto.id', nik: 'SA-1', role: Role.SUPER_ADMIN });
    superToken = await login(app, 'super@resto.id');
  });

  it('meminta riwayat dari pesan tertua tiap percakapan', async () => {
    const id = await siapkan();
    // Dua percakapan, masing-masing satu pesan sebagai titik awal.
    soketTerakhir!.pancarkan('messages.upsert', {
      type: 'notify',
      messages: [
        pesanBaileys(),
        pesanBaileys({
          key: { remoteJid: '12036301234567890@g.us', fromMe: false, id: 'G-9', participant: '628333333333@s.whatsapp.net' },
          message: { conversation: 'Absen sore' },
        }),
      ],
    });
    await tungguEventSelesai();

    const res = await tarik(id, superToken, { jumlah: 100 });
    expectStatus(res, 200);
    expect(res.body.percakapan).toBe(2);
    expect(res.body.jumlahPerPercakapan).toBe(100);

    const permintaan = soketTerakhir!.permintaanRiwayat;
    expect(permintaan).toHaveLength(2);
    expect(permintaan.every((p) => p.jumlah === 100)).toBe(true);
    // Kuncinya harus menunjuk pesan yang benar-benar ada, karena WhatsApp
    // menjawab dengan pesan yang lebih tua DARI pesan itu.
    const grup = permintaan.find((p) => String(p.kunci.remoteJid).endsWith('@g.us'));
    expect(grup?.kunci).toMatchObject({ id: 'G-9', fromMe: false, participant: '628333333333@s.whatsapp.net' });
    const pribadi = permintaan.find((p) => String(p.kunci.remoteJid).endsWith('@s.whatsapp.net'));
    expect(pribadi?.kunci).toMatchObject({ id: 'WA-1', remoteJid: '628222222222@s.whatsapp.net' });
    // Waktu dikirim dalam detik, bukan milidetik.
    expect(pribadi?.waktu).toBe(1789000000);
  });

  it('bisa dibatasi ke satu nomor kontak saja', async () => {
    const id = await siapkan();
    soketTerakhir!.pancarkan('messages.upsert', {
      type: 'notify',
      messages: [
        pesanBaileys(),
        pesanBaileys({ key: { remoteJid: '628555555555@s.whatsapp.net', fromMe: false, id: 'WA-9' } }),
      ],
    });
    await tungguEventSelesai();

    const res = await tarik(id, superToken, { contactNumber: '08222222222' });
    expectStatus(res, 200);
    expect(res.body.percakapan).toBe(1);
    expect(soketTerakhir!.permintaanRiwayat[0].kunci.remoteJid).toBe('628222222222@s.whatsapp.net');
  });

  it('mengarsipkan riwayat yang datang belakangan', async () => {
    const id = await siapkan();
    soketTerakhir!.pancarkan('messages.upsert', { type: 'notify', messages: [pesanBaileys()] });
    await tungguEventSelesai();
    expectStatus(await tarik(id, superToken), 200);

    // Jawaban WhatsApp datang lewat event terpisah, beberapa saat kemudian.
    soketTerakhir!.pancarkan('messaging-history.set', {
      messages: [
        pesanBaileys({ key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: false, id: 'LAMA-1' }, message: { conversation: 'Pesanan bulan lalu' }, messageTimestamp: 1780000000 }),
      ],
    });
    await tungguEventSelesai();

    const lama = await prisma.whatsAppConversation.findFirstOrThrow({ where: { externalMessageId: 'LAMA-1' } });
    expect(decryptField(lama.messageBody)).toBe('Pesanan bulan lalu');
    expect(lama.accountId).toBe(id);
  });

  it('hanya Super Admin yang boleh menariknya', async () => {
    const id = await siapkan();
    soketTerakhir!.pancarkan('messages.upsert', { type: 'notify', messages: [pesanBaileys()] });
    await tungguEventSelesai();

    expectStatus(await tarik(id, hrToken), 403);
    expectStatus(await tarik(id, budiToken), 403);
    expect(soketTerakhir!.permintaanRiwayat).toHaveLength(0);
  });

  it('menolak kalau belum ada satu pun pesan sebagai titik awal', async () => {
    const id = await siapkan();

    const res = await tarik(id, superToken);
    expectStatus(res, 409);
    expect(res.body.kode).toBe('tanpa_titik_awal');
  });

  it('menolak kalau sesinya tidak tersambung', async () => {
    const id = await buatAkun();

    const res = await tarik(id, superToken);
    expectStatus(res, 409);
    expect(res.body.kode).toBe('tidak_tersambung');
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

  it('ikut mengarsipkan pesan yang disusulkan ponsel', async () => {
    await siapkanTersambung();

    // type 'append' antara lain dipakai untuk pesan yang masuk saat sesi ini
    // sempat putus. Tanpa ini, arsipnya bolong persis selama waktu putusnya.
    soketTerakhir!.pancarkan('messages.upsert', { type: 'append', messages: [pesanBaileys()] });
    await tungguEventSelesai();

    expect(await prisma.whatsAppConversation.count()).toBe(1);
  });

  it('mengarsipkan pesan grup beserta nama grup dan pengirimnya', async () => {
    await siapkanTersambung();

    soketTerakhir!.pancarkan('messages.upsert', {
      type: 'notify',
      messages: [
        pesanBaileys({
          key: {
            remoteJid: '12036301234567890@g.us',
            fromMe: false,
            id: 'G-1',
            participant: '628333333333@s.whatsapp.net',
          },
          message: { conversation: 'Stok ayam habis' },
        }),
      ],
    });
    await tungguEventSelesai();

    const baris = await prisma.whatsAppConversation.findFirstOrThrow({ where: { externalMessageId: 'G-1' } });
    expect(baris.groupJid).toBe('12036301234567890@g.us');
    expect(baris.groupName).toBe('Tim Outlet Kemang');
    expect(baris.participantNumber).toBe('628333333333');
    // Grup diperlakukan sebagai satu lawan bicara, supaya utasnya utuh.
    expect(baris.contactNumber).toBe('12036301234567890');
    expect(decryptField(baris.messageBody)).toBe('Stok ayam habis');
  });

  it('mengunduh berkas media dan mencatat lokasinya', async () => {
    await siapkanTersambung();
    soketTerakhir!.isiMedia = Buffer.from('ini-isi-foto');

    soketTerakhir!.pancarkan('messages.upsert', {
      type: 'notify',
      messages: [
        pesanBaileys({
          key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: false, id: 'M-1' },
          message: { imageMessage: { caption: 'struk', mimetype: 'image/jpeg' } },
        }),
      ],
    });
    await tungguEventSelesai();

    const baris = await prisma.whatsAppConversation.findFirstOrThrow({ where: { externalMessageId: 'M-1' } });
    expect(baris.mediaStatus).toBe('tersimpan');
    expect(baris.mediaPath).toMatch(/^whatsapp\/.+\.jpg$/);
    expect(baris.mediaSizeBytes).toBe(12);
    expect(soketTerakhir!.mediaDiminta).toBe(1);
  });

  it('pesan tetap tersimpan walau berkasnya gagal diunduh', async () => {
    await siapkanTersambung();
    soketTerakhir!.isiMedia = null; // kunci media sudah kedaluwarsa

    soketTerakhir!.pancarkan('messages.upsert', {
      type: 'notify',
      messages: [
        pesanBaileys({
          key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: false, id: 'M-2' },
          message: { pttMessage: { mimetype: 'audio/ogg' } },
        }),
      ],
    });
    await tungguEventSelesai();

    const baris = await prisma.whatsAppConversation.findFirstOrThrow({ where: { externalMessageId: 'M-2' } });
    // Kehilangan berkas tidak boleh ikut menghilangkan jejak bahwa pesan
    // suara itu pernah ada.
    expect(baris.mediaStatus).toBe('gagal');
    expect(baris.mediaPath).toBeNull();
    expect(baris.messageType).toBe('audio');
  });

  it('melewati berkas yang melebihi batas ukuran, pesannya tetap dicatat', async () => {
    await siapkanTersambung();
    const batasAsli = env.WHATSAPP_MEDIA_MAX_BYTES;
    (env as { WHATSAPP_MEDIA_MAX_BYTES: number }).WHATSAPP_MEDIA_MAX_BYTES = 5;
    soketTerakhir!.isiMedia = Buffer.alloc(64);

    try {
      soketTerakhir!.pancarkan('messages.upsert', {
        type: 'notify',
        messages: [
          pesanBaileys({
            key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: false, id: 'M-3' },
            message: { videoMessage: { mimetype: 'video/mp4' } },
          }),
        ],
      });
      await tungguEventSelesai();
    } finally {
      (env as { WHATSAPP_MEDIA_MAX_BYTES: number }).WHATSAPP_MEDIA_MAX_BYTES = batasAsli;
    }

    const baris = await prisma.whatsAppConversation.findFirstOrThrow({ where: { externalMessageId: 'M-3' } });
    expect(baris.mediaStatus).toBe('terlalu_besar');
    expect(baris.mediaSizeBytes).toBe(64);
    expect(baris.mediaPath).toBeNull();
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
