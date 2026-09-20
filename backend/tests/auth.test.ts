import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, DEFAULT_PASSWORD } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth } from './helpers/api';

const app = bikinApp();

beforeEach(resetDatabase);

describe('POST /api/auth/login', () => {
  it('mengembalikan token dan data user untuk kredensial yang benar', async () => {
    await makeEmployee({ email: 'budi@resto.id', name: 'Budi' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'budi@resto.id', password: DEFAULT_PASSWORD });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toMatchObject({ email: 'budi@resto.id', name: 'Budi' });
  });

  it('tidak pernah mengirim password dalam response', async () => {
    await makeEmployee({ email: 'budi@resto.id' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'budi@resto.id', password: DEFAULT_PASSWORD });

    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  it('mencatat lastLoginAt', async () => {
    const employee = await makeEmployee({ email: 'budi@resto.id' });
    expect(employee.lastLoginAt).toBeNull();

    await request(app)
      .post('/api/auth/login')
      .send({ email: 'budi@resto.id', password: DEFAULT_PASSWORD });

    const after = await prisma.employee.findUnique({ where: { id: employee.id } });
    expect(after?.lastLoginAt).toBeInstanceOf(Date);
  });

  it('menolak password yang salah', async () => {
    await makeEmployee({ email: 'budi@resto.id' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'budi@resto.id', password: 'password-salah' });

    expect(res.status).toBe(401);
  });

  it('memakai pesan error yang sama untuk email tidak terdaftar dan password salah, '
     + 'supaya tidak membocorkan email mana yang terdaftar', async () => {
    await makeEmployee({ email: 'budi@resto.id' });

    const salahPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: 'budi@resto.id', password: 'password-salah' });

    const tidakTerdaftar = await request(app)
      .post('/api/auth/login')
      .send({ email: 'tidakada@resto.id', password: 'apa pun' });

    expect(salahPassword.status).toBe(401);
    expect(tidakTerdaftar.status).toBe(401);
    expect(tidakTerdaftar.body.error).toBe(salahPassword.body.error);
  });

  it('menolak akun yang belum punya password', async () => {
    await makeEmployee({ email: 'belum@resto.id', password: null });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'belum@resto.id', password: 'apa pun' });

    expect(res.status).toBe(401);
  });

  it('menolak login karyawan yang sudah resign', async () => {
    await makeEmployee({ email: 'resign@resto.id', status: 'resign' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'resign@resto.id', password: DEFAULT_PASSWORD });

    expect(res.status).toBe(403);
  });

  it('menolak format email yang tidak valid', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'bukan-email', password: 'apa pun' });

    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('email');
  });

  it('menolak field tambahan yang tidak dikenal', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'budi@resto.id', password: 'x', role: 'SUPER_ADMIN' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  it('menolak request tanpa token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('menolak token yang tidak sah dengan 401, bukan 403', async () => {
    const res = await request(app).get('/api/auth/me').set(auth('token.palsu.sekali'));
    expect(res.status).toBe(401);
  });

  it('mengembalikan profil pemilik token tanpa password', async () => {
    await makeEmployee({ email: 'budi@resto.id', name: 'Budi', role: Role.HR_ADMIN });
    const token = await login(app, 'budi@resto.id');

    const res = await request(app).get('/api/auth/me').set(auth(token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: 'budi@resto.id', role: Role.HR_ADMIN });
    expect(res.body).not.toHaveProperty('password');
  });

  it('menolak token milik karyawan yang dinonaktifkan setelah token terbit', async () => {
    const employee = await makeEmployee({ email: 'budi@resto.id' });
    const token = await login(app, 'budi@resto.id');

    await prisma.employee.update({ where: { id: employee.id }, data: { status: 'resign' } });

    const res = await request(app).get('/api/auth/me').set(auth(token));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/auth/change-password', () => {
  it('mengganti password dan membuat password lama tidak berlaku', async () => {
    await makeEmployee({ email: 'budi@resto.id' });
    const token = await login(app, 'budi@resto.id');

    const ganti = await request(app)
      .post('/api/auth/change-password')
      .set(auth(token))
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'PasswordBaru456' });

    expect(ganti.status).toBe(200);

    const pakaiLama = await request(app)
      .post('/api/auth/login')
      .send({ email: 'budi@resto.id', password: DEFAULT_PASSWORD });
    expect(pakaiLama.status).toBe(401);

    const pakaiBaru = await request(app)
      .post('/api/auth/login')
      .send({ email: 'budi@resto.id', password: 'PasswordBaru456' });
    expect(pakaiBaru.status).toBe(200);
  });

  it('menolak kalau password saat ini salah', async () => {
    await makeEmployee({ email: 'budi@resto.id' });
    const token = await login(app, 'budi@resto.id');

    const res = await request(app)
      .post('/api/auth/change-password')
      .set(auth(token))
      .send({ currentPassword: 'bukan-ini', newPassword: 'PasswordBaru456' });

    expect(res.status).toBe(401);
  });

  it('menolak password baru yang terlalu pendek', async () => {
    await makeEmployee({ email: 'budi@resto.id' });
    const token = await login(app, 'budi@resto.id');

    const res = await request(app)
      .post('/api/auth/change-password')
      .set(auth(token))
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'pendek' });

    expect(res.status).toBe(400);
  });
});

describe('Badan permintaan rusak', () => {
  it('JSON yang tidak sah dibalas 400, bukan 500', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":"rusak');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/JSON/);
  });
});
