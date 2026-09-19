import fs from 'fs';
import path from 'path';
import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee } from './helpers/db';
import { login, auth, expectStatus } from './helpers/api';
import { bikinApp } from './helpers/app';
import { env } from '../src/config/env';
import { tungguAuditSelesai } from '../src/services/audit/record';
import { kenaliDokumen, namaUnduhanAman } from '../src/utils/documentUpload';

const app = bikinApp();

/** PDF terkecil yang sah: cukup untuk angka ajaib dan lolos batas 32 byte. */
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'
);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const TEKS = Buffer.from('ini bukan pdf walau namanya .pdf '.repeat(4));

let hrToken: string;
let budi: { id: string };
let budiToken: string;
let sitiToken: string;

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
  budiToken = await login(app, 'budi@resto.id');
  await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2', role: Role.MANAGER });
  sitiToken = await login(app, 'siti@resto.id');
});

afterAll(() => {
  fs.rmSync(path.resolve(env.UPLOAD_DIR, 'documents'), { recursive: true, force: true });
});

const unggah = (
  employeeId: string,
  token: string,
  ubah: Record<string, unknown> = {},
  berkas: Buffer = PDF
) =>
  request(app)
    .post(`/api/employees/${employeeId}/documents`)
    .set(auth(token))
    .send({
      type: 'kontrak_kerja',
      title: 'Kontrak Kerja 2026',
      fileName: 'kontrak-budi.pdf',
      file: berkas.toString('base64'),
      ...ubah,
    });

describe('Mengenali jenis berkas', () => {
  it('mengenali dari isi, bukan nama', () => {
    expect(kenaliDokumen(PDF, 'apa-saja.txt')?.extension).toBe('pdf');
    expect(kenaliDokumen(PNG, 'foto.jpg')?.extension).toBe('png');
    expect(kenaliDokumen(TEKS, 'dokumen.pdf')).toBeNull();
  });

  it('menerima DOCX hanya bila tanda ZIP dan ekstensinya cocok', () => {
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]);
    // Tanda "PK" berlaku untuk semua ZIP; tanpa ekstensi .docx, arsip apa
    // pun bisa menyamar sebagai dokumen Word.
    expect(kenaliDokumen(zip, 'surat.docx')?.extension).toBe('docx');
    expect(kenaliDokumen(zip, 'malware.zip')).toBeNull();
  });

  it('membersihkan nama unduhan dari karakter yang memutus header', () => {
    // Garis miring dibuang, titik beruntun diringkas, titik di awal dibuang:
    // yang tersisa tidak bisa jadi path maupun berkas tersembunyi.
    expect(namaUnduhanAman('../../etc/passwd', 'pdf')).toBe('etcpasswd.pdf');
    expect(namaUnduhanAman('..', 'pdf')).toBe('dokumen.pdf');
    expect(namaUnduhanAman('.htaccess', 'pdf')).toBe('htaccess.pdf');
    expect(namaUnduhanAman('kontrak"; x=y\r\n', 'pdf')).toBe('kontrak; x=y.pdf');
    expect(namaUnduhanAman('', 'pdf')).toBe('dokumen.pdf');
    expect(namaUnduhanAman('Ijazah S1.PDF', 'pdf')).toBe('Ijazah S1.PDF');
  });
});

describe('Mengunggah dokumen', () => {
  it('menyimpan berkas di luar direktori publik dengan izin ketat', async () => {
    const res = await unggah(budi.id, hrToken);

    expectStatus(res, 201);
    expect(res.body.mimeType).toBe('application/pdf');
    expect(res.body.sizeBytes).toBe(PDF.byteLength);
    // Lokasi di disk dan sidik jari tidak ikut keluar.
    expect(res.body.storagePath).toBeUndefined();
    expect(res.body.sha256).toBeUndefined();

    const baris = await prisma.employeeDocument.findUniqueOrThrow({ where: { id: res.body.id } });
    const lokasi = path.resolve(env.UPLOAD_DIR, baris.storagePath);
    expect(fs.existsSync(lokasi)).toBe(true);
    expect(fs.statSync(lokasi).mode & 0o777).toBe(0o600);
    // Nama di disk dibuat server, bukan dari fileName kiriman.
    expect(baris.storagePath).not.toContain('kontrak-budi');
    expect(baris.sha256).toHaveLength(64);
  });

  it('menolak berkas yang isinya tidak sesuai jenis apa pun', async () => {
    const res = await unggah(budi.id, hrToken, {}, TEKS);

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Format');
    expect(await prisma.employeeDocument.count()).toBe(0);
  });

  it('menolak berkas yang melebihi batas', async () => {
    const semula = env.DOCUMENT_MAX_BYTES;
    (env as { DOCUMENT_MAX_BYTES: number }).DOCUMENT_MAX_BYTES = 100_000;
    try {
      const besar = Buffer.concat([PDF, Buffer.alloc(150_000, 0x20)]);
      const res = await unggah(budi.id, hrToken, {}, besar);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('terlalu besar');
    } finally {
      (env as { DOCUMENT_MAX_BYTES: number }).DOCUMENT_MAX_BYTES = semula;
    }
  });

  it('menolak karyawan mengunggah dokumennya sendiri', async () => {
    // Kalau bisa, ia bisa mengunggah kontrak yang isinya ia karang.
    const res = await unggah(budi.id, budiToken);

    expect(res.status).toBe(403);
  });

  it('menolak tanggal kedaluwarsa sebelum tanggal terbit', async () => {
    const res = await unggah(budi.id, hrToken, { issuedAt: '2026-06-01', expiresAt: '2026-01-01' });

    expect(res.status).toBe(400);
  });

  it('menolak jenis dokumen di luar daftar', async () => {
    const res = await unggah(budi.id, hrToken, { type: 'rahasia_negara' });

    expect(res.status).toBe(400);
  });
});

describe('Melihat dan mengunduh', () => {
  it('karyawan melihat dokumennya sendiri, bukan milik orang lain', async () => {
    await unggah(budi.id, hrToken);

    const sendiri = await request(app).get(`/api/employees/${budi.id}/documents`).set(auth(budiToken));
    expectStatus(sendiri, 200);
    expect(sendiri.body.data).toHaveLength(1);

    // Manajer pun tidak: SKCK dan NPWP bukan urusan atasan.
    const orangLain = await request(app).get(`/api/employees/${budi.id}/documents`).set(auth(sitiToken));
    expect(orangLain.status).toBe(403);
  });

  it('mengunduh dengan isi persis seperti yang diunggah', async () => {
    const dibuat = await unggah(budi.id, hrToken);

    const res = await request(app)
      .get(`/api/documents/${dibuat.body.id}/download`)
      .set(auth(budiToken))
      .buffer(true)
      .parse((r, cb) => {
        const potongan: Buffer[] = [];
        r.on('data', (c: Buffer) => potongan.push(c));
        r.on('end', () => cb(null, Buffer.concat(potongan)));
      });

    expectStatus(res, 200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('kontrak-budi.pdf');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);
  });

  it('mencatat setiap unduhan di jejak audit', async () => {
    const dibuat = await unggah(budi.id, hrToken);
    await tungguAuditSelesai();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "AuditLog" RESTART IDENTITY CASCADE');

    await request(app).get(`/api/documents/${dibuat.body.id}/download`).set(auth(hrToken));
    await tungguAuditSelesai();

    // Ini GET, yang biasanya tidak dicatat — tapi ini akses ke data pribadi.
    const jejak = await prisma.auditLog.findFirst({ where: { action: 'employee.document.download' } });
    expect(jejak).not.toBeNull();
    expect(jejak!.entityId).toBe(dibuat.body.id);
    expect(jejak!.actorEmail).toBe('hr@resto.id');
  });

  it('menolak mengunduh dokumen orang lain', async () => {
    const dibuat = await unggah(budi.id, hrToken);

    const res = await request(app).get(`/api/documents/${dibuat.body.id}/download`).set(auth(sitiToken));

    expect(res.status).toBe(403);
  });

  it('melaporkan berkas yang hilang dari penyimpanan, bukan 404 biasa', async () => {
    const dibuat = await unggah(budi.id, hrToken);
    const baris = await prisma.employeeDocument.findUniqueOrThrow({ where: { id: dibuat.body.id } });
    fs.rmSync(path.resolve(env.UPLOAD_DIR, baris.storagePath));

    const res = await request(app).get(`/api/documents/${dibuat.body.id}/download`).set(auth(hrToken));

    // Metadata ada tapi berkasnya tidak: penyimpanan rusak atau volume tidak
    // terpasang. Harus terlihat sebagai kegagalan sistem.
    expect(res.status).toBe(500);
  });
});

describe('Mengubah dan menghapus', () => {
  it('memperbarui masa berlaku', async () => {
    const dibuat = await unggah(budi.id, hrToken);

    const res = await request(app)
      .patch(`/api/documents/${dibuat.body.id}`)
      .set(auth(hrToken))
      .send({ expiresAt: '2027-12-31' });

    expectStatus(res, 200);
    expect(res.body.expiresAt).toContain('2027-12-31');
  });

  it('menghapus secara lunak: hilang dari daftar, berkas dan baris tetap ada', async () => {
    const dibuat = await unggah(budi.id, hrToken);
    const baris = await prisma.employeeDocument.findUniqueOrThrow({ where: { id: dibuat.body.id } });

    expectStatus(await request(app).delete(`/api/documents/${dibuat.body.id}`).set(auth(hrToken)), 204);

    const daftar = await request(app).get(`/api/employees/${budi.id}/documents`).set(auth(hrToken));
    expect(daftar.body.data).toHaveLength(0);

    // Kontrak kerja adalah bukti; bukti yang lenyap justru pertanyaan pertama
    // saat sengketa.
    const setelah = await prisma.employeeDocument.findUniqueOrThrow({ where: { id: dibuat.body.id } });
    expect(setelah.deletedAt).not.toBeNull();
    expect(fs.existsSync(path.resolve(env.UPLOAD_DIR, baris.storagePath))).toBe(true);

    const denganTerhapus = await request(app)
      .get(`/api/employees/${budi.id}/documents?includeDeleted=true`)
      .set(auth(hrToken));
    expect(denganTerhapus.body.data).toHaveLength(1);
  });

  it('karyawan tidak bisa melihat dokumennya yang sudah dihapus walau diminta', async () => {
    const dibuat = await unggah(budi.id, hrToken);
    await request(app).delete(`/api/documents/${dibuat.body.id}`).set(auth(hrToken));

    const res = await request(app)
      .get(`/api/employees/${budi.id}/documents?includeDeleted=true`)
      .set(auth(budiToken));

    expect(res.body.data).toHaveLength(0);
  });

  it('menghapus dua kali mengembalikan 404', async () => {
    const dibuat = await unggah(budi.id, hrToken);
    await request(app).delete(`/api/documents/${dibuat.body.id}`).set(auth(hrToken));

    expect((await request(app).delete(`/api/documents/${dibuat.body.id}`).set(auth(hrToken))).status).toBe(404);
  });
});

describe('Pelacakan masa berlaku', () => {
  const hari = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

  it('menampilkan yang segera dan sudah kedaluwarsa, urut dari yang paling mendesak', async () => {
    await unggah(budi.id, hrToken, { type: 'skck', title: 'SKCK', expiresAt: hari(10) });
    await unggah(budi.id, hrToken, { type: 'sertifikat', title: 'Food Handler', expiresAt: hari(-5) });
    await unggah(budi.id, hrToken, { type: 'kontrak_kerja', title: 'Kontrak', expiresAt: hari(200) });
    await unggah(budi.id, hrToken, { type: 'ijazah', title: 'Ijazah' });

    const res = await request(app).get('/api/documents/expiring?days=30').set(auth(hrToken));

    expectStatus(res, 200);
    expect(res.body.data.map((d: { title: string }) => d.title)).toEqual(['Food Handler', 'SKCK']);
    expect(res.body.data[0].employee.name).toBeDefined();
  });

  it('tidak menghitung dokumen yang sudah dihapus', async () => {
    const dibuat = await unggah(budi.id, hrToken, { type: 'skck', expiresAt: hari(3) });
    await request(app).delete(`/api/documents/${dibuat.body.id}`).set(auth(hrToken));

    const res = await request(app).get('/api/documents/expiring?days=30').set(auth(hrToken));

    expect(res.body.pagination.total).toBe(0);
  });

  it('hanya HR yang boleh melihat pelacakan lintas karyawan', async () => {
    expect((await request(app).get('/api/documents/expiring').set(auth(budiToken))).status).toBe(403);
    expect((await request(app).get('/api/documents/expiring').set(auth(sitiToken))).status).toBe(403);
  });
});
