import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee } from './helpers/db';
import { login, auth, expectStatus } from './helpers/api';
import { bikinApp } from './helpers/app';

const app = bikinApp();

let hrToken: string;
let budiToken: string;

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
  budiToken = await login(app, 'budi@resto.id');
});

const buatDepartemen = (nama = 'Kitchen', ubah: Record<string, unknown> = {}) =>
  request(app).post('/api/departments').set(auth(hrToken)).send({ name: nama, ...ubah });

describe('Departemen', () => {
  it('membuat departemen dan menghitung isinya', async () => {
    const res = await buatDepartemen('Housekeeping', { description: 'Kebersihan kamar' });

    expectStatus(res, 201);
    expect(res.body.name).toBe('Housekeeping');
    expect(res.body._count).toEqual({ employees: 0, positions: 0 });
  });

  it('menolak karyawan biasa membuat departemen', async () => {
    const res = await request(app)
      .post('/api/departments')
      .set(auth(budiToken))
      .send({ name: 'Kitchen' });

    expect(res.status).toBe(403);
  });

  it('semua karyawan boleh membaca daftarnya', async () => {
    // Dibutuhkan untuk mengisi pilihan di formulir, dan namanya bukan rahasia.
    await buatDepartemen();

    const res = await request(app).get('/api/departments').set(auth(budiToken));

    expectStatus(res, 200);
    expect(res.body.data).toHaveLength(1);
  });

  it('mencari per nama', async () => {
    await buatDepartemen('Kitchen');
    await buatDepartemen('Front Office');

    const res = await request(app).get('/api/departments?search=front').set(auth(hrToken));

    expect(res.body.data.map((d: { name: string }) => d.name)).toEqual(['Front Office']);
  });

  it('menolak pola kerja yang tidak ada', async () => {
    const res = await buatDepartemen('Kitchen', { workPatternId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });

    expect(res.status).toBe(404);
  });

  it('menolak field yang tidak dikenal', async () => {
    const res = await buatDepartemen('Kitchen', { budget: 1_000_000 });

    expect(res.status).toBe(400);
  });

  it('memperbarui sebagian field', async () => {
    const dibuat = await buatDepartemen('Kitchen');

    const res = await request(app)
      .put(`/api/departments/${dibuat.body.id}`)
      .set(auth(hrToken))
      .send({ description: 'Dapur utama' });

    expectStatus(res, 200);
    expect(res.body.name).toBe('Kitchen');
    expect(res.body.description).toBe('Dapur utama');
  });

  it('menolak menghapus departemen yang masih berisi karyawan', async () => {
    const dibuat = await buatDepartemen('Kitchen');
    await makeEmployee({ email: 'chef@resto.id', nik: 'EMP-2', departmentId: dibuat.body.id });

    const res = await request(app)
      .delete(`/api/departments/${dibuat.body.id}`)
      .set(auth(hrToken));

    // Karyawannya akan kehilangan tempat, dan arsip presensi serta penggajian
    // yang menunjuk ke sana ikut yatim.
    expect(res.status).toBe(409);
    expect(await prisma.department.count()).toBe(1);
  });

  it('menghapus departemen kosong', async () => {
    const dibuat = await buatDepartemen('Sementara');

    const res = await request(app)
      .delete(`/api/departments/${dibuat.body.id}`)
      .set(auth(hrToken));

    expect(res.status).toBe(204);
    expect(await prisma.department.count()).toBe(0);
  });
});

describe('Jabatan', () => {
  it('membuat jabatan di dalam departemen', async () => {
    const dept = await buatDepartemen('Kitchen');

    const res = await request(app)
      .post('/api/positions')
      .set(auth(hrToken))
      .send({ name: 'Chef de Partie', departmentId: dept.body.id });

    expectStatus(res, 201);
    expect(res.body.department.name).toBe('Kitchen');
  });

  it('menolak departemen yang tidak ada', async () => {
    const res = await request(app)
      .post('/api/positions')
      .set(auth(hrToken))
      .send({ name: 'Waiter', departmentId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });

    expect(res.status).toBe(404);
  });

  it('menyaring jabatan per departemen', async () => {
    const kitchen = await buatDepartemen('Kitchen');
    const fo = await buatDepartemen('Front Office');
    await request(app).post('/api/positions').set(auth(hrToken)).send({ name: 'Cook', departmentId: kitchen.body.id });
    await request(app).post('/api/positions').set(auth(hrToken)).send({ name: 'Receptionist', departmentId: fo.body.id });

    const res = await request(app)
      .get(`/api/positions?departmentId=${kitchen.body.id}`)
      .set(auth(hrToken));

    expect(res.body.data.map((p: { name: string }) => p.name)).toEqual(['Cook']);
  });

  it('menolak menghapus jabatan yang masih dipegang karyawan', async () => {
    const pos = await request(app).post('/api/positions').set(auth(hrToken)).send({ name: 'Waiter' });
    await makeEmployee({ email: 'w@resto.id', nik: 'EMP-3', positionId: pos.body.id });

    const res = await request(app).delete(`/api/positions/${pos.body.id}`).set(auth(hrToken));

    expect(res.status).toBe(409);
  });
});
