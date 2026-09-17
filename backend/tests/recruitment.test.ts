import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makeDepartment, makePosition } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth } from './helpers/api';

const app = bikinApp();

let hrToken: string;
let budiToken: string;
let budi: { id: string };
let positionId: string;

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
  budiToken = await login(app, 'budi@resto.id');
  positionId = (await makePosition('Waiter')).id;
});


const buatLowongan = (ubah: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/job-postings')
    .set(auth(hrToken))
    .send({
      title: 'Waiter',
      description: 'Melayani tamu restoran',
      requirements: 'Minimal SMA, ramah',
      positionId,
      openings: 1,
      ...ubah,
    });

const terbitkan = (id: string) =>
  request(app).patch(`/api/job-postings/${id}/status`).set(auth(hrToken)).send({ status: 'open' });

const lamar = (jobPostingId: string, ubah: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/candidates')
    .set(auth(hrToken))
    .send({
      jobPostingId,
      name: 'Siti Aminah',
      email: 'siti@pelamar.id',
      source: 'referral',
      ...ubah,
    });

const pindahTahap = (id: string, stage: string, extra: Record<string, unknown> = {}) =>
  request(app).patch(`/api/candidates/${id}/stage`).set(auth(hrToken)).send({ stage, ...extra });

/** Membawa pelamar sampai tahap offer, siap diterima. */
const sampaiOffer = async () => {
  const lowongan = await buatLowongan();
  await terbitkan(lowongan.body.id);
  const pelamar = await lamar(lowongan.body.id);

  await pindahTahap(pelamar.body.id, 'screening');
  await pindahTahap(pelamar.body.id, 'interview');
  await pindahTahap(pelamar.body.id, 'offer');

  return { jobPostingId: lowongan.body.id as string, candidateId: pelamar.body.id as string };
};

describe('Lowongan', () => {
  it('dibuat sebagai draft, belum langsung terbit', async () => {
    const res = await buatLowongan();

    expect(res.status).toBe(201);
    // Supaya bisa disunting dulu sebelum dilihat pelamar.
    expect(res.body.status).toBe('draft');
    expect(res.body.publishedAt).toBeNull();
  });

  it('mencatat waktu terbit saat dibuka', async () => {
    const lowongan = await buatLowongan();
    const res = await terbitkan(lowongan.body.id);

    expect(res.body.status).toBe('open');
    expect(res.body.publishedAt).not.toBeNull();
  });

  it('menyembunyikan draft dari karyawan biasa', async () => {
    await buatLowongan();

    const hr = await request(app).get('/api/job-postings').set(auth(hrToken));
    expect(hr.body.pagination.total).toBe(1);

    const karyawan = await request(app).get('/api/job-postings').set(auth(budiToken));
    expect(karyawan.body.pagination.total).toBe(0);
  });

  it('menampilkan lowongan terbuka kepada karyawan, untuk referral', async () => {
    const lowongan = await buatLowongan();
    await terbitkan(lowongan.body.id);

    const res = await request(app).get('/api/job-postings').set(auth(budiToken));
    expect(res.body.pagination.total).toBe(1);
  });

  it('menolak rentang gaji yang terbalik', async () => {
    const res = await buatLowongan({ salaryRangeMin: 8_000_000, salaryRangeMax: 4_000_000 });
    expect(res.status).toBe(400);
  });

  it('karyawan biasa tidak boleh membuat lowongan', async () => {
    const res = await request(app)
      .post('/api/job-postings')
      .set(auth(budiToken))
      .send({ title: 'X', description: 'X', requirements: 'X', positionId });

    expect(res.status).toBe(403);
  });

  it('menolak posisi yang tidak ada', async () => {
    const res = await buatLowongan({ positionId: '01ZZZZZZZZZZZZZZZZZZZZZZZZ' });
    expect(res.status).toBe(404);
  });
});

describe('Lamaran', () => {
  it('menolak lamaran ke lowongan yang belum terbit', async () => {
    const lowongan = await buatLowongan();
    const res = await lamar(lowongan.body.id);

    expect(res.status).toBe(409);
  });

  it('mencatat baris riwayat pertama saat lamaran masuk', async () => {
    const lowongan = await buatLowongan();
    await terbitkan(lowongan.body.id);
    const res = await lamar(lowongan.body.id);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('applied');
    // Tanpa titik awal ini, corong rekrutmen tidak punya dasar hitung.
    expect(res.body.stageHistory).toHaveLength(1);
    expect(res.body.stageHistory[0].fromStage).toBeNull();
    expect(res.body.stageHistory[0].toStage).toBe('applied');
  });

  it('menolak lamaran ganda ke lowongan yang sama', async () => {
    const lowongan = await buatLowongan();
    await terbitkan(lowongan.body.id);
    await lamar(lowongan.body.id);

    const res = await lamar(lowongan.body.id);

    // Dua jalur seleksi paralel untuk orang yang sama hampir selalu tak disengaja.
    expect(res.status).toBe(409);
    expect(res.body.candidateId).toBeDefined();
  });

  it('mengizinkan orang yang sama melamar lowongan berbeda', async () => {
    const satu = await buatLowongan();
    await terbitkan(satu.body.id);
    await lamar(satu.body.id);

    const dua = await buatLowongan({ title: 'Kasir' });
    await terbitkan(dua.body.id);
    const res = await lamar(dua.body.id);

    expect(res.status).toBe(201);
  });
});

describe('Perpindahan tahap', () => {
  const siapkan = async () => {
    const lowongan = await buatLowongan();
    await terbitkan(lowongan.body.id);
    const pelamar = await lamar(lowongan.body.id);
    return pelamar.body.id as string;
  };

  it('mencatat tiap perpindahan beserta tahap asalnya', async () => {
    const id = await siapkan();
    await pindahTahap(id, 'screening');
    const res = await pindahTahap(id, 'interview');

    const riwayat = res.body.candidate.stageHistory;
    expect(riwayat).toHaveLength(3);
    expect(riwayat[2]).toMatchObject({ fromStage: 'screening', toStage: 'interview' });
  });

  it('menolak lompatan tahap yang tidak masuk akal', async () => {
    const id = await siapkan();
    const res = await pindahTahap(id, 'offer');

    expect(res.status).toBe(409);
  });

  it('menolak penetapan langsung ke "hired"', async () => {
    const id = await siapkan();
    await pindahTahap(id, 'screening');
    await pindahTahap(id, 'interview');
    await pindahTahap(id, 'offer');

    const res = await pindahTahap(id, 'hired');

    // Kalau lolos, akan ada pelamar diterima tanpa data karyawan.
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('proses penerimaan');
  });

  it('menuntut alasan saat menolak pelamar', async () => {
    const id = await siapkan();

    const tanpa = await pindahTahap(id, 'rejected');
    expect(tanpa.status).toBe(400);

    const dengan = await pindahTahap(id, 'rejected', { rejectionReason: 'Pengalaman kurang' });
    expect(dengan.status).toBe(200);
    expect(dengan.body.candidate.rejectionReason).toBe('Pengalaman kurang');
  });

  it('mengizinkan pelamar yang ditolak dibuka kembali', async () => {
    const id = await siapkan();
    await pindahTahap(id, 'rejected', { rejectionReason: 'Belum cocok' });

    const res = await pindahTahap(id, 'screening');
    expect(res.status).toBe(200);
  });
});

describe('Penerimaan pelamar', () => {
  it('membuat data karyawan dan menautkannya ke pelamar', async () => {
    const { candidateId } = await sampaiOffer();
    const dapur = await makeDepartment('Kitchen');

    const res = await request(app)
      .post(`/api/candidates/${candidateId}/hire`)
      .set(auth(hrToken))
      .send({ nik: 'EMP-BARU', joinDate: '2026-10-01', departmentId: dapur.id });

    expect(res.status).toBe(201);
    expect(res.body.employee.nik).toBe('EMP-BARU');
    expect(res.body.candidate.status).toBe('hired');
    // Jejak dari lamaran sampai menjadi karyawan tidak boleh terputus.
    expect(res.body.candidate.hiredEmployeeId).toBe(res.body.employee.id);
  });

  it('membuat karyawan tanpa password, akun diaktifkan terpisah', async () => {
    const { candidateId } = await sampaiOffer();

    const res = await request(app)
      .post(`/api/candidates/${candidateId}/hire`)
      .set(auth(hrToken))
      .send({ nik: 'EMP-BARU', joinDate: '2026-10-01' });

    const karyawan = await prisma.employee.findUniqueOrThrow({
      where: { id: res.body.employee.id },
    });
    expect(karyawan.password).toBeNull();
    expect(karyawan.status).toBe('probation');
  });

  it('mewarisi posisi dari lowongannya', async () => {
    const { candidateId } = await sampaiOffer();

    const res = await request(app)
      .post(`/api/candidates/${candidateId}/hire`)
      .set(auth(hrToken))
      .send({ nik: 'EMP-BARU', joinDate: '2026-10-01' });

    const karyawan = await prisma.employee.findUniqueOrThrow({
      where: { id: res.body.employee.id },
    });
    expect(karyawan.positionId).toBe(positionId);
  });

  it('menolak penerimaan dari tahap selain offer', async () => {
    const lowongan = await buatLowongan();
    await terbitkan(lowongan.body.id);
    const pelamar = await lamar(lowongan.body.id);

    const res = await request(app)
      .post(`/api/candidates/${pelamar.body.id}/hire`)
      .set(auth(hrToken))
      .send({ nik: 'EMP-BARU', joinDate: '2026-10-01' });

    expect(res.status).toBe(409);
  });

  it('menutup lowongan otomatis ketika kuota terpenuhi', async () => {
    const { jobPostingId, candidateId } = await sampaiOffer();

    const res = await request(app)
      .post(`/api/candidates/${candidateId}/hire`)
      .set(auth(hrToken))
      .send({ nik: 'EMP-BARU', joinDate: '2026-10-01' });

    expect(res.body.jobPostingFilled).toBe(true);

    const lowongan = await prisma.jobPosting.findUniqueOrThrow({ where: { id: jobPostingId } });
    expect(lowongan.status).toBe('filled');
  });

  it('tidak menutup lowongan yang kuotanya belum terpenuhi', async () => {
    const lowongan = await buatLowongan({ openings: 3 });
    await terbitkan(lowongan.body.id);
    const pelamar = await lamar(lowongan.body.id);
    await pindahTahap(pelamar.body.id, 'screening');
    await pindahTahap(pelamar.body.id, 'interview');
    await pindahTahap(pelamar.body.id, 'offer');

    const res = await request(app)
      .post(`/api/candidates/${pelamar.body.id}/hire`)
      .set(auth(hrToken))
      .send({ nik: 'EMP-BARU', joinDate: '2026-10-01' });

    expect(res.body.jobPostingFilled).toBe(false);
  });

  it('tidak menyisakan karyawan setengah jadi bila NIK sudah terpakai', async () => {
    const { candidateId } = await sampaiOffer();
    const sebelum = await prisma.employee.count();

    const res = await request(app)
      .post(`/api/candidates/${candidateId}/hire`)
      .set(auth(hrToken))
      .send({ nik: 'EMP-1', joinDate: '2026-10-01' }); // NIK milik Budi

    expect(res.status).toBe(409);
    expect(await prisma.employee.count()).toBe(sebelum);

    const pelamar = await prisma.candidate.findUniqueOrThrow({ where: { id: candidateId } });
    // Transaksi dibatalkan utuh: tahapnya tidak ikut berubah.
    expect(pelamar.status).toBe('offer');
    expect(budi.id).toBeTruthy();
  });
});

describe('Wawancara', () => {
  const siapkanWawancara = async () => {
    const lowongan = await buatLowongan();
    await terbitkan(lowongan.body.id);
    const pelamar = await lamar(lowongan.body.id);
    await pindahTahap(pelamar.body.id, 'screening');

    const res = await request(app)
      .post('/api/interviews')
      .set(auth(hrToken))
      .send({
        candidateId: pelamar.body.id,
        interviewerId: budi.id,
        stage: 'user',
        round: 1,
        scheduledDateTime: '2026-10-05T03:00:00.000Z',
      });

    return { interviewId: res.body.id as string, candidateId: pelamar.body.id as string, res };
  };

  it('menjadwalkan wawancara dengan tahap dan ronde', async () => {
    const { res } = await siapkanWawancara();

    expect(res.status).toBe(201);
    expect(res.body.stage).toBe('user');
    expect(res.body.round).toBe(1);
    expect(res.body.status).toBe('scheduled');
  });

  it('menolak menjadwalkan wawancara untuk pelamar yang sudah ditolak', async () => {
    const lowongan = await buatLowongan();
    await terbitkan(lowongan.body.id);
    const pelamar = await lamar(lowongan.body.id);
    await pindahTahap(pelamar.body.id, 'rejected', { rejectionReason: 'Tidak cocok' });

    const res = await request(app)
      .post('/api/interviews')
      .set(auth(hrToken))
      .send({
        candidateId: pelamar.body.id,
        interviewerId: budi.id,
        scheduledDateTime: '2026-10-05T03:00:00.000Z',
      });

    expect(res.status).toBe(409);
  });

  it('menuntut hasil saat wawancara dinyatakan selesai', async () => {
    const { interviewId } = await siapkanWawancara();

    const tanpa = await request(app)
      .patch(`/api/interviews/${interviewId}/feedback`)
      .set(auth(budiToken))
      .send({ status: 'completed', notes: 'Cukup baik' });

    // Wawancara selesai tanpa kesimpulan tidak berguna bagi tahap berikutnya.
    expect(tanpa.status).toBe(400);

    const dengan = await request(app)
      .patch(`/api/interviews/${interviewId}/feedback`)
      .set(auth(budiToken))
      .send({ status: 'completed', result: 'pass', score: 85 });

    expect(dengan.status).toBe(200);
    expect(dengan.body.result).toBe('pass');
  });

  it('hanya pewawancara yang ditugaskan yang bisa menilai', async () => {
    const { interviewId } = await siapkanWawancara();
    await makeEmployee({ email: 'lain@resto.id', nik: 'EMP-9' });
    const lainToken = await login(app, 'lain@resto.id');

    const res = await request(app)
      .patch(`/api/interviews/${interviewId}/feedback`)
      .set(auth(lainToken))
      .send({ status: 'completed', result: 'pass' });

    expect(res.status).toBe(403);
  });

  it('menolak penilaian ganda', async () => {
    const { interviewId } = await siapkanWawancara();
    await request(app)
      .patch(`/api/interviews/${interviewId}/feedback`)
      .set(auth(budiToken))
      .send({ status: 'completed', result: 'pass' });

    const res = await request(app)
      .patch(`/api/interviews/${interviewId}/feedback`)
      .set(auth(budiToken))
      .send({ status: 'completed', result: 'fail' });

    expect(res.status).toBe(409);
  });

  it('pewawancara hanya melihat wawancara yang ditugaskan kepadanya', async () => {
    await siapkanWawancara();
    await makeEmployee({ email: 'lain@resto.id', nik: 'EMP-9' });
    const lainToken = await login(app, 'lain@resto.id');

    const milikBudi = await request(app).get('/api/interviews').set(auth(budiToken));
    expect(milikBudi.body.pagination.total).toBe(1);

    const milikLain = await request(app).get('/api/interviews').set(auth(lainToken));
    expect(milikLain.body.pagination.total).toBe(0);
  });
});

describe('Laporan corong rekrutmen', () => {
  it('menghitung berapa pelamar yang PERNAH mencapai tiap tahap', async () => {
    const lowongan = await buatLowongan({ openings: 5 });
    await terbitkan(lowongan.body.id);

    const a = await lamar(lowongan.body.id, { email: 'a@pelamar.id', name: 'A' });
    const b = await lamar(lowongan.body.id, { email: 'b@pelamar.id', name: 'B' });
    await lamar(lowongan.body.id, { email: 'c@pelamar.id', name: 'C' });

    await pindahTahap(a.body.id, 'screening');
    await pindahTahap(a.body.id, 'interview');
    await pindahTahap(b.body.id, 'screening');
    // A kemudian ditolak, tapi tetap PERNAH mencapai tahap interview.
    await pindahTahap(a.body.id, 'rejected', { rejectionReason: 'Gagal wawancara' });

    const hariIni = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/recruitment/funnel?startDate=${hariIni}&endDate=${hariIni}`)
      .set(auth(hrToken));

    expect(res.status).toBe(200);
    const cari = (tahap: string) =>
      res.body.funnel.find((f: { stage: string }) => f.stage === tahap).reached;

    expect(cari('applied')).toBe(3);
    expect(cari('screening')).toBe(2);
    // Status A sekarang 'rejected', tapi ia tetap terhitung pernah interview.
    expect(cari('interview')).toBe(1);
    expect(res.body.rejected).toBe(1);
  });

  it('mengelompokkan pelamar berdasarkan sumbernya', async () => {
    const lowongan = await buatLowongan({ openings: 5 });
    await terbitkan(lowongan.body.id);

    await lamar(lowongan.body.id, { email: 'a@pelamar.id', source: 'referral' });
    await lamar(lowongan.body.id, { email: 'b@pelamar.id', source: 'jobstreet' });
    await lamar(lowongan.body.id, { email: 'c@pelamar.id', source: 'referral' });

    const hariIni = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/recruitment/funnel?startDate=${hariIni}&endDate=${hariIni}`)
      .set(auth(hrToken));

    const referral = res.body.bySource.find((s: { source: string }) => s.source === 'referral');
    expect(referral.applied).toBe(2);
  });

  it('menolak rentang tanggal terbalik', async () => {
    const res = await request(app)
      .get('/api/recruitment/funnel?startDate=2026-10-10&endDate=2026-10-01')
      .set(auth(hrToken));

    expect(res.status).toBe(400);
  });

  it('karyawan biasa tidak boleh melihat laporan rekrutmen', async () => {
    const hariIni = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/recruitment/funnel?startDate=${hariIni}&endDate=${hariIni}`)
      .set(auth(budiToken));

    expect(res.status).toBe(403);
  });
});
