import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, DEFAULT_PASSWORD } from './helpers/db';
import { login, auth } from './helpers/api';
import { bikinApp } from './helpers/app';

const app = bikinApp();

const masukPonsel = async (email = 'budi@resto.id', name = 'Pixel 8') => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username: email, password: DEFAULT_PASSWORD, device: { platform: 'android', name } });
  expect(res.status).toBe(200);
  return res.body as { token: string; refreshToken: string; refreshExpiresAt: string };
};
const perbarui = (refreshToken: string) => request(app).post('/api/auth/refresh').send({ refreshToken });
const saya = (token: string) => request(app).get('/api/auth/me').set(auth(token));

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'budi@resto.id', name: 'Budi' });
});

describe('Sesi perangkat mobile (refresh token)', () => {
  it('login ponsel memberi refresh token berumur panjang; login web tidak', async () => {
    const ponsel = await masukPonsel();
    expect(ponsel.refreshToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(new Date(ponsel.refreshExpiresAt).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const web = await request(app).post('/api/auth/login').send({ username: 'budi@resto.id', password: DEFAULT_PASSWORD });
    expect(web.body.token).toBeDefined();
    expect(web.body.refreshToken).toBeUndefined();
    expect(await prisma.mobileSession.count()).toBe(1);
  });

  it('refresh token ditukar dengan token akses baru yang berlaku, dan ikut berputar', async () => {
    const awal = await masukPonsel();
    const res = await perbarui(awal.refreshToken);

    expect(res.status).toBe(200);
    expect(res.body.refreshToken).not.toBe(awal.refreshToken);
    expect((await saya(res.body.token)).status).toBe(200);
    // Hash saja yang disimpan, bukan tokennya.
    const sesi = await prisma.mobileSession.findFirstOrThrow();
    expect(JSON.stringify(sesi)).not.toContain(res.body.refreshToken);
  });

  it('jawaban putaran hilang di jaringan: token lama masih dilayani sesaat', async () => {
    const awal = await masukPonsel();
    expect((await perbarui(awal.refreshToken)).status).toBe(200); // jawaban ini "hilang"

    const ulang = await perbarui(awal.refreshToken);
    expect(ulang.status).toBe(200);
    expect((await perbarui(ulang.body.refreshToken)).status).toBe(200);
  });

  it('token lama dipakai lagi jauh setelah berputar = dicuri: seluruh sesi dicabut', async () => {
    const awal = await masukPonsel();
    const putaran = await perbarui(awal.refreshToken);
    await prisma.mobileSession.updateMany({ data: { rotatedAt: new Date(Date.now() - 10 * 60_000) } });

    expect((await perbarui(awal.refreshToken)).status).toBe(401);
    const sesi = await prisma.mobileSession.findFirstOrThrow();
    expect(sesi.revokeReason).toBe('token_reuse');
    // Pemegang token yang sah pun harus login ulang, termasuk token aksesnya.
    expect((await perbarui(putaran.body.refreshToken)).status).toBe(401);
    expect((await saya(putaran.body.token)).status).toBe(401);
  });

  it('logout mencabut sesi: refresh dan token aksesnya langsung ditolak', async () => {
    const ponsel = await masukPonsel();
    const res = await request(app).post('/api/auth/logout').send({ refreshToken: ponsel.refreshToken });
    expect(res.status).toBe(204);

    expect((await perbarui(ponsel.refreshToken)).status).toBe(401);
    expect((await saya(ponsel.token)).status).toBe(401);
    // Logout ulang dengan token mati tetap 204.
    expect((await request(app).post('/api/auth/logout').send({ refreshToken: ponsel.refreshToken })).status).toBe(204);
  });

  it('ganti sandi dari ponsel: ponsel ini tetap masuk, perangkat lain keluar', async () => {
    const ini = await masukPonsel('budi@resto.id', 'Ponsel kerja');
    const lain = await masukPonsel('budi@resto.id', 'Tablet lama');

    const ganti = await request(app)
      .post('/api/auth/change-password')
      .set(auth(ini.token))
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'SandiBaru2026' });
    expect(ganti.status).toBe(200);

    expect((await saya(ini.token)).status).toBe(200);
    expect((await perbarui(ini.refreshToken)).status).toBe(200);
    expect((await saya(lain.token)).status).toBe(401);
    expect((await perbarui(lain.refreshToken)).status).toBe(401);
  });

  it('HR mengatur ulang sandi: semua sesi ponsel karyawan itu berakhir', async () => {
    await makeEmployee({ email: 'hr@resto.id', role: Role.HR_ADMIN });
    const tokenHr = await login(app, 'hr@resto.id');
    const ponsel = await masukPonsel();
    const budi = await prisma.employee.findUniqueOrThrow({ where: { email: 'budi@resto.id' } });

    expect((await request(app).post(`/api/employees/${budi.id}/reset-password`).set(auth(tokenHr)).send({})).status).toBe(200);
    expect((await saya(ponsel.token)).status).toBe(401);
    expect((await perbarui(ponsel.refreshToken)).status).toBe(401);
  });

  it('sesi kedaluwarsa atau akun nonaktif tidak bisa diperpanjang', async () => {
    const lama = await masukPonsel();
    await prisma.mobileSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await perbarui(lama.refreshToken)).status).toBe(401);

    const baru = await masukPonsel();
    await prisma.employee.update({ where: { email: 'budi@resto.id' }, data: { status: 'resigned' } });
    expect((await perbarui(baru.refreshToken)).status).toBe(403);
  });
});
