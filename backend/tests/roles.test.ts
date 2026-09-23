import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee, makeDepartment } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth, expectStatus } from './helpers/api';
import { pastikanPeranSistem, migrasiIzinPeranLama } from '../src/services/roles/system';
import { IZIN, IZIN_MENU, DEFAULT_PERMISSIONS, migrasiIzin } from '../src/utils/permissions';
import { generateULID } from '../src/utils/generateULID';

const app = bikinApp();

beforeEach(async () => {
  await resetDatabase();
  await pastikanPeranSistem();
});

const peranSistem = (code: Role) => prisma.customRole.findUniqueOrThrow({ where: { code } });

/** SUPER_ADMIN yang memegang peran sistemnya. */
const bikinPemilik = async () => {
  const sa = await peranSistem(Role.SUPER_ADMIN);
  await makeEmployee({ email: 'owner@resto.id', role: Role.SUPER_ADMIN, customRoleId: sa.id });
  return login(app, 'owner@resto.id');
};

describe('Katalog izin dan peran sistem', () => {
  it('katalog izin berisi kunci yang dipakai penjaga rute', async () => {
    const token = await bikinPemilik();
    const res = await request(app).get('/api/roles/permissions').set(auth(token));
    expectStatus(res, 200);
    const kunci = (res.body.permissions as { key: string }[]).map((p) => p.key);
    expect(kunci).toEqual(IZIN.map((i) => i.key));
    expect(kunci).toEqual(expect.arrayContaining(['karyawan.buat', 'payroll.ubah', 'peran.buat', 'audit.lihat']));
    expect(res.body.scopes).toHaveLength(4);
    // Matriks halaman × aksi ikut dikirim: urutannya mengikuti sidebar.
    expect(res.body.actions).toEqual(['lihat', 'buat', 'ubah', 'hapus']);
    expect((res.body.pages as { halaman: string }[]).map((p) => p.halaman)).toEqual(expect.arrayContaining(['dashboard', 'karyawan', 'presensi_tim', 'peran']));
  });

  it('empat peran sistem tersedia dan tidak dibuat ganda saat dipanggil ulang', async () => {
    await pastikanPeranSistem();
    const token = await bikinPemilik();
    const res = await request(app).get('/api/roles').set(auth(token));
    expectStatus(res, 200);
    const kode = (res.body.data as { code: string | null; isSystem: boolean }[]).filter((r) => r.isSystem).map((r) => r.code);
    expect(kode.sort()).toEqual(['EMPLOYEE', 'HR_ADMIN', 'MANAGER', 'SUPER_ADMIN']);
    expect(res.body.data).toHaveLength(4);
  });

  it('izin bawaan peran sistem meniru penjaga rute lama', async () => {
    const hr = await peranSistem(Role.HR_ADMIN);
    expect(hr.permissions).toEqual([...DEFAULT_PERMISSIONS.HR_ADMIN]);
    expect(hr.permissions).not.toContain('audit.lihat');
    expect(hr.permissions).not.toContain('peran.buat');
    const mgr = await peranSistem(Role.MANAGER);
    expect(mgr.permissions).toContain('cuti_tim.ubah');
    expect(mgr.permissions).not.toContain('payroll.ubah');
  });

  it('karyawan biasa tidak boleh melihat daftar peran maupun katalog', async () => {
    await makeEmployee({ email: 'budi@resto.id' });
    const token = await login(app, 'budi@resto.id');
    expectStatus(await request(app).get('/api/roles').set(auth(token)), 403);
    expectStatus(await request(app).get('/api/roles/permissions').set(auth(token)), 403);
  });

  it('HR boleh melihat daftar peran (untuk memilih peran karyawan) tapi tidak membuatnya', async () => {
    await makeEmployee({ email: 'hr@resto.id', role: Role.HR_ADMIN });
    const token = await login(app, 'hr@resto.id');
    expectStatus(await request(app).get('/api/roles').set(auth(token)), 200);
    const res = await request(app)
      .post('/api/roles')
      .set(auth(token))
      .send({ name: 'Coba', baseRole: 'EMPLOYEE', permissions: [] });
    expectStatus(res, 403);
  });
});

describe('Peran kustom menentukan izin', () => {
  it('karyawan dengan peran "Staf Payroll" bisa membuka payroll tapi tidak daftar karyawan', async () => {
    const owner = await bikinPemilik();
    const buat = await request(app)
      .post('/api/roles')
      .set(auth(owner))
      .send({ name: 'Staf Payroll', description: 'Hanya payroll', baseRole: 'EMPLOYEE', permissions: ['payroll.lihat'] });
    expectStatus(buat, 201);
    expect(buat.body).toMatchObject({ name: 'Staf Payroll', baseRole: 'EMPLOYEE', permissions: ['payroll.lihat'], isSystem: false });

    const staf = await makeEmployee({ email: 'staf@resto.id' });
    const tugaskan = await request(app)
      .put(`/api/employees/${staf.id}`)
      .set(auth(owner))
      .send({ customRoleId: buat.body.id });
    expectStatus(tugaskan, 200);
    expect(tugaskan.body.customRole).toMatchObject({ id: buat.body.id, name: 'Staf Payroll' });

    const token = await login(app, 'staf@resto.id');
    expectStatus(await request(app).get('/api/payroll-runs').set(auth(token)), 200);
    expectStatus(await request(app).get('/api/employees').set(auth(token)), 403);

    const me = await request(app).get('/api/auth/me').set(auth(token));
    expectStatus(me, 200);
    expect(me.body.permissions).toEqual(['payroll.lihat']);
    expect(me.body.customRole).toEqual({ id: buat.body.id, name: 'Staf Payroll' });
    expect(me.body.role).toBe('EMPLOYEE');
  });

  it('login mengembalikan izin dan nama peran', async () => {
    const owner = await bikinPemilik();
    const res = await request(app).post('/api/auth/login').send({ email: 'owner@resto.id', password: 'RahasiaUji123' });
    expectStatus(res, 200);
    expect(res.body.user.customRole.name).toBe('Super Admin');
    expect(res.body.user.permissions).toEqual(expect.arrayContaining(IZIN.map((i) => i.key)));
    // Alias kunci lama ikut dikirim supaya aplikasi mobile yang sudah terpasang tetap membaca menunya.
    expect(res.body.user.permissions).toEqual(expect.arrayContaining(['halaman.presensi', 'halaman.cuti', 'halaman.gaji']));
    expect(owner).toBeTruthy();
  });

  it('lingkup data karyawan mengikuti lingkup perannya, termasuk saat perannya disunting', async () => {
    const owner = await bikinPemilik();
    const dept = await makeDepartment('Kitchen');
    const lain = await makeDepartment('Front Office');
    await makeEmployee({ email: 'fo@resto.id', departmentId: lain.id });

    const buat = await request(app)
      .post('/api/roles')
      .set(auth(owner))
      .send({ name: 'Kepala Outlet', baseRole: 'MANAGER', permissions: ['karyawan.lihat'] });
    expectStatus(buat, 201);

    const kepala = await makeEmployee({ email: 'kepala@resto.id', departmentId: dept.id });
    expectStatus(
      await request(app).put(`/api/employees/${kepala.id}`).set(auth(owner)).send({ customRoleId: buat.body.id }),
      200
    );
    const sesudah = await prisma.employee.findUniqueOrThrow({ where: { id: kepala.id } });
    expect(sesudah.role).toBe(Role.MANAGER);

    // Pembatasan "departemen sendiri" milik MANAGER tetap berlaku.
    const token = await login(app, 'kepala@resto.id');
    const daftar = await request(app).get('/api/employees').set(auth(token));
    expectStatus(daftar, 200);
    const email = (daftar.body.data as { email: string }[]).map((e) => e.email);
    expect(email).toContain('kepala@resto.id');
    expect(email).not.toContain('fo@resto.id');

    // Lingkup peran diubah → lingkup semua pemegangnya ikut berubah.
    expectStatus(await request(app).put(`/api/roles/${buat.body.id}`).set(auth(owner)).send({ baseRole: 'EMPLOYEE' }), 200);
    const akhir = await prisma.employee.findUniqueOrThrow({ where: { id: kepala.id } });
    expect(akhir.role).toBe(Role.EMPLOYEE);
    expectStatus(await request(app).get('/api/employees').set(auth(token)), 200); // masih punya karyawan.lihat
  });

  it('suntingan izin peran sistem langsung berlaku bagi pemegangnya tanpa login ulang', async () => {
    const owner = await bikinPemilik();
    const hrRole = await peranSistem(Role.HR_ADMIN);
    await makeEmployee({ email: 'hr@resto.id', role: Role.HR_ADMIN, customRoleId: hrRole.id });
    // Akun lama yang belum pernah diberi peran secara eksplisit ikut terpengaruh.
    await makeEmployee({ email: 'hr-lama@resto.id', role: Role.HR_ADMIN });

    const hr = await login(app, 'hr@resto.id');
    const hrLama = await login(app, 'hr-lama@resto.id');
    expectStatus(await request(app).get('/api/payroll-runs').set(auth(hr)), 200);
    expectStatus(await request(app).get('/api/payroll-runs').set(auth(hrLama)), 200);

    const tanpaPayroll = hrRole.permissions.filter((k) => !k.startsWith('payroll.'));
    expectStatus(await request(app).put(`/api/roles/${hrRole.id}`).set(auth(owner)).send({ permissions: tanpaPayroll }), 200);

    expectStatus(await request(app).get('/api/payroll-runs').set(auth(hr)), 403);
    expectStatus(await request(app).get('/api/payroll-runs').set(auth(hrLama)), 403);
    expectStatus(await request(app).get('/api/employees').set(auth(hr)), 200);
  });

  it('membuat karyawan dengan field role lama tetap menautkan peran sistemnya', async () => {
    const owner = await bikinPemilik();
    const res = await request(app)
      .post('/api/employees')
      .set(auth(owner))
      .send({ nik: 'M-1', name: 'Manajer Baru', email: 'mgr@resto.id', role: 'MANAGER' });
    expectStatus(res, 201);
    const mgrRole = await peranSistem(Role.MANAGER);
    expect(res.body.customRole).toEqual({ id: mgrRole.id, name: 'Manajer', isSystem: true });
    expect(res.body.role).toBe('MANAGER');
  });

  it('SUPER_ADMIN selalu memegang semua izin walau perannya kosong', async () => {
    const sa = await peranSistem(Role.SUPER_ADMIN);
    await prisma.customRole.update({ where: { id: sa.id }, data: { permissions: [] } });
    const token = await bikinPemilik();
    expectStatus(await request(app).get('/api/audit-logs').set(auth(token)), 200);
  });
});

describe('Perlindungan peran', () => {
  it('peran Super Admin terkunci; peran sistem lain tidak bisa dihapus atau diganti lingkupnya', async () => {
    const owner = await bikinPemilik();
    const sa = await peranSistem(Role.SUPER_ADMIN);
    const hr = await peranSistem(Role.HR_ADMIN);

    expectStatus(await request(app).put(`/api/roles/${sa.id}`).set(auth(owner)).send({ name: 'Bos' }), 403);
    expectStatus(await request(app).delete(`/api/roles/${sa.id}`).set(auth(owner)), 403);
    expectStatus(await request(app).delete(`/api/roles/${hr.id}`).set(auth(owner)), 403);
    expectStatus(await request(app).put(`/api/roles/${hr.id}`).set(auth(owner)).send({ baseRole: 'EMPLOYEE' }), 400);
    // Nama dan deskripsi peran sistem boleh disesuaikan.
    expectStatus(await request(app).put(`/api/roles/${hr.id}`).set(auth(owner)).send({ name: 'Admin SDM' }), 200);
  });

  it('peran yang masih dipegang karyawan tidak bisa dihapus; yang kosong bisa', async () => {
    const owner = await bikinPemilik();
    const buat = await request(app).post('/api/roles').set(auth(owner)).send({ name: 'Sementara', baseRole: 'EMPLOYEE', permissions: [] });
    expectStatus(buat, 201);
    const staf = await makeEmployee({ email: 'staf@resto.id', customRoleId: buat.body.id });

    expectStatus(await request(app).delete(`/api/roles/${buat.body.id}`).set(auth(owner)), 409);

    const empRole = await peranSistem(Role.EMPLOYEE);
    expectStatus(await request(app).put(`/api/employees/${staf.id}`).set(auth(owner)).send({ customRoleId: empRole.id }), 200);
    expectStatus(await request(app).delete(`/api/roles/${buat.body.id}`).set(auth(owner)), 204);
    expect(await prisma.customRole.findUnique({ where: { id: buat.body.id } })).toBeNull();
  });

  it('menolak izin yang tidak dikenal, field asing, dan nama ganda', async () => {
    const owner = await bikinPemilik();
    expectStatus(
      await request(app).post('/api/roles').set(auth(owner)).send({ name: 'Aneh', baseRole: 'EMPLOYEE', permissions: ['dewa.semua'] }),
      400
    );
    expectStatus(
      await request(app).post('/api/roles').set(auth(owner)).send({ name: 'Aneh', baseRole: 'EMPLOYEE', permissions: [], isSystem: true }),
      400
    );
    expectStatus(await request(app).post('/api/roles').set(auth(owner)).send({ name: 'HR Admin', baseRole: 'EMPLOYEE', permissions: [] }), 409);
  });

  it('pengelola peran yang bukan SUPER_ADMIN tidak bisa menaikkan haknya lewat peran', async () => {
    const owner = await bikinPemilik();
    // Peran "Admin Akses": boleh mengelola peran & karyawan, tapi bukan pemilik sistem.
    const adminAkses = await request(app)
      .post('/api/roles')
      .set(auth(owner))
      .send({ name: 'Admin Akses', baseRole: 'MANAGER', permissions: ['peran.lihat', 'peran.buat', 'peran.ubah', 'karyawan.buat', 'karyawan.ubah', 'karyawan.lihat'] });
    expectStatus(adminAkses, 201);
    await makeEmployee({ email: 'akses@resto.id', role: Role.MANAGER, customRoleId: adminAkses.body.id });
    const token = await login(app, 'akses@resto.id');

    // Izin yang tidak ia pegang tidak bisa diberikan ke peran mana pun.
    expectStatus(
      await request(app).post('/api/roles').set(auth(token)).send({ name: 'Curang', baseRole: 'EMPLOYEE', permissions: ['audit.lihat'] }),
      403
    );
    // Lingkup HR/Super Admin hanya boleh diberikan SUPER_ADMIN.
    expectStatus(
      await request(app).post('/api/roles').set(auth(token)).send({ name: 'Curang', baseRole: 'HR_ADMIN', permissions: [] }),
      403
    );
    // Peran yang sedang ia pegang tidak bisa ia ubah sendiri.
    expectStatus(
      await request(app).put(`/api/roles/${adminAkses.body.id}`).set(auth(token)).send({ permissions: ['peran.buat', 'payroll.ubah'] }),
      403
    );
    // Peran sistem HR Admin (lingkup tinggi) tidak bisa ia sunting.
    const hr = await peranSistem(Role.HR_ADMIN);
    expectStatus(await request(app).put(`/api/roles/${hr.id}`).set(auth(token)).send({ permissions: [] }), 403);

    // Yang wajar tetap boleh: peran dengan sebagian izinnya sendiri.
    const wajar = await request(app)
      .post('/api/roles')
      .set(auth(token))
      .send({ name: 'Pembaca Karyawan', baseRole: 'EMPLOYEE', permissions: ['karyawan.lihat'] });
    expectStatus(wajar, 201);

    // Menugaskan peran yang izinnya melampaui miliknya juga ditolak.
    const payrollRole = await request(app)
      .post('/api/roles')
      .set(auth(owner))
      .send({ name: 'Staf Payroll', baseRole: 'EMPLOYEE', permissions: ['payroll.lihat'] });
    const staf = await makeEmployee({ email: 'staf@resto.id' });
    expectStatus(await request(app).put(`/api/employees/${staf.id}`).set(auth(token)).send({ customRoleId: payrollRole.body.id }), 403);
    expectStatus(await request(app).put(`/api/employees/${staf.id}`).set(auth(token)).send({ customRoleId: wajar.body.id }), 200);
  });

  it('pengelola peran non-Super Admin tidak bisa menyentuh peran yang lebih kuat dari dirinya', async () => {
    const owner = await bikinPemilik();
    const adminAkses = await request(app)
      .post('/api/roles')
      .set(auth(owner))
      .send({
        name: 'Admin Akses',
        baseRole: 'MANAGER',
        permissions: ['peran.lihat', 'peran.buat', 'peran.ubah', 'peran.hapus', 'karyawan.lihat'],
      });
    expectStatus(adminAkses, 201);
    await makeEmployee({ email: 'akses@resto.id', role: Role.MANAGER, customRoleId: adminAkses.body.id });
    const token = await login(app, 'akses@resto.id');

    // Lingkup Super Admin hanya boleh diberikan pemilik sistem — baik pada
    // peran baru maupun dengan menaikkan peran yang sudah ada.
    expectStatus(await request(app).post('/api/roles').set(auth(token)).send({ name: 'Dewa', baseRole: 'SUPER_ADMIN', permissions: [] }), 403);

    // Peran buatan pemilik yang memuat izin di luar miliknya: tidak bisa
    // disunting (termasuk sekadar diganti nama) maupun dihapus.
    const kuat = await request(app)
      .post('/api/roles')
      .set(auth(owner))
      .send({ name: 'Staf Payroll', baseRole: 'EMPLOYEE', permissions: ['payroll.lihat'] });
    expectStatus(kuat, 201);
    expectStatus(await request(app).put(`/api/roles/${kuat.body.id}`).set(auth(token)).send({ name: 'Karyawan Biasa' }), 403);
    expectStatus(await request(app).delete(`/api/roles/${kuat.body.id}`).set(auth(token)), 403);
    expect(await prisma.customRole.findUnique({ where: { id: kuat.body.id } })).not.toBeNull();

    // Peran sistem Super Admin tidak bisa ia sentuh sama sekali.
    const sa = await peranSistem(Role.SUPER_ADMIN);
    expectStatus(await request(app).put(`/api/roles/${sa.id}`).set(auth(token)).send({ name: 'Bos' }), 403);
    expectStatus(await request(app).delete(`/api/roles/${sa.id}`).set(auth(token)), 403);

    // Yang berada di dalam haknya tetap bisa ia kelola sampai menghapus.
    const wajar = await request(app)
      .post('/api/roles')
      .set(auth(token))
      .send({ name: 'Pembaca Karyawan', baseRole: 'EMPLOYEE', permissions: ['karyawan.lihat'] });
    expectStatus(wajar, 201);
    expectStatus(await request(app).put(`/api/roles/${wajar.body.id}`).set(auth(token)).send({ name: 'Pembaca' }), 200);
    expectStatus(await request(app).put(`/api/roles/${wajar.body.id}`).set(auth(token)).send({ baseRole: 'SUPER_ADMIN' }), 403);
    expectStatus(await request(app).delete(`/api/roles/${wajar.body.id}`).set(auth(token)), 204);
  });

  it('tidak bisa mengubah peran diri sendiri lewat data karyawan', async () => {
    const owner = await bikinPemilik();
    const saya = await prisma.employee.findUniqueOrThrow({ where: { email: 'owner@resto.id' } });
    const hr = await peranSistem(Role.HR_ADMIN);
    expectStatus(await request(app).put(`/api/employees/${saya.id}`).set(auth(owner)).send({ customRoleId: hr.id }), 403);
  });

  it('peran yang tidak ada ditolak saat ditugaskan', async () => {
    const owner = await bikinPemilik();
    const staf = await makeEmployee({ email: 'staf@resto.id' });
    const res = await request(app).put(`/api/employees/${staf.id}`).set(auth(owner)).send({ customRoleId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
    expectStatus(res, 400);
  });
});

describe('Izin akses menu (halaman layanan mandiri)', () => {
  it('katalog memuat satu kunci per menu layanan mandiri dan semua peran sistem memilikinya', async () => {
    expect(IZIN_MENU).toEqual(
      expect.arrayContaining(['dashboard.lihat', 'presensi.lihat', 'cuti.lihat', 'gaji.lihat', 'pengumuman.lihat', 'chat.lihat', 'whatsapp_saya.lihat', 'unduh.lihat'])
    );
    for (const code of [Role.EMPLOYEE, Role.MANAGER, Role.HR_ADMIN, Role.SUPER_ADMIN]) {
      const peran = await peranSistem(code);
      expect(peran.permissions).toEqual(expect.arrayContaining([...IZIN_MENU]));
    }
    expect(DEFAULT_PERMISSIONS.EMPLOYEE).toEqual([...IZIN_MENU]);
    expect(DEFAULT_PERMISSIONS.MANAGER).toContain('wawancara.lihat');
  });

  it('karyawan biasa tetap bisa memakai layanan mandiri', async () => {
    await makeEmployee({ email: 'budi@resto.id' });
    const token = await login(app, 'budi@resto.id');
    expectStatus(await request(app).get('/api/leaves/me').set(auth(token)), 200);
    expectStatus(await request(app).get('/api/attendance/me').set(auth(token)), 200);
    expectStatus(await request(app).get('/api/payrolls/me').set(auth(token)), 200);
    expectStatus(await request(app).get('/api/announcements').set(auth(token)), 200);
    expectStatus(await request(app).get('/api/chat/rooms').set(auth(token)), 200);
    expectStatus(await request(app).get('/api/whatsapp/me').set(auth(token)), 200);
  });

  it('peran tanpa kunci menu menutup API di balik menu itu, bukan cuma menyembunyikannya', async () => {
    const owner = await bikinPemilik();
    // Hanya presensi dan pengumuman; tanpa cuti, gaji, chat, WhatsApp.
    const buat = await request(app)
      .post('/api/roles')
      .set(auth(owner))
      .send({ name: 'Staf Harian', baseRole: 'EMPLOYEE', permissions: ['presensi.lihat', 'pengumuman.lihat'] });
    expectStatus(buat, 201);
    await makeEmployee({ email: 'harian@resto.id', customRoleId: buat.body.id });
    const token = await login(app, 'harian@resto.id');

    expectStatus(await request(app).get('/api/attendance/me').set(auth(token)), 200);
    expectStatus(await request(app).get('/api/announcements').set(auth(token)), 200);

    expectStatus(await request(app).get('/api/leaves/me').set(auth(token)), 403);
    expectStatus(await request(app).get('/api/leave-balances/me').set(auth(token)), 403);
    expectStatus(await request(app).get('/api/payrolls/me').set(auth(token)), 403);
    expectStatus(await request(app).get('/api/chat/rooms').set(auth(token)), 403);
    expectStatus(await request(app).get('/api/whatsapp/me').set(auth(token)), 403);
    expectStatus(await request(app).get('/api/training/sessions').set(auth(token)), 403);
    expectStatus(await request(app).get('/api/feedback').set(auth(token)), 403);
    expectStatus(await request(app).get('/api/cases').set(auth(token)), 403);
  });

  it('izin fungsional juga membuka API menu yang sama (pengelola cuti tanpa kunci menu cuti)', async () => {
    const owner = await bikinPemilik();
    const buat = await request(app)
      .post('/api/roles')
      .set(auth(owner))
      .send({ name: 'Penyetuju Cuti', baseRole: 'MANAGER', permissions: ['cuti_tim.lihat', 'cuti_tim.ubah'] });
    expectStatus(buat, 201);
    await makeEmployee({ email: 'penyetuju@resto.id', role: Role.MANAGER, customRoleId: buat.body.id });
    const token = await login(app, 'penyetuju@resto.id');
    expectStatus(await request(app).get('/api/leaves').set(auth(token)), 200);
    // Layanan mandiri cuti miliknya sendiri tetap tertutup tanpa kunci menu.
    expectStatus(await request(app).get('/api/leaves/me').set(auth(token)), 403);
  });
});

describe('Migrasi kunci izin generasi sebelumnya', () => {
  it('memetakan kunci lama ke kunci matriks persis sesuai yang dulu dibukanya', () => {
    expect(migrasiIzin(['karyawan.kelola'])).toEqual(['karyawan.buat', 'karyawan.ubah', 'karyawan.hapus']);
    expect(migrasiIzin(['halaman.cuti', 'cuti.setujui'])).toEqual(['cuti.lihat', 'cuti_tim.lihat', 'cuti_tim.ubah']);
    // Kunci yang sudah benar dipertahankan, yang tidak dikenal dibuang, tanpa duplikat.
    expect(migrasiIzin(['payroll.ubah', 'payroll.kelola', 'dewa.semua'])).toEqual(['payroll.lihat', 'payroll.buat', 'payroll.ubah', 'payroll.hapus']);
  });

  it('peran yang tersimpan dengan kunci lama dimigrasi saat server mulai, dan hanya sekali', async () => {
    await prisma.customRole.create({
      data: { id: generateULID(), name: 'Peran Lama', baseRole: Role.MANAGER, permissions: ['karyawan.lihat', 'presensi.lihat_tim', 'presensi.lembur', 'halaman.presensi'] },
    });
    expect(await migrasiIzinPeranLama()).toBe(1);
    const sesudah = await prisma.customRole.findFirstOrThrow({ where: { name: 'Peran Lama' } });
    expect(sesudah.permissions).toEqual(['karyawan.lihat', 'presensi.lihat', 'presensi_tim.lihat', 'lembur.ubah']);
    expect(await migrasiIzinPeranLama()).toBe(0);

    // Pemegangnya langsung memakai kunci baru tanpa login ulang.
    await makeEmployee({ email: 'lama@resto.id', role: Role.MANAGER, customRoleId: sesudah.id });
    const token = await login(app, 'lama@resto.id');
    expectStatus(await request(app).get('/api/attendance').set(auth(token)), 200);
    expectStatus(await request(app).get('/api/leaves').set(auth(token)), 403);
  });
});
