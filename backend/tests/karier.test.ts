import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makePosition, makeDepartment } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth, expectStatus } from './helpers/api';

const app = bikinApp();

let hr: string;
let positionId: string;

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hr = await login(app, 'hr@resto.id');
  const dept = await makeDepartment('Kitchen');
  positionId = (await makePosition('Waiter', dept.id)).id;
});

const buatLowongan = async (ubah: Record<string, unknown> = {}, tayangkan = true) => {
  const res = await request(app)
    .post('/api/job-postings')
    .set(auth(hr))
    .send({
      title: 'Waiter Outlet Kemang',
      description: 'Melayani tamu di outlet Kemang.',
      requirements: 'Minimal SMA, ramah, bersedia shift.',
      positionId,
      openings: 2,
      location: 'Jakarta Selatan',
      salaryRangeMin: 4500000,
      salaryRangeMax: 5500000,
      ...ubah,
    });
  expectStatus(res, 201);
  if (tayangkan) {
    expectStatus(await request(app).patch(`/api/job-postings/${res.body.id}/status`).set(auth(hr)).send({ status: 'open' }), 200);
  }
  return res.body.id as string;
};

const daftarPelamar = (ubah: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/karier/daftar')
    .send({ name: 'Siti Aminah', email: 'siti@pelamar.id', phoneNumber: '081234567890', password: 'RahasiaKuat123', ...ubah });

describe('Lowongan publik', () => {
  it('bisa dibaca tanpa akun, dan hanya yang sedang dibuka', async () => {
    const terbuka = await buatLowongan();
    await buatLowongan({ title: 'Masih draft' }, false);
    await buatLowongan({ title: 'Sudah lewat', deadline: '2020-01-01' });

    const res = await request(app).get('/api/karier/lowongan');
    expectStatus(res, 200);
    const judul = (res.body.data as { id: string; title: string }[]).map((l) => l.title);
    expect(judul).toEqual(['Waiter Outlet Kemang']);
    expect(res.body.data[0].id).toBe(terbuka);
    // Saringan ikut dikirim supaya halaman publik tidak perlu memanggil API internal.
    expect(res.body.saringan.lokasi).toContain('Jakarta Selatan');
    expect(res.body.saringan.departemen[0]).toMatchObject({ name: 'Kitchen' });
  });

  it('rinciannya memuat teks berformat dan rentang gaji sebagai angka', async () => {
    const id = await buatLowongan({ descriptionHtml: '<p>Melayani <strong>tamu</strong>.</p>' });
    const res = await request(app).get(`/api/karier/lowongan/${id}`);
    expectStatus(res, 200);
    expect(res.body.descriptionHtml).toContain('<strong>tamu</strong>');
    expect(res.body.salaryRangeMin).toBe(4500000);
    expect(res.body.position.department.name).toBe('Kitchen');
  });

  it('lowongan yang ditutup tidak bisa dibuka lewat tautan langsung', async () => {
    const id = await buatLowongan({ title: 'Sudah ditutup' }, false);
    expectStatus(await request(app).get(`/api/karier/lowongan/${id}`), 404);
  });
});

describe('Akun pelamar', () => {
  it('mendaftar mengembalikan token yang bisa dipakai langsung', async () => {
    const res = await daftarPelamar();
    expectStatus(res, 201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.pelamar).toMatchObject({ email: 'siti@pelamar.id', name: 'Siti Aminah' });

    const saya = await request(app).get('/api/karier/saya').set(auth(res.body.token));
    expectStatus(saya, 200);
    expect(saya.body).toMatchObject({ email: 'siti@pelamar.id', punyaCv: false, applications: [] });
  });

  it('email ganda ditolak, dan umpan perangkap tidak membuat akun', async () => {
    expectStatus(await daftarPelamar(), 201);
    expectStatus(await daftarPelamar(), 409);

    expectStatus(await daftarPelamar({ email: 'robot@pelamar.id', situs: 'https://spam.example' }), 201);
    expect(await prisma.candidateAccount.findUnique({ where: { email: 'robot@pelamar.id' } })).toBeNull();
  });

  it('masuk dengan sandi salah dan email tak dikenal dijawab sama', async () => {
    await daftarPelamar();
    const salah = await request(app).post('/api/karier/masuk').send({ email: 'siti@pelamar.id', password: 'SalahSekali' });
    const asing = await request(app).post('/api/karier/masuk').send({ email: 'entah@pelamar.id', password: 'SalahSekali' });
    expectStatus(salah, 401);
    expectStatus(asing, 401);
    expect(salah.body.error).toBe(asing.body.error);

    const benar = await request(app).post('/api/karier/masuk').send({ email: 'siti@pelamar.id', password: 'RahasiaKuat123' });
    expectStatus(benar, 200);
    expect(benar.body.token).toBeTruthy();
  });

  it('mengganti sandi memeriksa sandi lama', async () => {
    const token = (await daftarPelamar()).body.token as string;
    expectStatus(await request(app).put('/api/karier/saya/sandi').set(auth(token)).send({ passwordLama: 'Salah123456', passwordBaru: 'SandiBaru123' }), 400);
    expectStatus(await request(app).put('/api/karier/saya/sandi').set(auth(token)).send({ passwordLama: 'RahasiaKuat123', passwordBaru: 'SandiBaru123' }), 200);
    expectStatus(await request(app).post('/api/karier/masuk').send({ email: 'siti@pelamar.id', password: 'SandiBaru123' }), 200);
  });
});

describe('Pemisahan akun pelamar dan karyawan', () => {
  it('token pelamar tidak membuka satu pun rute internal', async () => {
    const token = (await daftarPelamar()).body.token as string;
    expectStatus(await request(app).get('/api/employees').set(auth(token)), 401);
    expectStatus(await request(app).get('/api/candidates').set(auth(token)), 401);
    expectStatus(await request(app).get('/api/auth/me').set(auth(token)), 401);
  });

  it('token karyawan tidak membuka portal pelamar', async () => {
    expectStatus(await request(app).get('/api/karier/saya').set(auth(hr)), 401);
    expectStatus(await request(app).post('/api/karier/lamar').set(auth(hr)).send({ jobPostingId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' }), 401);
  });
});

describe('Melamar dari portal', () => {
  const siapkan = async () => {
    const id = await buatLowongan();
    const token = (await daftarPelamar()).body.token as string;
    return { lowonganId: id, token };
  };

  it('lamaran masuk sebagai pelamar yang tertaut ke akunnya', async () => {
    const { lowonganId, token } = await siapkan();
    const res = await request(app)
      .post('/api/karier/lamar')
      .set(auth(token))
      .send({ jobPostingId: lowonganId, expectedSalary: 5000000, coverLetter: 'Saya berpengalaman 2 tahun di kafe.' });
    expectStatus(res, 201);

    const pelamar = await prisma.candidate.findFirstOrThrow({ include: { account: true } });
    expect(pelamar).toMatchObject({ email: 'siti@pelamar.id', source: 'portal-karier', status: 'applied' });
    expect(pelamar.account?.email).toBe('siti@pelamar.id');
    expect(pelamar.coverLetter).toContain('2 tahun');
    // Catatan internal HR tidak tersentuh oleh kiriman pelamar.
    expect(pelamar.notes).toBeNull();

    // HR melihatnya di antrean seperti pelamar lain.
    const daftarHr = await request(app).get('/api/candidates').set(auth(hr));
    expectStatus(daftarHr, 200);
    expect(daftarHr.body.data).toHaveLength(1);
  });

  it('melamar dua kali di lowongan yang sama ditolak', async () => {
    const { lowonganId, token } = await siapkan();
    expectStatus(await request(app).post('/api/karier/lamar').set(auth(token)).send({ jobPostingId: lowonganId }), 201);
    expectStatus(await request(app).post('/api/karier/lamar').set(auth(token)).send({ jobPostingId: lowonganId }), 409);
  });

  it('lowongan yang belum tayang tidak bisa dilamar', async () => {
    const tertutup = await buatLowongan({ title: 'Belum tayang' }, false);
    const token = (await daftarPelamar()).body.token as string;
    expectStatus(await request(app).post('/api/karier/lamar').set(auth(token)).send({ jobPostingId: tertutup }), 404);
  });

  it('dashboard menampilkan lamaran beserta tahapnya, tanpa catatan internal', async () => {
    const { lowonganId, token } = await siapkan();
    expectStatus(await request(app).post('/api/karier/lamar').set(auth(token)).send({ jobPostingId: lowonganId }), 201);

    const pelamar = await prisma.candidate.findFirstOrThrow();
    expectStatus(
      await request(app).patch(`/api/candidates/${pelamar.id}/stage`).set(auth(hr)).send({ stage: 'screening', note: 'CV cocok' }),
      200
    );
    await prisma.candidate.update({ where: { id: pelamar.id }, data: { notes: 'Rahasia HR', rejectionReason: 'jangan bocor' } });

    const saya = await request(app).get('/api/karier/saya').set(auth(token));
    expectStatus(saya, 200);
    expect(saya.body.applications).toHaveLength(1);
    expect(saya.body.applications[0]).toMatchObject({ status: 'screening' });
    expect(saya.body.applications[0].stageHistory.map((h: { toStage: string }) => h.toStage)).toContain('screening');
    const utuh = JSON.stringify(saya.body);
    expect(utuh).not.toContain('Rahasia HR');
    expect(utuh).not.toContain('jangan bocor');
    // Catatan tahap dari HR juga bukan konsumsi pelamar.
    expect(utuh).not.toContain('CV cocok');
  });

  it('lamaran orang lain tidak bisa dibuka', async () => {
    const { lowonganId, token } = await siapkan();
    expectStatus(await request(app).post('/api/karier/lamar').set(auth(token)).send({ jobPostingId: lowonganId }), 201);
    const pelamar = await prisma.candidate.findFirstOrThrow();

    const lain = (await daftarPelamar({ email: 'budi@pelamar.id', name: 'Budi' })).body.token as string;
    expectStatus(await request(app).get(`/api/karier/lamaran/${pelamar.id}`).set(auth(lain)), 404);
    expectStatus(await request(app).get(`/api/karier/lamaran/${pelamar.id}`).set(auth(token)), 200);
  });
});
