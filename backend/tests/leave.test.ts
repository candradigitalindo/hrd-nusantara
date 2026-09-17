import request from 'supertest';
import { Role } from '@prisma/client';
import {
  prisma,
  resetDatabase,
  makeEmployee,
  makeDepartment,
  makeLeaveType,
  makeLeaveBalance,
  makeHoliday,
} from './helpers/db';
import { login, auth } from './helpers/api';
import { bikinApp } from './helpers/app';

const app = bikinApp();

// 2026-03-02 Senin, 2026-03-06 Jumat, 2026-03-07 Sabtu.
const SENIN = '2026-03-02';
const SELASA = '2026-03-03';
const RABU = '2026-03-04';
const JUMAT = '2026-03-06';
const SABTU = '2026-03-07';
const MINGGU = '2026-03-08';

let hrToken: string;
let budiToken: string;
let budi: { id: string };
let tipeId: string;

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
  budiToken = await login(app, 'budi@resto.id');
  tipeId = (await makeLeaveType({ code: 'annual', name: 'Cuti Tahunan' })).id;
  await makeLeaveBalance({ employeeId: budi.id, leaveTypeId: tipeId, year: 2026, entitledDays: 12 });
});


const ajukan = (body: Record<string, unknown>, token = budiToken) =>
  request(app).post('/api/leaves').set(auth(token)).send(body);

describe('POST /api/leaves', () => {
  it('mengajukan cuti dan menghitung hari kerjanya', async () => {
    const res = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: JUMAT });

    expect(res.status).toBe(201);
    expect(res.body.totalDays).toBe(5);
    expect(res.body.status).toBe('pending');
    expect(res.body.employeeId).toBe(budi.id);
  });

  it('hanya melewatkan hari Minggu pada pola kantor Senin-Sabtu', async () => {
    // Jumat sampai Senin berikutnya: Jumat, Sabtu, Senin dihitung — Minggu tidak.
    const res = await ajukan({ leaveTypeId: tipeId, startDate: JUMAT, endDate: '2026-03-09' });

    expect(res.status).toBe(201);
    expect(res.body.totalDays).toBe(3);
    expect(res.body.breakdown.restDays).toBe(1);
    expect(res.body.workPattern.type).toBe('fixed');
  });

  it('menghitung hari Sabtu sebagai hari kerja', async () => {
    // Senin sampai Sabtu penuh = 6 hari kerja, bukan 5.
    const res = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: SABTU });

    expect(res.body.totalDays).toBe(6);
  });

  it('tidak menghitung hari libur', async () => {
    await makeHoliday(RABU, 'Nyepi');

    const res = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: JUMAT });

    expect(res.body.totalDays).toBe(4);
    expect(res.body.breakdown.publicHolidayDays).toBe(1);
  });

  it('menolak pengajuan melebihi saldo', async () => {
    const res = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: '2026-03-27' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Saldo cuti tidak mencukupi');
    expect(res.body.details.tersedia).toBe(12);
  });

  it('memperhitungkan pengajuan yang masih menunggu saat mengecek saldo', async () => {
    // 5 hari diajukan lebih dulu, menyisakan 7.
    await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: JUMAT });

    // 10 hari berikutnya harus ditolak walau belum ada yang disetujui.
    const res = await ajukan({
      leaveTypeId: tipeId,
      startDate: '2026-04-06',
      endDate: '2026-04-17',
    });

    expect(res.status).toBe(400);
    expect(res.body.details.menungguPersetujuan).toBe(5);
  });

  it('menolak tanggal yang bertabrakan dengan pengajuan lain', async () => {
    await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: JUMAT });

    const res = await ajukan({ leaveTypeId: tipeId, startDate: RABU, endDate: '2026-03-10' });

    expect(res.status).toBe(409);
    expect(res.body.conflictingLeaveId).toBeDefined();
  });

  it('menolak rentang yang seluruhnya hari istirahat', async () => {
    // Minggu saja: tidak ada hari kerja yang dipotong.
    const res = await ajukan({ leaveTypeId: tipeId, startDate: MINGGU, endDate: MINGGU });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('hari kerja');
  });

  it('menolak tanggal selesai lebih awal dari tanggal mulai', async () => {
    const res = await ajukan({ leaveTypeId: tipeId, startDate: JUMAT, endDate: SENIN });
    expect(res.status).toBe(400);
  });

  it('menolak jenis cuti yang belum punya saldo', async () => {
    const lain = await makeLeaveType({ code: 'besar', name: 'Cuti Besar' });

    const res = await ajukan({ leaveTypeId: lain.id, startDate: SENIN, endDate: SENIN });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('belum ditetapkan');
  });

  it('mengizinkan jenis cuti yang tidak memotong saldo tanpa perlu saldo', async () => {
    const sakit = await makeLeaveType({ code: 'sick', name: 'Cuti Sakit', deductsBalance: false });

    const res = await ajukan({ leaveTypeId: sakit.id, startDate: SENIN, endDate: SENIN });

    expect(res.status).toBe(201);
  });

  it('menuntut lampiran bila jenis cutinya mensyaratkan', async () => {
    const sakit = await makeLeaveType({
      code: 'sick_long',
      name: 'Cuti Sakit Panjang',
      deductsBalance: false,
      requiresAttachment: true,
    });

    const tanpa = await ajukan({ leaveTypeId: sakit.id, startDate: SENIN, endDate: SENIN });
    expect(tanpa.status).toBe(400);

    const dengan = await ajukan({
      leaveTypeId: sakit.id,
      startDate: SENIN,
      endDate: SENIN,
      attachmentUrl: 'https://arsip.internal/surat-dokter.pdf',
    });
    expect(dengan.status).toBe(201);
  });

  it('menghormati batas hari berturut-turut', async () => {
    const haid = await makeLeaveType({
      code: 'menstrual',
      name: 'Cuti Haid',
      deductsBalance: false,
      maxConsecutiveDays: 2,
    });

    const res = await ajukan({ leaveTypeId: haid.id, startDate: SENIN, endDate: JUMAT });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('maksimal 2 hari');
  });

  it('menolak jenis cuti yang dibatasi jenis kelamin', async () => {
    const haid = await makeLeaveType({
      code: 'menstrual',
      name: 'Cuti Haid',
      deductsBalance: false,
      genderRestriction: 'female',
    });
    await prisma.employee.update({ where: { id: budi.id }, data: { gender: 'male' } });

    const res = await ajukan({ leaveTypeId: haid.id, startDate: SENIN, endDate: SENIN });

    expect(res.status).toBe(403);
  });

  it('meminta HR melengkapi data bila jenis kelamin belum terisi', async () => {
    const haid = await makeLeaveType({
      code: 'menstrual',
      name: 'Cuti Haid',
      deductsBalance: false,
      genderRestriction: 'female',
    });

    const res = await ajukan({ leaveTypeId: haid.id, startDate: SENIN, endDate: SENIN });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Hubungi HR');
  });

  it('menghitung hari kalender penuh untuk cuti yang begitu aturannya', async () => {
    const melahirkan = await makeLeaveType({
      code: 'maternity',
      name: 'Cuti Melahirkan',
      deductsBalance: false,
      countsCalendarDays: true,
    });

    const res = await ajukan({ leaveTypeId: melahirkan.id, startDate: JUMAT, endDate: '2026-03-09' });

    expect(res.body.totalDays).toBe(4);
  });
});

describe('Pola kerja outlet dan hotel (berbasis roster)', () => {
  const buatPolaShift = async () => {
    const res = await request(app)
      .post('/api/work-patterns')
      .set(auth(hrToken))
      .send({
        code: 'outlet_shift',
        name: 'Outlet (Shift)',
        type: 'shift',
        // Cadangan saat roster belum terbit.
        workingWeekdays: [1, 2, 3, 4, 5, 6],
        observesPublicHolidays: false,
      });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  const pasangKe = async (employeeId: string, workPatternId: string) => {
    const res = await request(app)
      .patch(`/api/employees/${employeeId}/work-pattern`)
      .set(auth(hrToken))
      .send({ workPatternId });
    expect(res.status).toBe(200);
  };

  const jadwalkan = async (tanggal: string[]) => {
    for (const d of tanggal) {
      const res = await request(app)
        .post('/api/shifts')
        .set(auth(hrToken))
        .send({ employeeId: budi.id, date: d, startTime: '08:00', endTime: '16:00' });
      expect(res.status).toBe(201);
    }
  };

  it('hanya memotong saldo untuk hari yang benar-benar dijadwalkan', async () => {
    await pasangKe(budi.id, await buatPolaShift());
    // Dijadwalkan Senin, Selasa, Kamis. Rabu adalah hari liburnya.
    await jadwalkan([SENIN, SELASA, '2026-03-05']);

    const res = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: '2026-03-05' });

    expect(res.status).toBe(201);
    expect(res.body.workPattern.type).toBe('shift');
    // Rabu tidak dipotong karena memang bukan hari kerjanya.
    expect(res.body.totalDays).toBe(3);
    expect(res.body.breakdown.notRosteredDays).toBe(1);
  });

  it('menghitung hari Minggu bila orangnya memang dijadwalkan', async () => {
    await pasangKe(budi.id, await buatPolaShift());
    await jadwalkan([MINGGU]);

    // Hotel beroperasi tujuh hari; Minggu bisa jadi hari kerja.
    const res = await ajukan({ leaveTypeId: tipeId, startDate: MINGGU, endDate: MINGGU });

    expect(res.status).toBe(201);
    expect(res.body.totalDays).toBe(1);
  });

  it('menandai taksiran saat roster periode itu belum terbit', async () => {
    await pasangKe(budi.id, await buatPolaShift());
    // Tidak ada shift sama sekali: cuti diajukan sebelum jadwal disusun.

    const res = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: SABTU });

    expect(res.status).toBe(201);
    // Pengajuan tetap bisa jalan memakai pola cadangan.
    expect(res.body.totalDays).toBe(6);
    expect(res.body.breakdown.estimatedDays).toBe(6);
  });

  it('mengabaikan libur nasional untuk pola yang tidak menghormatinya', async () => {
    await pasangKe(budi.id, await buatPolaShift());
    await makeHoliday(RABU, 'Nyepi');
    await jadwalkan([SENIN, SELASA, RABU]);

    // Restoran tetap buka saat libur nasional.
    const res = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: RABU });

    expect(res.body.totalDays).toBe(3);
    expect(res.body.breakdown.publicHolidayDays).toBe(0);
  });

  it('pola departemen dipakai kalau karyawan tidak punya pola sendiri', async () => {
    const dapur = await makeDepartment('Kitchen');
    await prisma.employee.update({ where: { id: budi.id }, data: { departmentId: dapur.id } });

    const polaId = await buatPolaShift();
    const res = await request(app)
      .patch(`/api/departments/${dapur.id}/work-pattern`)
      .set(auth(hrToken))
      .send({ workPatternId: polaId });
    expect(res.status).toBe(200);

    await jadwalkan([SENIN, SELASA]);
    const cuti = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: RABU });

    expect(cuti.body.workPattern.code).toBe('outlet_shift');
    expect(cuti.body.totalDays).toBe(2);
  });

  it('pola karyawan mengalahkan pola departemen', async () => {
    const dapur = await makeDepartment('Kitchen');
    await prisma.employee.update({ where: { id: budi.id }, data: { departmentId: dapur.id } });

    const polaShift = await buatPolaShift();
    await request(app)
      .patch(`/api/departments/${dapur.id}/work-pattern`)
      .set(auth(hrToken))
      .send({ workPatternId: polaShift });

    const polaKantor = await request(app)
      .post('/api/work-patterns')
      .set(auth(hrToken))
      .send({
        code: 'kantor_5hari',
        name: 'Kantor Senin-Jumat',
        type: 'fixed',
        workingWeekdays: [1, 2, 3, 4, 5],
      });
    await pasangKe(budi.id, polaKantor.body.id);

    const res = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: SABTU });

    expect(res.body.workPattern.code).toBe('kantor_5hari');
    // Sabtu tidak dihitung untuk pola lima hari.
    expect(res.body.totalDays).toBe(5);
  });

  it('GET /work-patterns/me mengembalikan pola yang berlaku', async () => {
    await pasangKe(budi.id, await buatPolaShift());

    const res = await request(app).get('/api/work-patterns/me').set(auth(budiToken));

    expect(res.status).toBe(200);
    expect(res.body.code).toBe('outlet_shift');
    expect(res.body.type).toBe('shift');
  });

  it('memakai pola bawaan perusahaan kalau tidak ada yang spesifik', async () => {
    await request(app)
      .post('/api/work-patterns')
      .set(auth(hrToken))
      .send({
        code: 'bawaan_5hari',
        name: 'Bawaan Senin-Jumat',
        type: 'fixed',
        workingWeekdays: [1, 2, 3, 4, 5],
        isDefault: true,
      });

    const res = await request(app).get('/api/work-patterns/me').set(auth(budiToken));
    expect(res.body.code).toBe('bawaan_5hari');
  });

  it('karyawan biasa tidak boleh membuat pola kerja', async () => {
    const res = await request(app)
      .post('/api/work-patterns')
      .set(auth(budiToken))
      .send({ code: 'palsu', name: 'Palsu', type: 'fixed', workingWeekdays: [1] });

    expect(res.status).toBe(403);
  });

  it('menolak hari kerja di luar rentang 0-6', async () => {
    const res = await request(app)
      .post('/api/work-patterns')
      .set(auth(hrToken))
      .send({ code: 'ngawur', name: 'Ngawur', type: 'fixed', workingWeekdays: [1, 9] });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/leaves/:id/decision', () => {
  const buatPengajuan = async () => {
    const res = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: JUMAT });
    return res.body.id as string;
  };

  it('menyetujui dan memotong saldo', async () => {
    const id = await buatPengajuan();

    const res = await request(app)
      .patch(`/api/leaves/${id}/decision`)
      .set(auth(hrToken))
      .send({ approved: true });

    expect(res.status).toBe(200);
    expect(res.body.leave.status).toBe('approved');

    const saldo = await request(app).get('/api/leave-balances/me').set(auth(budiToken));
    expect(saldo.body.data[0].usedDays).toBe(5);
    expect(saldo.body.data[0].remainingDays).toBe(7);
  });

  it('menolak tanpa memotong saldo', async () => {
    const id = await buatPengajuan();

    await request(app)
      .patch(`/api/leaves/${id}/decision`)
      .set(auth(hrToken))
      .send({ approved: false, note: 'Sedang musim ramai' });

    const saldo = await request(app).get('/api/leave-balances/me').set(auth(budiToken));
    expect(saldo.body.data[0].usedDays).toBe(0);
    expect(saldo.body.data[0].remainingDays).toBe(12);
  });

  it('mencegah memutuskan pengajuan sendiri', async () => {
    await prisma.employee.update({ where: { id: budi.id }, data: { role: Role.MANAGER } });
    const tokenBaru = await login(app, 'budi@resto.id');
    const id = await buatPengajuan();

    const res = await request(app)
      .patch(`/api/leaves/${id}/decision`)
      .set(auth(tokenBaru))
      .send({ approved: true });

    expect(res.status).toBe(403);
  });

  it('menolak keputusan ganda', async () => {
    const id = await buatPengajuan();
    await request(app).patch(`/api/leaves/${id}/decision`).set(auth(hrToken)).send({ approved: true });

    const res = await request(app)
      .patch(`/api/leaves/${id}/decision`)
      .set(auth(hrToken))
      .send({ approved: false });

    expect(res.status).toBe(409);
  });

  it('karyawan biasa tidak boleh memutuskan', async () => {
    const id = await buatPengajuan();

    const res = await request(app)
      .patch(`/api/leaves/${id}/decision`)
      .set(auth(budiToken))
      .send({ approved: true });

    expect(res.status).toBe(403);
  });

  it('manajer tidak boleh memutuskan cuti departemen lain', async () => {
    const dapur = await makeDepartment('Kitchen');
    const fo = await makeDepartment('Front Office');
    await makeEmployee({ email: 'mgr@resto.id', nik: 'MGR-1', role: Role.MANAGER, departmentId: fo.id });
    await prisma.employee.update({ where: { id: budi.id }, data: { departmentId: dapur.id } });

    const id = await buatPengajuan();
    const mgrToken = await login(app, 'mgr@resto.id');

    const res = await request(app)
      .patch(`/api/leaves/${id}/decision`)
      .set(auth(mgrToken))
      .send({ approved: true });

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/leaves/:id/cancel', () => {
  it('mengembalikan saldo saat cuti yang sudah disetujui dibatalkan', async () => {
    const dibuat = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: JUMAT });
    await request(app)
      .patch(`/api/leaves/${dibuat.body.id}/decision`)
      .set(auth(hrToken))
      .send({ approved: true });

    const res = await request(app)
      .patch(`/api/leaves/${dibuat.body.id}/cancel`)
      .set(auth(budiToken))
      .send({ reason: 'Rencana berubah' });

    expect(res.status).toBe(200);

    // Tanpa pengembalian ini, jatah karyawan hangus tanpa pernah dipakai.
    const saldo = await request(app).get('/api/leave-balances/me').set(auth(budiToken));
    expect(saldo.body.data[0].usedDays).toBe(0);
    expect(saldo.body.data[0].remainingDays).toBe(12);
  });

  it('membatalkan pengajuan yang masih menunggu', async () => {
    const dibuat = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: JUMAT });

    const res = await request(app)
      .patch(`/api/leaves/${dibuat.body.id}/cancel`)
      .set(auth(budiToken))
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.leave.status).toBe('cancelled');
  });

  it('membebaskan tanggalnya untuk pengajuan baru', async () => {
    const dibuat = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: JUMAT });
    await request(app).patch(`/api/leaves/${dibuat.body.id}/cancel`).set(auth(budiToken)).send({});

    const res = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: JUMAT });
    expect(res.status).toBe(201);
  });

  it('karyawan lain tidak boleh membatalkan cuti orang', async () => {
    const dibuat = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: JUMAT });
    await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2' });
    const sitiToken = await login(app, 'siti@resto.id');

    const res = await request(app)
      .patch(`/api/leaves/${dibuat.body.id}/cancel`)
      .set(auth(sitiToken))
      .send({});

    expect(res.status).toBe(403);
  });
});

describe('Pembacaan dan kalender', () => {
  it('karyawan hanya melihat cutinya sendiri lewat /me', async () => {
    const siti = await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2' });
    await makeLeaveBalance({ employeeId: siti.id, leaveTypeId: tipeId, year: 2026 });
    const sitiToken = await login(app, 'siti@resto.id');

    await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: JUMAT });
    await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: JUMAT }, sitiToken);

    const res = await request(app).get('/api/leaves/me').set(auth(budiToken));

    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].employeeId).toBe(budi.id);
  });

  it('karyawan biasa tidak boleh melihat daftar cuti semua orang', async () => {
    const res = await request(app).get('/api/leaves').set(auth(budiToken));
    expect(res.status).toBe(403);
  });

  it('kalender hanya menampilkan cuti yang sudah disetujui', async () => {
    const dibuat = await ajukan({ leaveTypeId: tipeId, startDate: SENIN, endDate: JUMAT });

    const sebelum = await request(app)
      .get(`/api/leaves/calendar?startDate=${SENIN}&endDate=2026-03-31`)
      .set(auth(hrToken));
    expect(sebelum.body.leaves).toHaveLength(0);

    await request(app)
      .patch(`/api/leaves/${dibuat.body.id}/decision`)
      .set(auth(hrToken))
      .send({ approved: true });

    const sesudah = await request(app)
      .get(`/api/leaves/calendar?startDate=${SENIN}&endDate=2026-03-31`)
      .set(auth(hrToken));
    expect(sesudah.body.leaves).toHaveLength(1);
  });

  it('kalender ikut menyertakan hari libur untuk perencanaan staffing', async () => {
    await makeHoliday(RABU, 'Nyepi');

    const res = await request(app)
      .get(`/api/leaves/calendar?startDate=${SENIN}&endDate=2026-03-31`)
      .set(auth(hrToken));

    expect(res.body.holidays).toHaveLength(1);
    expect(res.body.holidays[0].name).toBe('Nyepi');
  });
});
