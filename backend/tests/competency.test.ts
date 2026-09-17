import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makePosition } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth, expectStatus } from './helpers/api';

const app = bikinApp();

let hrToken: string;
let budi: { id: string };
let budiToken: string;
let waiterId: string;

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  waiterId = (await makePosition('Waiter')).id;
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
  await prisma.employee.update({ where: { id: budi.id }, data: { positionId: waiterId } });
  budiToken = await login(app, 'budi@resto.id');
});


const buatKompetensi = (ubah: Record<string, unknown> = {}) =>
  request(app)
    .post('/api/competencies')
    .set(auth(hrToken))
    .send({ code: 'FOOD_SAFETY', name: 'Food Safety', maxLevel: 4, ...ubah });

/**
 * Helper penyiapan memeriksa statusnya sendiri.
 *
 * Tanpa ini, penyiapan yang gagal diam-diam baru terlihat beberapa baris
 * kemudian sebagai assertion yang membingungkan — dan pesan galatnya
 * menunjuk ke tempat yang salah.
 */
const tetapkanStandar = async (competencyId: string, requiredLevel: number) => {
  const res = await request(app)
    .put(`/api/positions/${waiterId}/competency-standards`)
    .set(auth(hrToken))
    .send({ competencyId, requiredLevel });
  expectStatus(res, 200);
  return res;
};

const nilaiKaryawan = async (competencyId: string, currentLevel: number, employeeId = budi.id) => {
  const res = await request(app)
    .put(`/api/employees/${employeeId}/competencies`)
    .set(auth(hrToken))
    .send({ competencyId, currentLevel });
  expectStatus(res, 200);
  return res;
};

describe('Kamus kompetensi', () => {
  it('membuat kompetensi dengan skala tingkatnya', async () => {
    const res = await buatKompetensi({
      levelLabels: { '1': 'Dasar', '2': 'Menengah', '3': 'Mahir', '4': 'Ahli' },
    });

    expect(res.status).toBe(201);
    expect(res.body.maxLevel).toBe(4);
    expect(res.body.levelLabels['4']).toBe('Ahli');
  });

  it('menolak kode kompetensi ganda', async () => {
    await buatKompetensi();
    expect((await buatKompetensi()).status).toBe(409);
  });

  it('karyawan boleh melihat daftar kompetensi tapi tidak membuatnya', async () => {
    expectStatus(await request(app).get('/api/competencies').set(auth(budiToken)), 200);

    const buat = await request(app)
      .post('/api/competencies')
      .set(auth(budiToken))
      .send({ code: 'PALSU', name: 'Palsu' });
    expectStatus(buat, 403);
  });
});

describe('Standar kompetensi jabatan', () => {
  it('menetapkan tingkat yang disyaratkan', async () => {
    const k = await buatKompetensi();
    const res = await tetapkanStandar(k.body.id, 3);

    expect(res.status).toBe(200);
    expect(res.body.requiredLevel).toBe(3);
  });

  it('menetapkan ulang berarti memperbarui, bukan menambah baris kedua', async () => {
    const k = await buatKompetensi();
    await tetapkanStandar(k.body.id, 2);
    await tetapkanStandar(k.body.id, 4);

    const res = await request(app)
      .get(`/api/positions/${waiterId}/competency-standards`)
      .set(auth(hrToken));

    // Dua baris yang saling bertentangan akan membuat analisis kesenjangan ambigu.
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].requiredLevel).toBe(4);
  });

  it('menolak tingkat yang melebihi skala kompetensi', async () => {
    const k = await buatKompetensi({ maxLevel: 3 });
    const res = await request(app)
      .put(`/api/positions/${waiterId}/competency-standards`)
      .set(auth(hrToken))
      .send({ competencyId: k.body.id, requiredLevel: 5 });

    expect(res.status).toBe(400);
  });
});

describe('Analisis kesenjangan kompetensi', () => {
  it('menandai syarat yang terpenuhi dan yang belum', async () => {
    const a = await buatKompetensi({ code: 'FOOD_SAFETY', name: 'Food Safety' });
    const b = await buatKompetensi({ code: 'SERVICE', name: 'Table Service' });
    await tetapkanStandar(a.body.id, 2);
    await tetapkanStandar(b.body.id, 3);

    await nilaiKaryawan(a.body.id, 3); // melebihi syarat
    await nilaiKaryawan(b.body.id, 1); // kurang 2 tingkat

    const res = await request(app)
      .get(`/api/employees/${budi.id}/competency-gap`)
      .set(auth(hrToken));

    expect(res.status).toBe(200);
    expect(res.body.totalRequired).toBe(2);
    expect(res.body.totalMet).toBe(1);
    expect(res.body.readinessPercent).toBe(50);

    const service = res.body.gaps.find((g: { competencyCode: string }) => g.competencyCode === 'SERVICE');
    expect(service).toMatchObject({ gap: 2, meets: false, currentLevel: 1 });
  });

  it('memperlakukan yang belum dinilai sebagai belum terpenuhi', async () => {
    const k = await buatKompetensi();
    await tetapkanStandar(k.body.id, 2);

    const res = await request(app)
      .get(`/api/employees/${budi.id}/competency-gap`)
      .set(auth(hrToken));

    // Kalau diabaikan, karyawan yang belum pernah dinilai akan tampak siap penuh.
    expect(res.body.readinessPercent).toBe(0);
    expect(res.body.gaps[0]).toMatchObject({ notAssessed: true, currentLevel: null });
  });

  it('menolak karyawan yang belum punya jabatan', async () => {
    await prisma.employee.update({ where: { id: budi.id }, data: { positionId: null } });

    const res = await request(app)
      .get(`/api/employees/${budi.id}/competency-gap`)
      .set(auth(hrToken));

    expect(res.status).toBe(400);
  });

  it('karyawan boleh melihat kesenjangan dirinya sendiri', async () => {
    const k = await buatKompetensi();
    await tetapkanStandar(k.body.id, 2);

    const res = await request(app)
      .get(`/api/employees/${budi.id}/competency-gap`)
      .set(auth(budiToken));

    expect(res.status).toBe(200);
  });

  it('karyawan tidak bisa melihat kesenjangan orang lain', async () => {
    const siti = await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2' });

    const res = await request(app)
      .get(`/api/employees/${siti.id}/competency-gap`)
      .set(auth(budiToken));

    expect(res.status).toBe(403);
  });

  it('laporan menyeluruh hanya merinci yang belum terpenuhi', async () => {
    const a = await buatKompetensi({ code: 'FOOD_SAFETY', name: 'Food Safety' });
    const b = await buatKompetensi({ code: 'SERVICE', name: 'Table Service' });
    await tetapkanStandar(a.body.id, 2);
    await tetapkanStandar(b.body.id, 2);
    await nilaiKaryawan(a.body.id, 2);

    const res = await request(app).get('/api/competency-gap').set(auth(hrToken));

    const baris = res.body.data.find((d: { employee: { id: string } }) => d.employee.id === budi.id);
    // Hanya yang perlu dilatih yang dirinci.
    expect(baris.unmetCompetencies).toHaveLength(1);
    expect(baris.unmetCompetencies[0].competencyCode).toBe('SERVICE');
  });
});

describe('Sertifikat karyawan', () => {
  const buatJenis = (ubah: Record<string, unknown> = {}) =>
    request(app)
      .post('/api/certification-types')
      .set(auth(hrToken))
      .send({
        code: 'FOOD_HANDLER',
        name: 'Food Handler Certificate',
        issuingOrganization: 'Dinas Kesehatan',
        validityMonths: 12,
        ...ubah,
      });

  it('menghitung masa berlaku dari jenisnya', async () => {
    const jenis = await buatJenis();

    const res = await request(app)
      .post('/api/certifications')
      .set(auth(hrToken))
      .send({
        employeeId: budi.id,
        certificationTypeId: jenis.body.id,
        issueDate: '2026-01-15',
      });

    expect(res.status).toBe(201);
    expect(res.body.expiryDate.slice(0, 10)).toBe('2027-01-15');
    expect(res.body.certificationName).toBe('Food Handler Certificate');
  });

  it('menuntut nama dan penerbit untuk sertifikat di luar daftar resmi', async () => {
    const res = await request(app)
      .post('/api/certifications')
      .set(auth(hrToken))
      .send({ employeeId: budi.id, issueDate: '2026-01-15' });

    expect(res.status).toBe(400);
  });

  it('menolak tanggal kedaluwarsa sebelum tanggal terbit', async () => {
    const res = await request(app)
      .post('/api/certifications')
      .set(auth(hrToken))
      .send({
        employeeId: budi.id,
        certificationName: 'X',
        issuingOrganization: 'Y',
        issueDate: '2026-06-01',
        expiryDate: '2026-01-01',
      });

    expect(res.status).toBe(400);
  });

  it('menghitung status dari tanggal, bukan dari kolom tersimpan', async () => {
    const jenis = await buatJenis({ validityMonths: null });

    // Terbit lama dengan kedaluwarsa yang sudah lewat.
    await request(app)
      .post('/api/certifications')
      .set(auth(hrToken))
      .send({
        employeeId: budi.id,
        certificationTypeId: jenis.body.id,
        issueDate: '2024-01-01',
        expiryDate: '2025-01-01',
      });

    const res = await request(app)
      .get(`/api/certifications?employeeId=${budi.id}`)
      .set(auth(hrToken));

    // Status tersimpan akan tetap berbunyi "valid" setelah tanggalnya lewat.
    expect(res.body.data[0].state).toBe('expired');
    expect(res.body.summary.expired).toBe(1);
  });

  it('memperingatkan sertifikat yang akan mati', async () => {
    const besokLusa = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await request(app)
      .post('/api/certifications')
      .set(auth(hrToken))
      .send({
        employeeId: budi.id,
        certificationName: 'First Aid',
        issuingOrganization: 'PMI',
        issueDate: '2026-01-01',
        expiryDate: besokLusa,
      });

    const res = await request(app)
      .get(`/api/certifications?employeeId=${budi.id}&warningDays=30`)
      .set(auth(hrToken));

    expect(res.body.data[0].state).toBe('expiring_soon');
  });

  it('pencabutan mengalahkan tanggal yang masih berlaku', async () => {
    const dibuat = await request(app)
      .post('/api/certifications')
      .set(auth(hrToken))
      .send({
        employeeId: budi.id,
        certificationName: 'First Aid',
        issuingOrganization: 'PMI',
        issueDate: '2026-01-01',
        expiryDate: '2030-01-01',
      });

    await request(app)
      .patch(`/api/certifications/${dibuat.body.id}/revoke`)
      .set(auth(hrToken))
      .send({ reason: 'Terbukti dipalsukan' });

    const res = await request(app)
      .get(`/api/certifications?employeeId=${budi.id}`)
      .set(auth(hrToken));

    expect(res.body.data[0].state).toBe('revoked');
  });

  it('menolak pencabutan ganda', async () => {
    const dibuat = await request(app)
      .post('/api/certifications')
      .set(auth(hrToken))
      .send({
        employeeId: budi.id,
        certificationName: 'First Aid',
        issuingOrganization: 'PMI',
        issueDate: '2026-01-01',
      });

    await request(app)
      .patch(`/api/certifications/${dibuat.body.id}/revoke`)
      .set(auth(hrToken))
      .send({ reason: 'Palsu' });

    const lagi = await request(app)
      .patch(`/api/certifications/${dibuat.body.id}/revoke`)
      .set(auth(hrToken))
      .send({ reason: 'Palsu lagi' });

    expect(lagi.status).toBe(409);
  });

  it('karyawan hanya melihat sertifikatnya sendiri', async () => {
    const siti = await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2' });
    for (const id of [budi.id, siti.id]) {
      await request(app)
        .post('/api/certifications')
        .set(auth(hrToken))
        .send({
          employeeId: id,
          certificationName: 'First Aid',
          issuingOrganization: 'PMI',
          issueDate: '2026-01-01',
        });
    }

    const res = await request(app).get('/api/certifications').set(auth(budiToken));

    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].employeeId).toBe(budi.id);
  });
});

describe('Integrasi pelatihan ke sertifikat', () => {
  /** Program bersertifikat, Budi ikut dan hadir. */
  const siapkan = async () => {
    const program = await request(app)
      .post('/api/training/programs')
      .set(auth(hrToken))
      .send({ code: 'HYGIENE', name: 'Hygiene', isMandatory: true, passingScore: 70 });

    await request(app)
      .post('/api/certification-types')
      .set(auth(hrToken))
      .send({
        code: 'FOOD_HANDLER',
        name: 'Food Handler Certificate',
        issuingOrganization: 'Dinas Kesehatan',
        validityMonths: 24,
        trainingProgramId: program.body.id,
      });

    const sesi = await request(app)
      .post('/api/training/sessions')
      .set(auth(hrToken))
      .send({
        programId: program.body.id,
        title: 'Hygiene Batch 1',
        trainer: 'Chef Andi',
        startDateTime: '2027-03-01T02:00:00.000Z',
        endDateTime: '2027-03-01T09:00:00.000Z',
      });

    const pendaftaran = await request(app)
      .post(`/api/training/sessions/${sesi.body.id}/register`)
      .set(auth(budiToken))
      .send({});

    await request(app)
      .post(`/api/training/sessions/${sesi.body.id}/attendance`)
      .set(auth(hrToken))
      .send({ entries: [{ registrationId: pendaftaran.body.id, attended: true }] });

    return pendaftaran.body.id as string;
  };

  it('menerbitkan sertifikat otomatis saat peserta lulus', async () => {
    const registrationId = await siapkan();

    const res = await request(app)
      .post(`/api/training/registrations/${registrationId}/evaluate`)
      .set(auth(hrToken))
      .send({ score: 85 });

    expect(res.status).toBe(200);
    // Tanpa otomatisasi, HR harus menerbitkan sertifikat satu per satu
    // untuk tiap peserta yang lulus.
    expect(res.body.issuedCertifications).toHaveLength(1);
    expect(res.body.issuedCertifications[0].certificationName).toBe('Food Handler Certificate');

    const tersimpan = await request(app)
      .get(`/api/certifications?employeeId=${budi.id}`)
      .set(auth(hrToken));
    expect(tersimpan.body.data[0].trainingRegistrationId).toBe(registrationId);
    expect(tersimpan.body.data[0].state).toBe('valid');
  });

  it('tidak menerbitkan sertifikat bagi yang gagal', async () => {
    const registrationId = await siapkan();

    const res = await request(app)
      .post(`/api/training/registrations/${registrationId}/evaluate`)
      .set(auth(hrToken))
      .send({ score: 40 });

    expect(res.body.issuedCertifications).toHaveLength(0);
    expect(await prisma.certificationRecord.count()).toBe(0);
  });

  it('memberi masa berlaku sesuai jenis sertifikatnya, bukan programnya', async () => {
    const registrationId = await siapkan();

    const res = await request(app)
      .post(`/api/training/registrations/${registrationId}/evaluate`)
      .set(auth(hrToken))
      .send({ score: 85 });

    const sertifikat = res.body.issuedCertifications[0];
    const terbit = new Date(sertifikat.issueDate);
    const mati = new Date(sertifikat.expiryDate);

    // 24 bulan dari jenis sertifikat.
    const selisihBulan =
      (mati.getUTCFullYear() - terbit.getUTCFullYear()) * 12 +
      (mati.getUTCMonth() - terbit.getUTCMonth());
    expect(selisihBulan).toBe(24);
  });

  it('program tanpa jenis sertifikat tidak menerbitkan apa pun', async () => {
    const program = await request(app)
      .post('/api/training/programs')
      .set(auth(hrToken))
      .send({ code: 'ORIENTASI', name: 'Orientasi', passingScore: null });

    const sesi = await request(app)
      .post('/api/training/sessions')
      .set(auth(hrToken))
      .send({
        programId: program.body.id,
        title: 'Orientasi',
        trainer: 'HR',
        startDateTime: '2027-03-01T02:00:00.000Z',
        endDateTime: '2027-03-01T05:00:00.000Z',
      });

    const pendaftaran = await request(app)
      .post(`/api/training/sessions/${sesi.body.id}/register`)
      .set(auth(budiToken))
      .send({});

    await request(app)
      .post(`/api/training/sessions/${sesi.body.id}/attendance`)
      .set(auth(hrToken))
      .send({ entries: [{ registrationId: pendaftaran.body.id, attended: true }] });

    const res = await request(app)
      .post(`/api/training/registrations/${pendaftaran.body.id}/evaluate`)
      .set(auth(hrToken))
      .send({});

    expect(res.body.passed).toBe(true);
    expect(res.body.issuedCertifications).toHaveLength(0);
  });
});
