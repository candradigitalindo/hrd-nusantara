import request from 'supertest';
import { Role } from '@prisma/client';
import { createApp } from '../src/app';
import { prisma, resetDatabase, makeEmployee, makeDepartment } from './helpers/db';
import { login, auth, expectStatus } from './helpers/api';

const app = createApp();

beforeEach(resetDatabase);

describe('Karyawan biasa (EMPLOYEE)', () => {
  it('tidak boleh melihat daftar seluruh karyawan', async () => {
    await makeEmployee({ email: 'budi@resto.id' });
    const token = await login(app, 'budi@resto.id');

    const res = await request(app).get('/api/employees').set(auth(token));
    expect(res.status).toBe(403);
  });

  it('boleh melihat datanya sendiri', async () => {
    const budi = await makeEmployee({ email: 'budi@resto.id', name: 'Budi' });
    const token = await login(app, 'budi@resto.id');

    const res = await request(app).get(`/api/employees/${budi.id}`).set(auth(token));

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Budi');
  });

  it('tidak boleh melihat data karyawan lain', async () => {
    await makeEmployee({ email: 'budi@resto.id' });
    const orangLain = await makeEmployee({ email: 'siti@resto.id' });
    const token = await login(app, 'budi@resto.id');

    const res = await request(app).get(`/api/employees/${orangLain.id}`).set(auth(token));
    expect(res.status).toBe(403);
  });

  it('tidak boleh membuat karyawan', async () => {
    await makeEmployee({ email: 'budi@resto.id' });
    const token = await login(app, 'budi@resto.id');

    const res = await request(app)
      .post('/api/employees')
      .set(auth(token))
      .send({ nik: 'X-1', name: 'X', email: 'x@resto.id' });

    expect(res.status).toBe(403);
  });
});

describe('MANAGER', () => {
  it('hanya melihat karyawan di departemennya sendiri', async () => {
    const kitchen = await makeDepartment('Kitchen');
    const frontOffice = await makeDepartment('Front Office');

    await makeEmployee({
      email: 'manajer@resto.id',
      role: Role.MANAGER,
      departmentId: kitchen.id,
    });
    await makeEmployee({ email: 'koki@resto.id', departmentId: kitchen.id });
    await makeEmployee({ email: 'resepsionis@resto.id', departmentId: frontOffice.id });

    const token = await login(app, 'manajer@resto.id');
    const res = await request(app).get('/api/employees').set(auth(token));

    expect(res.status).toBe(200);
    const emails = res.body.data.map((e: { email: string }) => e.email).sort();
    expect(emails).toEqual(['koki@resto.id', 'manajer@resto.id']);
  });

  it('tidak boleh meminta daftar departemen lain lewat query', async () => {
    const kitchen = await makeDepartment('Kitchen');
    const frontOffice = await makeDepartment('Front Office');

    await makeEmployee({
      email: 'manajer@resto.id',
      role: Role.MANAGER,
      departmentId: kitchen.id,
    });

    const token = await login(app, 'manajer@resto.id');
    const res = await request(app)
      .get(`/api/employees?departmentId=${frontOffice.id}`)
      .set(auth(token));

    expect(res.status).toBe(403);
  });

  it('tidak boleh membuka data karyawan departemen lain', async () => {
    const kitchen = await makeDepartment('Kitchen');
    const frontOffice = await makeDepartment('Front Office');

    await makeEmployee({
      email: 'manajer@resto.id',
      role: Role.MANAGER,
      departmentId: kitchen.id,
    });
    const orangLain = await makeEmployee({
      email: 'resepsionis@resto.id',
      departmentId: frontOffice.id,
    });

    const token = await login(app, 'manajer@resto.id');
    const res = await request(app).get(`/api/employees/${orangLain.id}`).set(auth(token));

    expect(res.status).toBe(403);
  });
});

describe('Pencegahan eskalasi hak akses', () => {
  const buatHr = async () => {
    await makeEmployee({ email: 'hr@resto.id', role: Role.HR_ADMIN });
    return login(app, 'hr@resto.id');
  };

  it('HR_ADMIN tidak boleh membuat SUPER_ADMIN', async () => {
    const token = await buatHr();

    const res = await request(app)
      .post('/api/employees')
      .set(auth(token))
      .send({ nik: 'SA-1', name: 'Naik', email: 'sa@resto.id', role: Role.SUPER_ADMIN });

    expectStatus(res, 403);
  });

  it('HR_ADMIN tidak boleh membuat HR_ADMIN lain', async () => {
    const token = await buatHr();

    const res = await request(app)
      .post('/api/employees')
      .set(auth(token))
      .send({ nik: 'HR-2', name: 'HR Baru', email: 'hr2@resto.id', role: Role.HR_ADMIN });

    expectStatus(res, 403);
  });

  it('HR_ADMIN tidak boleh menaikkan orang lain menjadi SUPER_ADMIN', async () => {
    const token = await buatHr();
    const budi = await makeEmployee({ email: 'budi@resto.id' });

    const res = await request(app)
      .put(`/api/employees/${budi.id}`)
      .set(auth(token))
      .send({ role: Role.SUPER_ADMIN });

    expectStatus(res, 403);
  });

  it('HR_ADMIN tetap boleh mengangkat MANAGER — ini tugas HR yang wajar', async () => {
    const token = await buatHr();
    const budi = await makeEmployee({ email: 'budi@resto.id' });

    const res = await request(app)
      .put(`/api/employees/${budi.id}`)
      .set(auth(token))
      .send({ role: Role.MANAGER });

    expectStatus(res, 200);
    expect(res.body.role).toBe(Role.MANAGER);
  });

  it('SUPER_ADMIN tidak boleh mengubah role dirinya sendiri', async () => {
    const admin = await makeEmployee({ email: 'admin@resto.id', role: Role.SUPER_ADMIN });
    const token = await login(app, 'admin@resto.id');

    const res = await request(app)
      .put(`/api/employees/${admin.id}`)
      .set(auth(token))
      .send({ role: Role.EMPLOYEE });

    expectStatus(res, 403);
  });
});
