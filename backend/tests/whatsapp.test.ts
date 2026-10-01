import { createHmac } from 'crypto';
import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makeDepartment, tungguJejakAudit } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth, expectStatus } from './helpers/api';
import { env } from '../src/config/env';
import fs from 'fs/promises';
import path from 'path';
import { generateULID } from '../src/utils/generateULID';
import { encryptField, buildSearchTokens } from '../src/utils/fieldCrypto';
import { tungguAuditSelesai } from '../src/services/audit/record';

const app = bikinApp();

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
    // Tiap langkah penyiapan diperiksa: kalau webhook-nya gagal, kegagalan
    // harus terlihat di sini, bukan muncul kemudian sebagai "hasil pencarian
    // kosong" yang menunjuk ke tempat yang salah.
    expectStatus(await daftarkanNomor(), 201);
    expectStatus(await kirimWebhook(pesan({ body: 'Mau reservasi meja', messageId: 'm1' })), 201);
    expectStatus(
      await kirimWebhook(
        pesan({ from: NOMOR_PERUSAHAAN, to: NOMOR_PELANGGAN, body: 'Meja tersedia', messageId: 'm2' })
      ),
      201
    );
    expectStatus(
      await kirimWebhook(pesan({ from: '08555555555', body: 'Keluhan: pesanan lama', messageId: 'm3' })),
      201
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

describe('Isi penuh untuk Super Admin', () => {
  let superToken: string;
  let accountId: string;

  /** Baris arsip dibuat langsung: jalur webhook tidak mengenal grup dan media. */
  const buatPesan = async (data: Record<string, unknown>) => {
    const baris = await prisma.whatsAppConversation.create({
      data: {
        id: generateULID(),
        accountId,
        externalMessageId: `x-${Math.random().toString(36).slice(2)}`,
        senderWhatsappNumber: '628333333333',
        receiverWhatsappNumber: '628111111111',
        contactNumber: '628333333333',
        messageBody: encryptField('Stok ayam habis'),
        searchTokens: [],
        messageType: 'text',
        timestamp: new Date('2026-09-20T10:00:00.000Z'),
        direction: 'incoming',
        ...data,
      },
      select: { id: true },
    });
    return baris.id;
  };

  beforeEach(async () => {
    await makeEmployee({ email: 'super@resto.id', nik: 'SA-1', role: Role.SUPER_ADMIN });
    superToken = await login(app, 'super@resto.id');
    expectStatus(await daftarkanNomor(), 201);
    accountId = (await prisma.whatsAppAccount.findFirstOrThrow({ select: { id: true } })).id;
  });

  it('Super Admin melihat pesan grup, HR tidak', async () => {
    await buatPesan({
      groupJid: '12036301234567890@g.us',
      groupName: 'Tim Outlet Kemang',
      participantNumber: '628333333333',
      contactNumber: '12036301234567890',
    });

    const punyaSuper = await request(app).get('/api/whatsapp/conversations').set(auth(superToken));
    expectStatus(punyaSuper, 200);
    expect(punyaSuper.body.data).toHaveLength(1);
    expect(punyaSuper.body.data[0]).toMatchObject({ groupName: 'Tim Outlet Kemang', participantNumber: '628333333333' });

    // Grup memuat pesan orang yang tidak memegang nomor perusahaan sama
    // sekali, jadi tidak ikut terbuka hanya karena punya izin arsip.
    const punyaHr = await request(app).get('/api/whatsapp/conversations').set(auth(hrToken));
    expectStatus(punyaHr, 200);
    expect(punyaHr.body.data).toHaveLength(0);
  });

  it('Super Admin mengunduh berkas media, HR ditolak', async () => {
    const berkas = path.join(env.UPLOAD_DIR, 'whatsapp', accountId, 'uji.jpg');
    await fs.mkdir(path.dirname(berkas), { recursive: true });
    await fs.writeFile(berkas, Buffer.from('isi-foto'));

    const id = await buatPesan({
      messageType: 'image',
      mediaPath: path.posix.join('whatsapp', accountId, 'uji.jpg'),
      mediaMimeType: 'image/jpeg',
      mediaSizeBytes: 8,
      mediaStatus: 'tersimpan',
    });

    const unduh = await request(app).get(`/api/whatsapp/conversations/${id}/media`).set(auth(superToken));
    expectStatus(unduh, 200);
    expect(unduh.headers['content-type']).toContain('image/jpeg');
    expect(unduh.body.toString()).toBe('isi-foto');

    expectStatus(await request(app).get(`/api/whatsapp/conversations/${id}/media`).set(auth(hrToken)), 403);
    expectStatus(await request(app).get(`/api/whatsapp/conversations/${id}/media`).set(auth(budiToken)), 403);
  });

  it('menyebut alasannya kalau berkasnya memang tidak tersimpan', async () => {
    const id = await buatPesan({ messageType: 'video', mediaStatus: 'terlalu_besar', mediaSizeBytes: 90_000_000 });

    const res = await request(app).get(`/api/whatsapp/conversations/${id}/media`).set(auth(superToken));
    expectStatus(res, 404);
    expect(res.body.mediaStatus).toBe('terlalu_besar');
    expect(res.body.error).toMatch(/batas ukuran/i);
  });

  it('daftar arsip tidak pernah membocorkan lokasi berkas di server', async () => {
    await buatPesan({
      messageType: 'audio',
      mediaPath: 'whatsapp/rahasia/berkas.ogg',
      mediaMimeType: 'audio/ogg',
      mediaStatus: 'tersimpan',
    });

    const res = await request(app).get('/api/whatsapp/conversations').set(auth(superToken));
    expectStatus(res, 200);
    expect(res.body.data[0].mediaTersedia).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('whatsapp/rahasia');
  });
});

describe('Utas percakapan dan ringkasan', () => {
  const kirim = (ubah: Record<string, unknown>) => kirimWebhook(pesan(ubah));

  beforeEach(async () => {
    expectStatus(await daftarkanNomor(), 201);
  });

  it('mengelompokkan pesan per lawan bicara, yang terbaru di atas', async () => {
    expectStatus(await kirim({ messageId: 'a1', body: 'Mau reservasi', timestamp: '2026-09-20T10:00:00.000Z' }), 201);
    expectStatus(await kirim({ messageId: 'a2', from: NOMOR_PERUSAHAAN, to: NOMOR_PELANGGAN, body: 'Siap, jam berapa?', timestamp: '2026-09-20T10:01:00.000Z' }), 201);
    expectStatus(await kirim({ messageId: 'b1', from: '08555555555', body: 'Keluhan pesanan', timestamp: '2026-09-21T08:00:00.000Z' }), 201);

    const res = await request(app).get('/api/whatsapp/threads').set(auth(hrToken));
    expectStatus(res, 200);
    expect(res.body.pagination.total).toBe(2);
    // Utas yang terakhir bergerak lebih dulu.
    expect(res.body.data[0].contactNumber).toBe('628555555555');
    const pelanggan = res.body.data[1];
    expect(pelanggan).toMatchObject({ contactNumber: '628222222222', jumlahPesan: 2 });
    expect(pelanggan.pesanTerakhir).toMatchObject({ cuplikan: 'Siap, jam berapa?', direction: 'outgoing' });
  });

  it('satu kotak pencarian: angka mencari nomor, kata mencari isi', async () => {
    expectStatus(await kirim({ messageId: 'c1', body: 'Mau reservasi meja' }), 201);
    expectStatus(await kirim({ messageId: 'c2', from: '08555555555', body: 'Keluhan: pesanan lama' }), 201);

    // Ditulis seperti orang menulis nomor, bukan seperti yang tersimpan.
    const nomor = await request(app).get('/api/whatsapp/threads?q=0855 5555 555').set(auth(hrToken));
    expect(nomor.body.data.map((u: { contactNumber: string }) => u.contactNumber)).toEqual(['628555555555']);

    const kata = await request(app).get('/api/whatsapp/threads?q=keluhan').set(auth(hrToken));
    expect(kata.body.data.map((u: { contactNumber: string }) => u.contactNumber)).toEqual(['628555555555']);

    // Tanda baca saja tidak boleh berubah menjadi "tampilkan semua".
    const kosong = await request(app).get('/api/whatsapp/threads?q=%3F%3F').set(auth(hrToken));
    expect(kosong.body.data).toHaveLength(0);
  });

  it('utas grup hanya muncul untuk Super Admin', async () => {
    await makeEmployee({ email: 'super@resto.id', nik: 'SA-1', role: Role.SUPER_ADMIN });
    const superToken = await login(app, 'super@resto.id');
    const akun = await prisma.whatsAppAccount.findFirstOrThrow({ select: { id: true } });
    await prisma.whatsAppConversation.create({
      data: {
        id: generateULID(),
        accountId: akun.id,
        externalMessageId: 'g-1',
        senderWhatsappNumber: '628333333333',
        receiverWhatsappNumber: '12036301234567890',
        contactNumber: '12036301234567890',
        messageBody: encryptField('Stok habis'),
        searchTokens: [],
        messageType: 'text',
        timestamp: new Date(),
        direction: 'incoming',
        groupJid: '12036301234567890@g.us',
        groupName: 'Tim Dapur',
      },
    });

    const hr = await request(app).get('/api/whatsapp/threads').set(auth(hrToken));
    expect(hr.body.data).toHaveLength(0);
    const sa = await request(app).get('/api/whatsapp/threads').set(auth(superToken));
    expect(sa.body.data[0]).toMatchObject({ groupName: 'Tim Dapur', groupJid: '12036301234567890@g.us' });
  });

  it('ringkasan menghitung pesan hari ini dan waktu pesan terakhir', async () => {
    const sekarang = new Date().toISOString();
    expectStatus(await kirim({ messageId: 'd1', timestamp: '2026-01-01T10:00:00.000Z' }), 201);
    expectStatus(await kirim({ messageId: 'd2', timestamp: sekarang }), 201);

    const res = await request(app).get('/api/whatsapp/ringkasan').set(auth(hrToken));
    expectStatus(res, 200);
    expect(res.body).toMatchObject({ pesanHariIni: 1, totalPesan: 2 });
    expect(new Date(res.body.pesanTerakhir).toISOString()).toBe(sekarang);
  });

  it('karyawan biasa tidak boleh membuka utas maupun ringkasan', async () => {
    expectStatus(await request(app).get('/api/whatsapp/threads').set(auth(budiToken)), 403);
    expectStatus(await request(app).get('/api/whatsapp/ringkasan').set(auth(budiToken)), 403);
  });
});

describe('Pemantauan per nomor: pilih nomor, lalu chat-nya', () => {
  const GRUP = '12036301234567890@g.us';
  const LID_MISTERIUS = '214751418265748';
  const NOMOR_SARI = '628222222222';
  const NOMOR_ANDI = '628333333333';

  let superToken: string;
  let akunA: string;
  let akunB: string;
  let andi: { id: string };

  const buat = (accountId: string, isi: string, data: Record<string, unknown>) =>
    prisma.whatsAppConversation.create({
      data: {
        id: generateULID(),
        accountId,
        externalMessageId: `x-${generateULID()}`,
        senderWhatsappNumber: NOMOR_SARI,
        receiverWhatsappNumber: '628111111111',
        contactNumber: NOMOR_SARI,
        messageBody: encryptField(isi),
        searchTokens: buildSearchTokens(isi),
        messageType: 'text',
        direction: 'incoming',
        timestamp: new Date('2026-09-20T10:00:00.000Z'),
        ...data,
      },
    });

  beforeEach(async () => {
    await makeEmployee({ email: 'super@resto.id', nik: 'SA-1', role: Role.SUPER_ADMIN });
    superToken = await login(app, 'super@resto.id');
    const dapur = await makeDepartment('Dapur');
    await prisma.employee.update({ where: { id: budi.id }, data: { departmentId: dapur.id, name: 'Budi Kasir' } });
    // Tanpa kata sandi: tidak perlu login, dan hash bcrypt-nya mahal.
    andi = await makeEmployee({ email: 'andi@resto.id', nik: 'EMP-9', name: 'Andi Saputra', phoneNumber: NOMOR_ANDI, password: null });
    const siti = await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2', name: 'Siti Waiter', password: null });

    expectStatus(await daftarkanNomor(), 201);
    akunA = (await prisma.whatsAppAccount.findFirstOrThrow({ select: { id: true } })).id;
    akunB = (
      await prisma.whatsAppAccount.create({
        data: { id: generateULID(), kind: 'personal', label: 'Siti Waiter', phoneNumber: '628444444444', assignedEmployeeId: siti.id },
      })
    ).id;
    // Nomor pribadi yang belum pernah tertaut: tidak ada apa pun untuk dibuka.
    await prisma.whatsAppAccount.create({ data: { id: generateULID(), kind: 'personal', label: 'Belum Tertaut', phoneNumber: null } });

    // Akun A: Andi (karyawan), Sari (tersimpan di kontak), LID tak dikenal, satu grup.
    await buat(akunA, 'Shift besok jam berapa?', {
      contactNumber: NOMOR_ANDI,
      senderWhatsappNumber: NOMOR_ANDI,
      timestamp: new Date('2026-09-19T08:00:00.000Z'),
    });
    await buat(akunA, 'Mau pesan katering 50 porsi', { senderName: 'Sari' });
    await buat(akunA, 'Baik bu, kami siapkan', {
      direction: 'outgoing',
      senderWhatsappNumber: '628111111111',
      receiverWhatsappNumber: NOMOR_SARI,
      employeeId: budi.id,
      timestamp: new Date('2026-09-20T10:05:00.000Z'),
    });
    await buat(akunA, 'Halo, ini siapa ya', {
      contactNumber: LID_MISTERIUS,
      contactLid: LID_MISTERIUS,
      senderWhatsappNumber: LID_MISTERIUS,
      senderName: 'Pelanggan Misterius',
      timestamp: new Date('2026-09-21T08:00:00.000Z'),
    });
    const grup = { groupJid: GRUP, contactNumber: '12036301234567890', receiverWhatsappNumber: '12036301234567890' };
    await buat(akunA, 'Stok ayam habis', {
      ...grup,
      groupName: 'Tim Dapur',
      participantNumber: NOMOR_ANDI,
      participantLid: '88014471852141',
      senderWhatsappNumber: NOMOR_ANDI,
      senderName: 'Andi',
      timestamp: new Date('2026-09-22T09:00:00.000Z'),
    });
    await buat(akunA, 'Siap', { ...grup, senderWhatsappNumber: '12036301234567890', timestamp: new Date('2026-09-22T09:05:00.000Z') });
    await prisma.whatsAppContact.create({
      data: { id: generateULID(), accountId: akunA, number: NOMOR_SARI, savedName: 'Bu Sari Catering', pushName: 'Sari' },
    });

    // Akun B: satu pesan hari ini.
    await buat(akunB, 'Izin telat 10 menit', {
      contactNumber: '628555555555',
      senderWhatsappNumber: '628555555555',
      receiverWhatsappNumber: '628444444444',
      timestamp: new Date(),
    });
  });

  describe('GET /whatsapp/nomor', () => {
    it('merangkum tiap nomor yang dipantau, pesan terakhir paling baru di atas', async () => {
      const res = await request(app).get('/api/whatsapp/nomor').set(auth(superToken));
      expectStatus(res, 200);

      expect(res.body.data.map((n: { id: string }) => n.id)).toEqual([akunB, akunA]);
      const a = res.body.data[1];
      expect(a).toMatchObject({
        label: 'CS Outlet Kemang',
        kind: 'company',
        phoneNumber: '628111111111',
        status: 'never_linked',
        employee: { id: budi.id, department: { name: 'Dapur' } },
        jumlah: { chatPribadi: 3, grup: 1, pesan: 6, pesanHariIni: 0 },
        pesanTerakhir: { cuplikan: 'Siap', keluar: false },
      });
      expect(res.body.data[0]).toMatchObject({ kind: 'personal', jumlah: { chatPribadi: 1, grup: 0, pesan: 1, pesanHariIni: 1 } });
    });

    it('baris grup tidak ikut terhitung untuk selain Super Admin', async () => {
      const res = await request(app).get('/api/whatsapp/nomor').set(auth(hrToken));
      expectStatus(res, 200);

      const a = res.body.data.find((n: { id: string }) => n.id === akunA);
      expect(a.jumlah).toEqual({ chatPribadi: 3, grup: 0, pesan: 4, pesanHariIni: 0 });
      expect(a.pesanTerakhir).toMatchObject({ cuplikan: 'Halo, ini siapa ya' });
    });

    it('penyegaran latar (pantau=1) tidak dicatat di jejak audit', async () => {
      expectStatus(await request(app).get('/api/whatsapp/nomor?pantau=1').set(auth(hrToken)), 200);
      expectStatus(await request(app).get('/api/whatsapp/nomor').set(auth(hrToken)), 200);

      expect(await tungguJejakAudit({ action: 'whatsapp.nomor.read' })).not.toBeNull();
      await tungguAuditSelesai();
      expect(await prisma.auditLog.count({ where: { action: 'whatsapp.nomor.read' } })).toBe(1);
    });

    it('karyawan biasa tidak boleh membukanya', async () => {
      expectStatus(await request(app).get('/api/whatsapp/nomor').set(auth(budiToken)), 403);
    });
  });

  describe('GET /whatsapp/threads per nomor', () => {
    const utas = (query: string, token = superToken) =>
      request(app).get(`/api/whatsapp/threads?accountId=${akunA}${query}`).set(auth(token));

    it('memberi nama kontak, nomor asli atau LID, karyawan, dan jumlah per jenis', async () => {
      const res = await utas('');
      expectStatus(res, 200);

      expect(res.body.jumlah).toEqual({ semua: 4, pribadi: 3, grup: 1 });
      expect(res.body.pagination).toMatchObject({ total: 4, totalPages: 1 });
      const [grup, misterius, sari, karyawan] = res.body.data;

      expect(grup).toMatchObject({
        jenis: 'grup',
        groupJid: GRUP,
        kontak: null,
        // Pesan terakhir grup tanpa nama; nama diambil dari pesan terakhir yang mencatatnya.
        grup: { jid: GRUP, nama: 'Tim Dapur' },
        jumlahPesan: 2,
        account: { id: akunA, label: 'CS Outlet Kemang', phoneNumber: '628111111111' },
      });
      expect(grup.pesanTerakhir).toMatchObject({ cuplikan: 'Siap', keluar: false, pengirim: null });

      // LID bukan nomor: tidak boleh pernah muncul sebagai nomor.
      expect(misterius).toMatchObject({
        jenis: 'pribadi',
        kontak: { nama: 'Pelanggan Misterius', nomor: null, lid: LID_MISTERIUS, karyawan: null },
        grup: null,
      });

      expect(sari).toMatchObject({
        contactNumber: NOMOR_SARI,
        kontak: { nama: 'Bu Sari Catering', nomor: NOMOR_SARI, lid: null, karyawan: null },
        jumlahPesan: 2,
      });
      expect(sari.pesanTerakhir).toMatchObject({
        cuplikan: 'Baik bu, kami siapkan',
        keluar: true,
        messageType: 'text',
        pengirim: { nama: 'Budi Kasir', nomor: '628111111111' },
      });

      expect(karyawan.kontak).toMatchObject({ nomor: NOMOR_ANDI, karyawan: { id: andi.id, name: 'Andi Saputra' } });
    });

    it('menyaring per jenis dan memaginasi di database', async () => {
      const pribadi = await utas('&jenis=pribadi');
      expect(pribadi.body.data.map((u: { jenis: string }) => u.jenis)).toEqual(['pribadi', 'pribadi', 'pribadi']);
      expect(pribadi.body.pagination.total).toBe(3);
      expect(pribadi.body.jumlah).toEqual({ semua: 4, pribadi: 3, grup: 1 });

      const grup = await utas('&jenis=grup');
      expect(grup.body.data.map((u: { groupJid: string }) => u.groupJid)).toEqual([GRUP]);

      const hal2 = await utas('&limit=1&page=2');
      expect(hal2.body.data).toHaveLength(1);
      expect(hal2.body.data[0].kontak.lid).toBe(LID_MISTERIUS);
      expect(hal2.body.pagination).toMatchObject({ page: 2, limit: 1, total: 4, totalPages: 4 });

      // Halaman di luar jangkauan tetap membawa angka per jenis.
      const kosong = await utas('&limit=10&page=9');
      expect(kosong.body.data).toEqual([]);
      expect(kosong.body.jumlah).toEqual({ semua: 4, pribadi: 3, grup: 1 });
    });

    it('mencari nama kontak, nama grup, nama karyawan, nomor, dan isi pesan', async () => {
      const cari = async (q: string) =>
        (await utas(`&q=${encodeURIComponent(q)}`)).body.data.map((u: { contactNumber: string }) => u.contactNumber);

      expect(await cari('catering')).toEqual([NOMOR_SARI]); // nama di buku kontak
      expect(await cari('misterius')).toEqual([LID_MISTERIUS]); // nama profil pengirim
      expect(await cari('tim dapur')).toEqual(['12036301234567890']); // nama grup
      // Nama karyawan: chat dengannya dan grup tempat ia menulis.
      expect(await cari('andi saputra')).toEqual(['12036301234567890', NOMOR_ANDI]);
      expect(await cari('0822 2222 222')).toEqual([NOMOR_SARI]); // nomor seperti ditulis orang
      expect(await cari('katering')).toEqual([NOMOR_SARI]); // kata di isi pesan
      expect(await cari('%')).toEqual([]);
    });

    it('utas yang cocok tetap menampilkan pesan terakhir dan jumlah utuhnya', async () => {
      const res = await utas('&q=katering');
      expect(res.body.data[0]).toMatchObject({ jumlahPesan: 2, pesanTerakhir: { cuplikan: 'Baik bu, kami siapkan' } });
    });

    it('selain Super Admin tidak melihat grup sama sekali', async () => {
      const res = await utas('&jenis=grup', hrToken);
      expect(res.body.data).toEqual([]);
      expect(res.body.jumlah).toEqual({ semua: 3, pribadi: 3, grup: 0 });
    });

    it('penyegaran latar (pantau=1) tidak dicatat di jejak audit', async () => {
      expectStatus(await utas('&pantau=1'), 200);
      expectStatus(await utas(''), 200);

      expect(await tungguJejakAudit({ action: 'whatsapp.threads.read' })).not.toBeNull();
      await tungguAuditSelesai();
      expect(await prisma.auditLog.count({ where: { action: 'whatsapp.threads.read' } })).toBe(1);
    });
  });

  describe('GET /whatsapp/conversations menyebut pengirimnya', () => {
    it('grup: nama, nomor asli, LID, dan karyawan; yang tidak tercatat dibiarkan kosong', async () => {
      const res = await request(app)
        .get(`/api/whatsapp/conversations?accountId=${akunA}&groupJid=${encodeURIComponent(GRUP)}`)
        .set(auth(superToken));
      expectStatus(res, 200);

      const [siap, stok] = res.body.data;
      expect(siap.pengirim).toBeNull();
      expect(stok.pengirim).toEqual({
        nama: 'Andi',
        nomor: NOMOR_ANDI,
        lid: '88014471852141',
        karyawan: { id: andi.id, name: 'Andi Saputra' },
      });
    });

    it('pribadi: pesan keluar atas nama pemegang nomor, pesan masuk atas nama kontak', async () => {
      const res = await request(app)
        .get(`/api/whatsapp/conversations?accountId=${akunA}&contactNumber=${NOMOR_SARI}`)
        .set(auth(hrToken));
      expectStatus(res, 200);

      const [keluar, masuk] = res.body.data;
      expect(keluar.pengirim).toEqual({
        nama: 'Budi Kasir',
        nomor: '628111111111',
        lid: null,
        karyawan: { id: budi.id, name: 'Budi Kasir' },
      });
      expect(masuk.pengirim).toEqual({ nama: 'Bu Sari Catering', nomor: NOMOR_SARI, lid: null, karyawan: null });
    });

    it('selain Super Admin tidak bisa membuka grup lewat penyaring groupJid', async () => {
      const res = await request(app)
        .get(`/api/whatsapp/conversations?accountId=${akunA}&groupJid=${encodeURIComponent(GRUP)}`)
        .set(auth(hrToken));
      expectStatus(res, 200);
      expect(res.body.data).toEqual([]);
    });

    it('LID yang belum dikenal tidak pernah disebut sebagai nomor', async () => {
      const res = await request(app)
        .get(`/api/whatsapp/conversations?accountId=${akunA}&contactNumber=${LID_MISTERIUS}`)
        .set(auth(hrToken));
      expect(res.body.data[0].pengirim).toEqual({ nama: 'Pelanggan Misterius', nomor: null, lid: LID_MISTERIUS, karyawan: null });
    });

    it('penyegaran latar (pantau=1) tidak dicatat di jejak audit', async () => {
      const url = `/api/whatsapp/conversations?accountId=${akunA}&contactNumber=${NOMOR_SARI}`;
      expectStatus(await request(app).get(`${url}&pantau=1`).set(auth(hrToken)), 200);
      expectStatus(await request(app).get(url).set(auth(hrToken)), 200);

      expect(await tungguJejakAudit({ action: 'whatsapp.conversations.read' })).not.toBeNull();
      await tungguAuditSelesai();
      expect(await prisma.auditLog.count({ where: { action: 'whatsapp.conversations.read' } })).toBe(1);
    });
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

describe('Enkripsi isi pesan di database', () => {
  const siapkan = async () => {
    expectStatus(await daftarkanNomor(), 201);
    expectStatus(
      await kirimWebhook(pesan({ body: 'Keluhan: pesanan lama sekali', messageId: 'enc-1' })),
      201
    );
  };

  it('tidak menyimpan isi pesan dalam bentuk terbuka', async () => {
    await siapkan();

    // Dibaca langsung dari database, melewati controller — ini yang akan
    // dilihat siapa pun yang punya akses ke dump database.
    const baris = await prisma.whatsAppConversation.findFirstOrThrow({
      where: { externalMessageId: 'enc-1' },
      select: { messageBody: true, searchTokens: true },
    });

    expect(baris.messageBody).not.toContain('Keluhan');
    expect(baris.messageBody).not.toContain('pesanan');
    expect(baris.messageBody).toMatch(/^v1\./);
    expect(baris.searchTokens.length).toBeGreaterThan(0);
    // Indeksnya pun tidak boleh memuat katanya.
    expect(baris.searchTokens.join(' ')).not.toContain('keluhan');
  });

  it('mengembalikan isi pesan yang terbaca lewat API', async () => {
    await siapkan();

    const res = await request(app).get('/api/whatsapp/conversations').set(auth(hrToken));

    expectStatus(res, 200);
    expect(res.body.data[0].messageBody).toBe('Keluhan: pesanan lama sekali');
    // Token pencarian tidak ada gunanya bagi pembaca dan hanya memperbesar
    // yang ikut bocor kalau responsnya bocor.
    expect(res.body.data[0].searchTokens).toBeUndefined();
  });

  it('tetap bisa mencari walau isinya terenkripsi', async () => {
    await siapkan();

    const res = await request(app)
      .get('/api/whatsapp/conversations?search=keluhan')
      .set(auth(hrToken));

    expectStatus(res, 200);
    expect(res.body.pagination.total).toBe(1);
  });

  it('mencari beberapa kata sebagai DAN, bukan ATAU', async () => {
    await siapkan();
    expectStatus(
      await kirimWebhook(pesan({ body: 'Pesanan sudah siap', messageId: 'enc-2' })),
      201
    );

    // "pesanan" ada di kedua pesan, "keluhan" hanya di satu.
    expectStatus(
      await request(app).get('/api/whatsapp/conversations?search=pesanan').set(auth(hrToken)),
      200
    );
    const satu = await request(app)
      .get('/api/whatsapp/conversations?search=keluhan%20pesanan')
      .set(auth(hrToken));

    expect(satu.body.pagination.total).toBe(1);
  });

  it('tidak menemukan potongan kata', async () => {
    await siapkan();

    // Harga yang dibayar untuk enkripsi: pencarian menjadi per kata utuh.
    // Diuji supaya perubahan perilaku ini tercatat, bukan mengagetkan.
    const res = await request(app)
      .get('/api/whatsapp/conversations?search=keluh')
      .set(auth(hrToken));

    expectStatus(res, 200);
    expect(res.body.pagination.total).toBe(0);
  });

  it('tidak membuka seluruh arsip saat kata pencarian habis oleh tanda baca', async () => {
    await siapkan();

    // "??" tidak menyisakan satu token pun. Kalau ini diteruskan sebagai
    // "cocokkan semua token" dengan daftar kosong, database akan menjawab
    // dengan SELURUH arsip — kebocoran dari sebuah salah ketik.
    const res = await request(app)
      .get('/api/whatsapp/conversations?search=%3F%3F')
      .set(auth(hrToken));

    expectStatus(res, 200);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('Retensi arsip', () => {
  const HARI = 24 * 60 * 60 * 1000;

  const isiArsipLamaBaru = async () => {
    expectStatus(await daftarkanNomor(), 201);
    expectStatus(
      await kirimWebhook(
        pesan({
          body: 'Pesan lama',
          messageId: 'tua-1',
          timestamp: new Date(Date.now() - 400 * HARI).toISOString(),
        })
      ),
      201
    );
    expectStatus(
      await kirimWebhook(
        pesan({ body: 'Pesan baru', messageId: 'muda-1', timestamp: new Date().toISOString() })
      ),
      201
    );
  };

  /// Retensi dibaca dari environment saat boot; di test nilainya diganti
  /// sementara supaya kedua cabang bisa diuji tanpa proses terpisah.
  const denganRetensi = async <T>(hari: number, jalankan: () => Promise<T>): Promise<T> => {
    const semula = env.WHATSAPP_RETENTION_DAYS;
    (env as { WHATSAPP_RETENTION_DAYS: number }).WHATSAPP_RETENTION_DAYS = hari;
    try {
      return await jalankan();
    } finally {
      (env as { WHATSAPP_RETENTION_DAYS: number }).WHATSAPP_RETENTION_DAYS = semula;
    }
  };

  const purge = (token: string, body: Record<string, unknown> = {}) =>
    request(app).post('/api/whatsapp/retention/purge').set(auth(token)).send(body);

  it('menolak menghapus kalau kebijakan retensi belum diatur', async () => {
    await isiArsipLamaBaru();

    const res = await denganRetensi(0, () => purge(hrToken, { dryRun: false }));

    // Tanpa kebijakan, tidak ada dasar untuk menghapus apa pun.
    expect(res.status).toBe(400);
    expect(await prisma.whatsAppConversation.count()).toBe(2);
  });

  it('menghitung tanpa menghapus saat dry run', async () => {
    await isiArsipLamaBaru();

    const res = await denganRetensi(365, () => purge(hrToken, { dryRun: true }));

    expectStatus(res, 200);
    expect(res.body.wouldDeleteConversations).toBe(1);
    expect(await prisma.whatsAppConversation.count()).toBe(2);
  });

  it('dry run adalah bawaannya kalau body kosong', async () => {
    await isiArsipLamaBaru();

    // Penghapusan permanen tidak boleh terjadi karena body lupa diisi.
    const res = await denganRetensi(365, () => purge(hrToken));

    expectStatus(res, 200);
    expect(res.body.dryRun).toBe(true);
    expect(await prisma.whatsAppConversation.count()).toBe(2);
  });

  it('menghapus hanya yang lewat masa simpan', async () => {
    await isiArsipLamaBaru();

    const res = await denganRetensi(365, () => purge(hrToken, { dryRun: false }));

    expectStatus(res, 200);
    expect(res.body.deletedConversations).toBe(1);

    const sisa = await prisma.whatsAppConversation.findMany({ select: { externalMessageId: true } });
    expect(sisa.map((s) => s.externalMessageId)).toEqual(['muda-1']);
  });

  it('menolak karyawan biasa menghapus arsip', async () => {
    await isiArsipLamaBaru();

    const res = await denganRetensi(365, () => purge(budiToken, { dryRun: false }));

    expect(res.status).toBe(403);
    expect(await prisma.whatsAppConversation.count()).toBe(2);
  });
});
