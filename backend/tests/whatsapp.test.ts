import { createHmac } from 'crypto';
import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma, resetDatabase, makeEmployee } from './helpers/db';
import { login, auth, expectStatus } from './helpers/api';
import { env } from '../src/config/env';

const app = createApp();

const NOMOR_PERUSAHAAN = '08111111111';
const NOMOR_PELANGGAN = '08222222222';
const NOMOR_PRIBADI_A = '08333333333';
const NOMOR_PRIBADI_B = '08444444444';

let hrToken: string;
let budi: { id: string };
let budiToken: string;

/** Mengirim webhook dengan tanda tangan HMAC yang sah. */
const kirimWebhook = (payload: unknown, opsi: { signature?: string } = {}) => {
  const body = JSON.stringify(payload);
  const tanda =
    opsi.signature ??
    createHmac('sha256', env.BELLYS_WEBHOOK_SECRET!).update(body).digest('hex');

  return request(app)
    .post('/api/webhook/bellys')
    .set('Content-Type', 'application/json')
    .set('x-bellys-signature', tanda)
    .send(body);
};

const pesan = (ubah: Record<string, unknown> = {}) => ({
  event: 'message',
  messageId: `msg-${Math.random().toString(36).slice(2)}`,
  from: NOMOR_PELANGGAN,
  to: NOMOR_PERUSAHAAN,
  body: 'Halo, mau reservasi meja untuk 4 orang',
  type: 'text',
  timestamp: '2026-09-15T10:00:00.000Z',
  ...ubah,
});

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
  budiToken = await login(app, 'budi@resto.id');
});


const daftarkanNomor = (ubah: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/whatsapp/accounts')
    .set(auth(hrToken))
    .send({
      phoneNumber: NOMOR_PERUSAHAAN,
      label: 'CS Outlet Kemang',
      assignedEmployeeId: budi.id,
      ...ubah,
    });

describe('Pendaftaran nomor perusahaan', () => {
  it('membakukan nomor saat disimpan', async () => {
    const res = await daftarkanNomor({ phoneNumber: '+62 811-111-1111' });

    expect(res.status).toBe(201);
    // Apa pun cara HR menuliskannya, tersimpan dalam satu bentuk.
    expect(res.body.phoneNumber).toBe('628111111111');
  });

  it('menolak nomor ganda walau ditulis berbeda', async () => {
    await daftarkanNomor({ phoneNumber: '08111111111' });
    const res = await daftarkanNomor({ phoneNumber: '+628111111111' });

    expect(res.status).toBe(409);
  });

  it('menolak nomor yang tidak valid', async () => {
    const res = await daftarkanNomor({ phoneNumber: '12345678' });
    expect(res.status).toBe(400);
  });

  it('karyawan biasa tidak boleh mendaftarkan nomor', async () => {
    const res = await request(app)
      .post('/api/whatsapp/accounts')
      .set(auth(budiToken))
      .send({ phoneNumber: NOMOR_PERUSAHAAN, label: 'X' });

    expect(res.status).toBe(403);
  });
});

describe('Keamanan webhook', () => {
  it('menolak kiriman tanpa tanda tangan', async () => {
    const res = await request(app).post('/api/webhook/bellys').send(pesan());
    expect(res.status).toBe(401);
  });

  it('menolak tanda tangan yang salah', async () => {
    const res = await kirimWebhook(pesan(), { signature: 'a'.repeat(64) });
    expect(res.status).toBe(401);
  });

  it('menolak bila isi diubah setelah ditandatangani', async () => {
    const asli = pesan();
    const tanda = createHmac('sha256', env.BELLYS_WEBHOOK_SECRET!)
      .update(JSON.stringify(asli))
      .digest('hex');

    // Tanpa ini, siapa pun yang tahu alamat webhook bisa menyisipkan
    // percakapan palsu ke arsip yang dipakai audit.
    const res = await request(app)
      .post('/api/webhook/bellys')
      .set('Content-Type', 'application/json')
      .set('x-bellys-signature', tanda)
      .send(JSON.stringify({ ...asli, body: 'isi dipalsukan' }));

    expect(res.status).toBe(401);
  });

  it('webhook tidak memerlukan token JWT', async () => {
    await daftarkanNomor();
    // Dipanggil mesin, bukan pengguna.
    const res = await kirimWebhook(pesan());
    expect(res.status).toBe(201);
  });
});

describe('Ruang lingkup: hanya nomor perusahaan', () => {
  it('mengarsipkan pesan masuk ke nomor perusahaan', async () => {
    await daftarkanNomor();
    const res = await kirimWebhook(pesan());

    expect(res.status).toBe(201);
    expect(res.body.accepted).toBe(true);
    expect(res.body.direction).toBe('incoming');
  });

  it('mengarsipkan pesan keluar dari nomor perusahaan', async () => {
    await daftarkanNomor();
    const res = await kirimWebhook(
      pesan({ from: NOMOR_PERUSAHAAN, to: NOMOR_PELANGGAN, body: 'Baik, meja tersedia' })
    );

    expect(res.body.direction).toBe('outgoing');
  });

  it('MENOLAK percakapan antar dua nomor pribadi', async () => {
    await daftarkanNomor();

    const res = await kirimWebhook(pesan({ from: NOMOR_PRIBADI_A, to: NOMOR_PRIBADI_B }));

    // Inilah batasan yang membedakan pemantauan kanal kerja dari
    // pengarsipan komunikasi pribadi karyawan.
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(false);
    expect(res.body.reason).toBe('not_company_number');
    expect(await prisma.whatsAppConversation.count()).toBe(0);
  });

  it('menolak pesan ke nomor yang belum terdaftar', async () => {
    // Belum ada nomor perusahaan sama sekali.
    const res = await kirimWebhook(pesan());

    expect(res.status).toBe(202);
    expect(await prisma.whatsAppConversation.count()).toBe(0);
  });

  it('berhenti mengarsipkan setelah nomor dinonaktifkan', async () => {
    const akun = await daftarkanNomor();
    await request(app)
      .put(`/api/whatsapp/accounts/${akun.body.id}`)
      .set(auth(hrToken))
      .send({ isActive: false });

    const res = await kirimWebhook(pesan());

    expect(res.status).toBe(202);
    expect(await prisma.whatsAppConversation.count()).toBe(0);
  });

  it('mencocokkan daftar walau bentuk penulisan nomornya berbeda', async () => {
    await daftarkanNomor({ phoneNumber: '+628111111111' });

    // Belly's mengirim dalam bentuk 08...
    const res = await kirimWebhook(pesan({ to: '08111111111' }));
    expect(res.status).toBe(201);
  });
});

describe('Pengiriman ulang webhook', () => {
  it('tidak menggandakan arsip pada kiriman ulang', async () => {
    await daftarkanNomor();
    const payload = pesan();

    const pertama = await kirimWebhook(payload);
    const kedua = await kirimWebhook(payload);

    expect(pertama.status).toBe(201);
    // Menjawab error justru memicu percobaan ulang tanpa henti.
    expect(kedua.status).toBe(200);
    expect(kedua.body.duplicate).toBe(true);
    expect(kedua.body.conversationId).toBe(pertama.body.conversationId);

    expect(await prisma.whatsAppConversation.count()).toBe(1);
  });
});

describe('Arsip percakapan', () => {
  const isiArsip = async () => {
    await daftarkanNomor();
    await kirimWebhook(pesan({ body: 'Mau reservasi meja', messageId: 'm1' }));
    await kirimWebhook(
      pesan({ from: NOMOR_PERUSAHAAN, to: NOMOR_PELANGGAN, body: 'Meja tersedia', messageId: 'm2' })
    );
    await kirimWebhook(
      pesan({ from: '08555555555', body: 'Keluhan: pesanan lama', messageId: 'm3' })
    );
  };

  it('menyalin pemegang nomor ke arsip', async () => {
    await daftarkanNomor();
    await kirimWebhook(pesan());

    const res = await request(app)
      .get('/api/whatsapp/conversations')
      .set(auth(hrToken));

    // Nomor bisa berpindah tangan; arsip lama harus tetap menunjuk
    // pemegang yang benar saat itu.
    expect(res.body.data[0].employeeId).toBe(budi.id);
  });

  it('mencari isi pesan untuk pelacakan isu', async () => {
    await isiArsip();

    const res = await request(app)
      .get('/api/whatsapp/conversations?search=keluhan')
      .set(auth(hrToken));

    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].messageBody).toContain('Keluhan');
  });

  it('menyaring per kontak, apa pun bentuk penulisan nomornya', async () => {
    await isiArsip();

    const res = await request(app)
      .get(`/api/whatsapp/conversations?contactNumber=%2B62822-2222-222`)
      .set(auth(hrToken));

    expect(res.body.pagination.total).toBe(2);
  });

  it('menyaring per arah pesan', async () => {
    await isiArsip();

    const masuk = await request(app)
      .get('/api/whatsapp/conversations?direction=incoming')
      .set(auth(hrToken));
    expect(masuk.body.pagination.total).toBe(2);

    const keluar = await request(app)
      .get('/api/whatsapp/conversations?direction=outgoing')
      .set(auth(hrToken));
    expect(keluar.body.pagination.total).toBe(1);
  });

  it('karyawan biasa tidak boleh membuka arsip percakapan', async () => {
    await isiArsip();

    // Arsip memuat data pribadi pelanggan yang tidak pernah menjadi
    // bagian dari perusahaan.
    const res = await request(app)
      .get('/api/whatsapp/conversations')
      .set(auth(budiToken));

    expect(res.status).toBe(403);
  });
});

describe('Sesi Belly\'s dan pemberitahuan', () => {
  it('mencatat sesi terputus dan memperbarui status nomor', async () => {
    const akun = await daftarkanNomor();

    const res = await kirimWebhook({
      event: 'session',
      phoneNumber: NOMOR_PERUSAHAAN,
      status: 'disconnected',
      timestamp: '2026-09-15T12:00:00.000Z',
      note: 'Sesi WhatsApp Web berakhir',
    });

    expect(res.status).toBe(200);

    const tersimpan = await prisma.whatsAppAccount.findUniqueOrThrow({
      where: { id: akun.body.id },
    });
    expect(tersimpan.sessionStatus).toBe('disconnected');
    expect(tersimpan.lastDisconnectedAt).not.toBeNull();
  });

  it('menandai perlu scan ulang', async () => {
    const akun = await daftarkanNomor();

    await kirimWebhook({
      event: 'session',
      phoneNumber: NOMOR_PERUSAHAAN,
      status: 'scan_required',
    });

    const tersimpan = await prisma.whatsAppAccount.findUniqueOrThrow({
      where: { id: akun.body.id },
    });
    expect(tersimpan.sessionStatus).toBe('pending_scan');
  });

  it('pemegang nomor melihat kejadian sesinya sendiri', async () => {
    await daftarkanNomor();
    await kirimWebhook({
      event: 'session',
      phoneNumber: NOMOR_PERUSAHAAN,
      status: 'disconnected',
    });

    const res = await request(app)
      .get('/api/whatsapp/session-events')
      .set(auth(budiToken));

    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].eventType).toBe('disconnected');
  });

  it('karyawan lain tidak melihat kejadian nomor yang bukan pegangannya', async () => {
    await daftarkanNomor();
    await kirimWebhook({
      event: 'session',
      phoneNumber: NOMOR_PERUSAHAAN,
      status: 'disconnected',
    });

    await makeEmployee({ email: 'lain@resto.id', nik: 'EMP-9' });
    const lainToken = await login(app, 'lain@resto.id');

    const res = await request(app).get('/api/whatsapp/session-events').set(auth(lainToken));
    expect(res.body.pagination.total).toBe(0);
  });

  it('menandai kejadian sudah diberitahukan agar tidak dikirim ulang', async () => {
    await daftarkanNomor();
    await kirimWebhook({
      event: 'session',
      phoneNumber: NOMOR_PERUSAHAAN,
      status: 'disconnected',
    });

    const belum = await request(app)
      .get('/api/whatsapp/session-events?unnotifiedOnly=true')
      .set(auth(hrToken));
    expect(belum.body.pagination.total).toBe(1);

    await request(app)
      .post('/api/whatsapp/session-events/notified')
      .set(auth(hrToken))
      .send({ eventIds: [belum.body.data[0].id] });

    const sesudah = await request(app)
      .get('/api/whatsapp/session-events?unnotifiedOnly=true')
      .set(auth(hrToken));
    expect(sesudah.body.pagination.total).toBe(0);
  });

  it('menolak kejadian sesi untuk nomor yang tidak terdaftar', async () => {
    const res = await kirimWebhook({
      event: 'session',
      phoneNumber: NOMOR_PRIBADI_A,
      status: 'disconnected',
    });

    expect(res.status).toBe(404);
    expect(res.body.reason).toBe('not_company_number');
  });
});
