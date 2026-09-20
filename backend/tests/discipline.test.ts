import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makeDepartment } from './helpers/db';
import { login, auth, expectStatus } from './helpers/api';
import { bikinApp } from './helpers/app';
import { tungguAuditSelesai } from '../src/services/audit/record';

const app = bikinApp();

let hrToken: string;
let dapur: { id: string };
let frontOffice: { id: string };
let manajerDapur: { id: string };
let manajerDapurToken: string;
let manajerFO: { id: string };
let manajerFOToken: string;
let budi: { id: string };
let budiToken: string;
let siti: { id: string };
let sitiToken: string;

beforeEach(async () => {
  await resetDatabase();
  dapur = await makeDepartment('Kitchen');
  frontOffice = await makeDepartment('Front Office');
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  manajerDapur = await makeEmployee({ email: 'chef@resto.id', nik: 'MGR-1', role: Role.MANAGER, departmentId: dapur.id });
  manajerDapurToken = await login(app, 'chef@resto.id');
  manajerFO = await makeEmployee({ email: 'fo@resto.id', nik: 'MGR-2', role: Role.MANAGER, departmentId: frontOffice.id });
  manajerFOToken = await login(app, 'fo@resto.id');
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1', departmentId: dapur.id });
  budiToken = await login(app, 'budi@resto.id');
  siti = await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2', departmentId: dapur.id });
  sitiToken = await login(app, 'siti@resto.id');
});

const keluhan = (token: string, ubah: Record<string, unknown> = {}) =>
  request(app).post('/api/complaints').set(auth(token)).send({
    title: 'Jadwal shift berubah mendadak',
    description: 'Jadwal diubah H-1 tanpa pemberitahuan, tiga kali dalam sebulan.',
    ...ubah,
  });

const disiplin = (token: string, employeeId: string, ubah: Record<string, unknown> = {}) =>
  request(app).post('/api/disciplinary-actions').set(auth(token)).send({
    employeeId,
    title: 'Terlambat berulang',
    description: 'Terlambat lebih dari 30 menit sebanyak lima kali dalam dua minggu.',
    severity: 'sp1',
    ...ubah,
  });

describe('Keluhan', () => {
  it('bisa diajukan siapa pun, tentang diri sendiri secara bawaan', async () => {
    const res = await keluhan(budiToken);

    expectStatus(res, 201);
    expect(res.body.type).toBe('complaint');
    expect(res.body.status).toBe('open');
    expect(res.body.employeeId).toBe(budi.id);
    expect(res.body.reportedById).toBe(budi.id);
  });

  it('subjek keluhan TIDAK bisa melihat keluhan tentang dirinya', async () => {
    // Kalau manajer yang dikeluhkan bisa membaca keluhannya selagi ditinjau,
    // tidak akan ada yang berani mengeluh.
    const res = await keluhan(budiToken, { employeeId: manajerDapur.id, title: 'Perlakuan tidak adil dari atasan' });
    expectStatus(res, 201);

    const daftar = await request(app).get('/api/cases').set(auth(manajerDapurToken));
    expect(daftar.body.data).toHaveLength(0);

    // 404, bukan 403: keberadaannya pun tidak boleh bocor.
    const detail = await request(app).get(`/api/cases/${res.body.id}`).set(auth(manajerDapurToken));
    expect(detail.status).toBe(404);
  });

  it('karyawan biasa yang dikeluhkan juga tidak melihatnya', async () => {
    // Aturan untuk manajer dan karyawan biasa ada di cabang kode yang
    // berbeda; keduanya harus diuji terpisah.
    const res = await keluhan(budiToken, { employeeId: siti.id, title: 'Rekan kerja sering meninggalkan pos' });
    expectStatus(res, 201);

    const daftar = await request(app).get('/api/cases').set(auth(sitiToken));
    expect(daftar.body.data).toHaveLength(0);
    expect((await request(app).get(`/api/cases/${res.body.id}`).set(auth(sitiToken))).status).toBe(404);
  });

  it('pelapor melihat keluhannya sendiri, karyawan lain tidak', async () => {
    const res = await keluhan(budiToken);

    expect((await request(app).get(`/api/cases/${res.body.id}`).set(auth(budiToken))).status).toBe(200);
    expect((await request(app).get(`/api/cases/${res.body.id}`).set(auth(sitiToken))).status).toBe(404);
  });

  it('manajer tidak bisa menindaklanjuti keluhan, walau di departemennya', async () => {
    const res = await keluhan(budiToken);

    const ubah = await request(app)
      .patch(`/api/cases/${res.body.id}/status`)
      .set(auth(manajerDapurToken))
      .send({ status: 'under_review' });

    expect(ubah.status).toBe(403);
  });

  it('HR menindaklanjuti dan menutup dengan catatan', async () => {
    const res = await keluhan(budiToken);

    expectStatus(
      await request(app).patch(`/api/cases/${res.body.id}/status`).set(auth(hrToken)).send({ status: 'under_review' }),
      200
    );
    const selesai = await request(app)
      .patch(`/api/cases/${res.body.id}/status`)
      .set(auth(hrToken))
      .send({ status: 'resolved', resolutionNotes: 'Jadwal kini diumumkan minimal H-3.' });

    expectStatus(selesai, 200);
    expect(selesai.body.resolvedAt).not.toBeNull();
    expect(selesai.body.handledBy.nik).toBe('HR-1');
  });

  it('menolak menutup tanpa catatan penyelesaian', async () => {
    const res = await keluhan(budiToken);

    const tutup = await request(app)
      .patch(`/api/cases/${res.body.id}/status`)
      .set(auth(hrToken))
      .send({ status: 'dismissed' });

    // Keluhan yang ditolak tanpa alasan tertulis sama saja tidak pernah dibaca.
    expect(tutup.status).toBe(400);
  });

  it('kasus yang sudah ditutup tidak bisa dibuka lagi', async () => {
    const res = await keluhan(budiToken);
    await request(app).patch(`/api/cases/${res.body.id}/status`).set(auth(hrToken)).send({ status: 'resolved', resolutionNotes: 'Selesai.' });

    const buka = await request(app)
      .patch(`/api/cases/${res.body.id}/status`)
      .set(auth(hrToken))
      .send({ status: 'under_review' });

    expect(buka.status).toBe(409);
  });
});

describe('Tindakan disiplin', () => {
  it('manajer memberi SP di departemennya sendiri', async () => {
    const res = await disiplin(manajerDapurToken, budi.id);

    expectStatus(res, 201);
    expect(res.body.severity).toBe('sp1');
    expect(res.body.reportedById).toBe(manajerDapur.id);
  });

  it('manajer tidak bisa memberi SP ke departemen lain', async () => {
    const res = await disiplin(manajerFOToken, budi.id);

    expect(res.status).toBe(403);
  });

  it('subjek BERHAK melihat tindakan disiplin terhadap dirinya', async () => {
    // Surat peringatan yang tidak disampaikan tidak sah (UU 13/2003 ps. 161).
    const res = await disiplin(hrToken, budi.id);

    const detail = await request(app).get(`/api/cases/${res.body.id}`).set(auth(budiToken));
    expectStatus(detail, 200);
    expect(detail.body.severity).toBe('sp1');
  });

  it('rekan sedepartemen tidak melihat SP orang lain', async () => {
    const res = await disiplin(hrToken, budi.id);

    expect((await request(app).get(`/api/cases/${res.body.id}`).set(auth(sitiToken))).status).toBe(404);
  });

  it('manajer melihat SP di departemennya, tidak di departemen lain', async () => {
    await disiplin(hrToken, budi.id);

    const dapurLihat = await request(app).get('/api/cases?type=disciplinary_action').set(auth(manajerDapurToken));
    expect(dapurLihat.body.data).toHaveLength(1);

    const foLihat = await request(app).get('/api/cases?type=disciplinary_action').set(auth(manajerFOToken));
    expect(foLihat.body.data).toHaveLength(0);
  });

  it('memperingatkan SP3 tanpa SP1/SP2 sebelumnya, tanpa melarang', async () => {
    // Untuk pelanggaran berat UU mengizinkan langsung, tapi tanpa riwayat
    // SP, PHK-nya batal di pengadilan — jadi diperingatkan, bukan ditolak.
    const res = await disiplin(hrToken, budi.id, { severity: 'sp3' });

    expectStatus(res, 201);
    expect(res.body.warning).toContain('SP3');
  });

  it('tidak memperingatkan SP3 bila SP1 sudah ada', async () => {
    await disiplin(hrToken, budi.id, { severity: 'sp1' });

    const res = await disiplin(hrToken, budi.id, { severity: 'sp3', title: 'Pelanggaran berulang' });

    expectStatus(res, 201);
    expect(res.body.warning).toBeUndefined();
  });

  it('menolak memberi SP pada diri sendiri', async () => {
    const res = await disiplin(manajerDapurToken, manajerDapur.id);

    expect(res.status).toBe(400);
  });

  it('karyawan biasa tidak bisa memberi SP', async () => {
    const res = await disiplin(budiToken, siti.id);

    expect(res.status).toBe(403);
  });

  it('mencatat pembacaan rekam disiplin di jejak audit', async () => {
    const res = await disiplin(hrToken, budi.id);
    await tungguAuditSelesai();
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "AuditLog" RESTART IDENTITY CASCADE');

    await request(app).get(`/api/cases/${res.body.id}`).set(auth(manajerDapurToken));
    await tungguAuditSelesai();

    const jejak = await prisma.auditLog.findFirst({ where: { action: 'discipline.case.read' } });
    expect(jejak).not.toBeNull();
    expect(jejak!.actorEmail).toBe('chef@resto.id');
  });
});
