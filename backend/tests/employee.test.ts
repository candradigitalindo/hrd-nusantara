import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makeDepartment } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth } from './helpers/api';

const app = bikinApp();

let token: string;

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  token = await login(app, 'hr@resto.id');
});


describe('POST /api/employees', () => {
  it('membuat karyawan dengan primary key ULID', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set(auth(token))
      .send({ nik: 'EMP-1', name: 'Budi Santoso', email: 'budi@resto.id' });

    expect(res.status).toBe(201);
    // Ini regresi dari bug lama: id tidak pernah diisi, jadi setiap
    // create gagal dengan 500.
    expect(res.body.id).toHaveLength(26);
    expect(res.body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('menyimpan password sebagai hash, bukan teks polos', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set(auth(token))
      .send({ nik: 'EMP-1', name: 'Budi', email: 'budi@resto.id', password: 'RahasiaBudi1' });

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty('password');

    const tersimpan = await prisma.employee.findUnique({ where: { id: res.body.id } });
    expect(tersimpan?.password).not.toBe('RahasiaBudi1');
    expect(tersimpan?.password).toMatch(/^\$2[aby]\$/);
  });

  it('menolak field yang tidak dideklarasikan, bukan diam-diam membuangnya', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set(auth(token))
      .send({
        nik: 'EMP-1',
        name: 'Budi',
        email: 'budi@resto.id',
        id: 'ID-PAKSAAN',
        createdAt: '2000-01-01T00:00:00Z',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validasi gagal');
  });

  it('membalas 409 untuk NIK duplikat', async () => {
    const body = { nik: 'EMP-1', name: 'Budi', email: 'budi@resto.id' };
    await request(app).post('/api/employees').set(auth(token)).send(body);

    const res = await request(app)
      .post('/api/employees')
      .set(auth(token))
      .send({ ...body, email: 'lain@resto.id' });

    expect(res.status).toBe(409);
  });

  it('membalas 400 untuk email tidak valid', async () => {
    const res = await request(app)
      .post('/api/employees')
      .set(auth(token))
      .send({ nik: 'EMP-1', name: 'Budi', email: 'bukan-email' });

    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('email');
  });

  it('menolak request tanpa token', async () => {
    const res = await request(app)
      .post('/api/employees')
      .send({ nik: 'EMP-1', name: 'Budi', email: 'budi@resto.id' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/employees', () => {
  it('mengembalikan hasil berhalaman', async () => {
    for (let i = 0; i < 5; i += 1) {
      await makeEmployee({ nik: `E-${i}`, email: `e${i}@resto.id` });
    }

    const res = await request(app).get('/api/employees?page=1&limit=3').set(auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 3, total: 6 });
  });

  it('mencari berdasarkan nama, NIK, atau email', async () => {
    await makeEmployee({ name: 'Siti Aminah', nik: 'X-9', email: 'siti@resto.id' });

    const res = await request(app).get('/api/employees?search=Aminah').set(auth(token));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Siti Aminah');
  });

  it('menyembunyikan karyawan resign secara default, menampilkannya bila diminta', async () => {
    await makeEmployee({ email: 'resign@resto.id', status: 'resign' });

    const bawaan = await request(app).get('/api/employees').set(auth(token));
    expect(bawaan.body.pagination.total).toBe(1);

    const semua = await request(app)
      .get('/api/employees?includeInactive=true')
      .set(auth(token));
    expect(semua.body.pagination.total).toBe(2);
  });

  it('tidak pernah menyertakan password di daftar', async () => {
    await makeEmployee({ email: 'budi@resto.id' });

    const res = await request(app).get('/api/employees').set(auth(token));

    expect(JSON.stringify(res.body)).not.toContain('password');
  });
});

describe('PUT /api/employees/:id', () => {
  it('memasang lalu melepas departemen dengan mengirim null', async () => {
    const dept = await makeDepartment('Kitchen');
    const employee = await makeEmployee({ email: 'budi@resto.id' });

    const pasang = await request(app)
      .put(`/api/employees/${employee.id}`)
      .set(auth(token))
      .send({ departmentId: dept.id });
    expect(pasang.status).toBe(200);
    expect(pasang.body.department).toMatchObject({ id: dept.id, name: 'Kitchen' });

    // Versi lama menerjemahkan null menjadi connect:{id:null} dan selalu error.
    const lepas = await request(app)
      .put(`/api/employees/${employee.id}`)
      .set(auth(token))
      .send({ departmentId: null });
    expect(lepas.status).toBe(200);
    expect(lepas.body.departmentId).toBeNull();
  });

  it('membalas 404 untuk departemen yang tidak ada', async () => {
    const employee = await makeEmployee({ email: 'budi@resto.id' });

    const res = await request(app)
      .put(`/api/employees/${employee.id}`)
      .set(auth(token))
      .send({ departmentId: '01ZZZZZZZZZZZZZZZZZZZZZZZZ' });

    expect(res.status).toBe(404);
  });

  it('menolak body kosong', async () => {
    const employee = await makeEmployee({ email: 'budi@resto.id' });

    const res = await request(app)
      .put(`/api/employees/${employee.id}`)
      .set(auth(token))
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/employees/:id/deactivate', () => {
  it('menandai karyawan resign tanpa menghapus barisnya', async () => {
    const employee = await makeEmployee({ email: 'budi@resto.id' });

    const res = await request(app)
      .patch(`/api/employees/${employee.id}/deactivate`)
      .set(auth(token))
      .send({ status: 'resign' });

    expect(res.status).toBe(200);
    expect(res.body.employee.status).toBe('resign');

    // Arsip wajib tetap ada — presensi, payroll dan kontrak menggantung di sini.
    const masihAda = await prisma.employee.findUnique({ where: { id: employee.id } });
    expect(masihAda).not.toBeNull();
  });

  it('mencegah pengguna menonaktifkan akunnya sendiri', async () => {
    const hr = await prisma.employee.findUniqueOrThrow({ where: { email: 'hr@resto.id' } });

    const res = await request(app)
      .patch(`/api/employees/${hr.id}/deactivate`)
      .set(auth(token))
      .send({ status: 'resign' });

    expect(res.status).toBe(400);
  });

  it('menolak status yang bukan status non-aktif', async () => {
    const employee = await makeEmployee({ email: 'budi@resto.id' });

    const res = await request(app)
      .patch(`/api/employees/${employee.id}/deactivate`)
      .set(auth(token))
      .send({ status: 'active' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/employees/directory', () => {
  it('bisa diakses karyawan biasa, tanpa data pribadi, tanpa yang sudah keluar', async () => {
    await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1', name: 'Budi Cook' });
    await makeEmployee({ email: 'mantan@resto.id', nik: 'EMP-2', name: 'Mantan', status: 'resign' });
    const budiToken = await login(app, 'budi@resto.id');

    const res = await request(app).get('/api/employees/directory').set(auth(budiToken));

    expect(res.status).toBe(200);
    const nama = res.body.data.map((e: { name: string }) => e.name);
    expect(nama).toContain('Budi Cook');
    expect(nama).not.toContain('Mantan');
    for (const e of res.body.data) {
      expect(e).not.toHaveProperty('email');
      expect(e).not.toHaveProperty('password');
      expect(e).not.toHaveProperty('phoneNumber');
    }
  });

  it('mencari berdasarkan nama atau NIK', async () => {
    await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1', name: 'Budi Cook' });
    await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2', name: 'Siti Waiter' });

    const res = await request(app).get('/api/employees/directory?q=siti').set(auth(token));
    expect(res.body.data.map((e: { name: string }) => e.name)).toEqual(['Siti Waiter']);

    const nik = await request(app).get('/api/employees/directory?q=emp-1').set(auth(token));
    expect(nik.body.data.map((e: { name: string }) => e.name)).toEqual(['Budi Cook']);
  });
});
