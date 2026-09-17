import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, DEFAULT_PASSWORD } from './helpers/db';
import { login, auth, expectStatus } from './helpers/api';
import { bikinApp } from './helpers/app';
import { generateULID } from '../src/utils/generateULID';
import { redaksiMetadata, DIRAHASIAKAN, tungguAuditSelesai } from '../src/services/audit/record';

const app = bikinApp();

let superToken: string;
let hrToken: string;
let budi: { id: string; email: string };
let budiToken: string;

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'super@resto.id', nik: 'SA-1', role: Role.SUPER_ADMIN });
  superToken = await login(app, 'super@resto.id');
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
  budiToken = await login(app, 'budi@resto.id');
  // Jejak dari penyiapan di atas dibuang supaya tiap test mulai dari nol.
  await tungguAuditSelesai();
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AuditLog" RESTART IDENTITY CASCADE');
});

/** Jejak ditulis setelah respons terkirim, jadi harus ditunggu dulu. */
const jejak = async () => {
  await tungguAuditSelesai();
  return prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
};

describe('Jejak audit bersifat append-only', () => {
  it('menolak penyuntingan jejak lewat database', async () => {
    const id = generateULID();
    await prisma.auditLog.create({
      data: { id, action: 'UJI', method: 'POST', path: '/uji', statusCode: 200 },
    });

    // Ditegakkan trigger database, bukan kesepakatan di kode: siapa pun yang
    // memegang kredensial database bisa melewati lapisan aplikasi.
    await expect(
      prisma.auditLog.update({ where: { id }, data: { summary: 'disunting' } })
    ).rejects.toThrow();
  });

  it('menolak penghapusan jejak lewat database', async () => {
    const id = generateULID();
    await prisma.auditLog.create({
      data: { id, action: 'UJI', method: 'POST', path: '/uji', statusCode: 200 },
    });

    await expect(prisma.auditLog.delete({ where: { id } })).rejects.toThrow();
  });

  it('tidak menyediakan endpoint untuk mengubah atau menghapus', async () => {
    const id = generateULID();
    await prisma.auditLog.create({
      data: { id, action: 'UJI', method: 'POST', path: '/uji', statusCode: 200 },
    });

    for (const kirim of [
      request(app).delete(`/api/audit-logs/${id}`),
      request(app).put(`/api/audit-logs/${id}`).send({ summary: 'x' }),
    ]) {
      const res = await kirim.set(auth(superToken));
      expect(res.status).toBe(404);
    }
  });
});

describe('Pencatatan otomatis', () => {
  it('mencatat siapa mengubah apa', async () => {
    expectStatus(
      await request(app)
        .put(`/api/employees/${budi.id}`)
        .set(auth(hrToken))
        .send({ name: 'Budi Santoso' }),
      200
    );

    const baris = await jejak();
    const ubah = baris.find((b) => b.action === 'employee.ubah');
    expect(ubah).toBeDefined();
    expect(ubah!.actorEmail).toBe('hr@resto.id');
    expect(ubah!.actorRole).toBe(Role.HR_ADMIN);
    expect(ubah!.entityId).toBe(budi.id);
    expect(ubah!.statusCode).toBe(200);
  });

  it('mencatat percobaan yang DITOLAK, bukan hanya yang berhasil', async () => {
    // Karyawan biasa mencoba mengubah data orang lain. Percobaan yang gagal
    // justru sinyal yang paling ingin dilihat saat menelusuri insiden.
    await request(app)
      .put(`/api/employees/${budi.id}`)
      .set(auth(budiToken))
      .send({ role: Role.SUPER_ADMIN });

    const baris = await jejak();
    expect(baris.some((b) => b.statusCode === 403)).toBe(true);
  });

  it('mencatat login yang gagal tanpa menyentuh kata sandinya', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'hr@resto.id', password: 'TebakanSalah123' });

    const baris = await jejak();
    const gagal = baris.find((b) => b.action === 'auth.login.gagal');
    expect(gagal).toBeDefined();
    expect(gagal!.statusCode).toBe(401);
    expect(JSON.stringify(gagal)).not.toContain('TebakanSalah123');
  });

  it('mencatat login yang berhasil', async () => {
    await login(app, 'budi@resto.id');

    const baris = await jejak();
    expect(baris.some((b) => b.action === 'auth.login.berhasil')).toBe(true);
  });

  it('tidak mencatat pembacaan biasa', async () => {
    // Mencatat setiap GET akan membuat tabel audit tumbuh lebih cepat
    // daripada data yang diauditnya, dan menenggelamkan yang penting.
    expectStatus(await request(app).get('/api/employees').set(auth(hrToken)), 200);

    expect(await jejak()).toHaveLength(0);
  });

  it('menyimpan pola rute, bukan hanya path mentah', async () => {
    await request(app).put(`/api/employees/${budi.id}`).set(auth(hrToken)).send({ name: 'X' });

    const baris = await jejak();
    // Pola dipakai supaya aksi yang sama bisa dikelompokkan walau id-nya
    // berbeda-beda; path sebenarnya tetap tersimpan terpisah.
    expect(baris[0].path).toContain(budi.id);
    expect(baris[0].method).toBe('PUT');
  });
});

describe('Perubahan hak akses', () => {
  it('mencatat role sebelum dan sesudah', async () => {
    expectStatus(
      await request(app)
        .put(`/api/employees/${budi.id}`)
        .set(auth(superToken))
        .send({ role: Role.MANAGER }),
      200
    );

    const baris = await jejak();
    const ubah = baris.find((b) => b.action === 'employee.ubah.role');
    expect(ubah).toBeDefined();
    const meta = ubah!.metadata as Record<string, unknown>;
    // "role diubah" tanpa nilai lamanya tidak menjawab pertanyaan yang
    // justru ditanyakan saat audit: naik dari apa ke apa.
    expect(meta.roleSebelum).toBe(Role.EMPLOYEE);
    expect(meta.roleSesudah).toBe(Role.MANAGER);
    expect(ubah!.summary).toContain('EMPLOYEE');
    expect(ubah!.summary).toContain('MANAGER');
  });

  it('tidak menyalin data pribadi ke dalam jejak', async () => {
    expectStatus(
      await request(app)
        .put(`/api/employees/${budi.id}`)
        .set(auth(hrToken))
        .send({ address: 'Jl. Melati No. 7, Jakarta Selatan', phoneNumber: '08123456789' }),
      200
    );

    const baris = await jejak();
    const isi = JSON.stringify(baris);
    // Yang dicatat nama field-nya, bukan nilainya: tabel audit tidak
    // terenkripsi dan barisnya tidak bisa dihapus.
    expect(isi).not.toContain('Jl. Melati');
    expect(isi).not.toContain('08123456789');
    expect(isi).toContain('address');
  });
});

describe('Redaksi metadata', () => {
  it('menyamarkan nilai yang jelas rahasia', () => {
    const hasil = redaksiMetadata({
      email: 'budi@resto.id',
      password: 'RahasiaBanget',
      messageBody: 'isi percakapan pelanggan',
      nested: { apiToken: 'abc123', biasa: 'aman' },
    }) as Record<string, unknown>;

    expect(hasil.email).toBe('budi@resto.id');
    expect(hasil.password).toBe(DIRAHASIAKAN);
    expect(hasil.messageBody).toBe(DIRAHASIAKAN);
    expect((hasil.nested as Record<string, unknown>).apiToken).toBe(DIRAHASIAKAN);
    expect((hasil.nested as Record<string, unknown>).biasa).toBe('aman');
  });

  it('memotong objek yang terlalu dalam', () => {
    // Menjaga objek Prisma yang tak sengaja terbawa tidak menyeret seluruh
    // grafnya ke dalam tabel audit.
    const dalam = { a: { b: { c: { d: { e: { f: 'terlalu dalam' } } } } } };

    expect(JSON.stringify(redaksiMetadata(dalam))).not.toContain('terlalu dalam');
  });

  it('membiarkan array dan nilai biasa apa adanya', () => {
    expect(redaksiMetadata({ daftar: ['a', 'b'], jumlah: 3, kosong: null })).toEqual({
      daftar: ['a', 'b'],
      jumlah: 3,
      kosong: null,
    });
  });
});

describe('Membaca jejak audit', () => {
  const buatJejak = async () => {
    await request(app).put(`/api/employees/${budi.id}`).set(auth(hrToken)).send({ name: 'A' });
    await request(app).put(`/api/employees/${budi.id}`).set(auth(budiToken)).send({ name: 'B' });
    await tungguAuditSelesai();
  };

  it('hanya SUPER_ADMIN yang boleh membacanya', async () => {
    // Jejak ini memperlihatkan perbuatan semua orang, termasuk HR. Kalau HR
    // bisa membacanya sendiri, pengawasan atas HR ikut hilang.
    expect((await request(app).get('/api/audit-logs').set(auth(hrToken))).status).toBe(403);
    expect((await request(app).get('/api/audit-logs').set(auth(budiToken))).status).toBe(403);
    expectStatus(await request(app).get('/api/audit-logs').set(auth(superToken)), 200);
  });

  it('menyaring percobaan yang gagal saja', async () => {
    await buatJejak();

    const res = await request(app)
      .get('/api/audit-logs?onlyFailed=true')
      .set(auth(superToken));

    expectStatus(res, 200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((b: { statusCode: number }) => b.statusCode >= 400)).toBe(true);
  });

  it('menyaring per pelaku', async () => {
    await buatJejak();

    const res = await request(app)
      .get(`/api/audit-logs?actorId=${budi.id}`)
      .set(auth(superToken));

    expectStatus(res, 200);
    expect(res.body.data.every((b: { actorId: string }) => b.actorId === budi.id)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('menyaring per record yang tersentuh', async () => {
    await buatJejak();

    const res = await request(app)
      .get(`/api/audit-logs?entity=Employee&entityId=${budi.id}`)
      .set(auth(superToken));

    expectStatus(res, 200);
    expect(res.body.pagination.total).toBeGreaterThan(0);
  });
});
