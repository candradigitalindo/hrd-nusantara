import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee } from './helpers/db';
import { login, auth, expectStatus } from './helpers/api';
import { bikinApp } from './helpers/app';
import {
  setPengirimPush,
  kirimKeKaryawan,
  type PengirimPush,
  type HasilKirim,
} from '../src/services/notification/push';
import { applySessionEvent } from '../src/services/whatsapp/ingest';

const app = bikinApp();

const NOMOR_PERUSAHAAN = '08111111111';

let hrToken: string;
let budi: { id: string };
let budiToken: string;
let sitiToken: string;

/** Mencatat apa yang dikirim, tanpa menghubungi Firebase. */
interface Kiriman {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

let terkirim: Kiriman[] = [];

const pengirimPalsu =
  (hasil?: Partial<HasilKirim>): PengirimPush =>
  async (tokens, pesan) => {
    terkirim.push({ tokens, title: pesan.title, body: pesan.body, data: pesan.data });
    return {
      terkirim: hasil?.terkirim ?? tokens.length,
      gagal: hasil?.gagal ?? 0,
      tokenTidakSah: hasil?.tokenTidakSah ?? [],
    };
  };

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1' });
  budiToken = await login(app, 'budi@resto.id');
  await makeEmployee({ email: 'siti@resto.id', nik: 'EMP-2' });
  sitiToken = await login(app, 'siti@resto.id');

  terkirim = [];
  setPengirimPush(pengirimPalsu());
});

afterEach(() => {
  setPengirimPush(null);
});

const TOKEN_A = 'fcm-token-perangkat-budi-aaaaaaaaaaaa';
const TOKEN_B = 'fcm-token-perangkat-budi-bbbbbbbbbbbb';

const daftarkanPerangkat = (token: string, jwt: string, platform = 'android') =>
  request(app).post('/api/devices').set(auth(jwt)).send({ token, platform });

describe('Pendaftaran perangkat', () => {
  it('mendaftarkan perangkat milik sendiri', async () => {
    const res = await daftarkanPerangkat(TOKEN_A, budiToken);

    expectStatus(res, 201);
    expect(res.body.platform).toBe('android');
    expect(res.body.isActive).toBe(true);
    // Token tidak ikut dikembalikan: nilainya rahasia dan pemiliknya sudah
    // memegangnya sendiri.
    expect(res.body.token).toBeUndefined();
  });

  it('memindahkan kepemilikan saat ponsel berpindah tangan', async () => {
    await daftarkanPerangkat(TOKEN_A, budiToken);
    expectStatus(await daftarkanPerangkat(TOKEN_A, sitiToken), 201);

    // Kalau token tetap menempel ke pemilik lama, notifikasi Budi — termasuk
    // soal nomor WhatsApp perusahaan yang dipegangnya — akan terus muncul di
    // layar Siti.
    const baris = await prisma.deviceToken.findMany();
    expect(baris).toHaveLength(1);
    expect(baris[0].employeeId).not.toBe(budi.id);
  });

  it('menghidupkan lagi token yang sempat dimatikan', async () => {
    await daftarkanPerangkat(TOKEN_A, budiToken);
    expectStatus(
      await request(app).delete('/api/devices').set(auth(budiToken)).send({ token: TOKEN_A }),
      200
    );

    // Firebase bisa mengembalikan token yang sama setelah aplikasi dipasang
    // ulang; mendaftar lagi harus menghidupkannya, bukan gagal.
    await daftarkanPerangkat(TOKEN_A, budiToken);

    const baris = await prisma.deviceToken.findFirstOrThrow({ where: { token: TOKEN_A } });
    expect(baris.isActive).toBe(true);
  });

  it('menolak mematikan token milik orang lain', async () => {
    await daftarkanPerangkat(TOKEN_A, budiToken);

    const res = await request(app)
      .delete('/api/devices')
      .set(auth(sitiToken))
      .send({ token: TOKEN_A });

    expect(res.status).toBe(404);
    const baris = await prisma.deviceToken.findFirstOrThrow({ where: { token: TOKEN_A } });
    expect(baris.isActive).toBe(true);
  });

  it('hanya menampilkan perangkat sendiri', async () => {
    await daftarkanPerangkat(TOKEN_A, budiToken);
    await daftarkanPerangkat(TOKEN_B, sitiToken);

    const res = await request(app).get('/api/devices').set(auth(budiToken));

    expectStatus(res, 200);
    expect(res.body.data).toHaveLength(1);
  });

  it('menolak platform yang tidak dikenal', async () => {
    const res = await request(app)
      .post('/api/devices')
      .set(auth(budiToken))
      .send({ token: TOKEN_A, platform: 'symbian' });

    expect(res.status).toBe(400);
  });
});

describe('Mengirim ke perangkat karyawan', () => {
  it('mengirim ke semua perangkat aktif miliknya', async () => {
    await daftarkanPerangkat(TOKEN_A, budiToken);
    await daftarkanPerangkat(TOKEN_B, budiToken, 'ios');

    await kirimKeKaryawan(budi.id, { title: 'Halo', body: 'Pesan uji' });

    expect(terkirim).toHaveLength(1);
    expect(terkirim[0].tokens.sort()).toEqual([TOKEN_A, TOKEN_B].sort());
  });

  it('tidak mengirim apa-apa kalau karyawan belum punya perangkat', async () => {
    await kirimKeKaryawan(budi.id, { title: 'Halo', body: 'Pesan uji' });

    expect(terkirim).toHaveLength(0);
  });

  it('mematikan token yang ditolak FCM', async () => {
    await daftarkanPerangkat(TOKEN_A, budiToken);
    await daftarkanPerangkat(TOKEN_B, budiToken);
    setPengirimPush(pengirimPalsu({ terkirim: 1, gagal: 1, tokenTidakSah: [TOKEN_A] }));

    await kirimKeKaryawan(budi.id, { title: 'Halo', body: 'Pesan uji' });

    // Tanpa ini, tiap notifikasi berikutnya terus menembak token mati yang
    // sama, dan Firebase memperlakukan pengirimnya sebagai berperilaku buruk.
    const a = await prisma.deviceToken.findFirstOrThrow({ where: { token: TOKEN_A } });
    const b = await prisma.deviceToken.findFirstOrThrow({ where: { token: TOKEN_B } });
    expect(a.isActive).toBe(false);
    expect(b.isActive).toBe(true);
    expect(b.lastUsedAt).not.toBeNull();
  });

  it('tidak mematikan token saat kegagalannya hanya sementara', async () => {
    await daftarkanPerangkat(TOKEN_A, budiToken);
    setPengirimPush(pengirimPalsu({ terkirim: 0, gagal: 1, tokenTidakSah: [] }));

    await kirimKeKaryawan(budi.id, { title: 'Halo', body: 'Pesan uji' });

    // Gangguan jaringan atau kuota bukan alasan mencabut perangkat orang.
    const a = await prisma.deviceToken.findFirstOrThrow({ where: { token: TOKEN_A } });
    expect(a.isActive).toBe(true);
  });
});

describe('Notifikasi putus sesi WhatsApp', () => {
  const buatAkun = async () => {
    const res = await request(app)
      .post('/api/whatsapp/accounts')
      .set(auth(hrToken))
      .send({ phoneNumber: NOMOR_PERUSAHAAN, label: 'CS Outlet Kemang', assignedEmployeeId: budi.id });
    expectStatus(res, 201);
    return res.body.id as string;
  };

  it('memberi tahu pemegang nomor saat sesinya terputus', async () => {
    await buatAkun();
    await daftarkanPerangkat(TOKEN_A, budiToken);

    await applySessionEvent({ phoneNumber: NOMOR_PERUSAHAAN, status: 'disconnected' });

    expect(terkirim).toHaveLength(1);
    expect(terkirim[0].tokens).toEqual([TOKEN_A]);
    expect(terkirim[0].title).toContain('terputus');
    expect(terkirim[0].data?.jenis).toBe('whatsapp_session');
  });

  it('menandai kejadian sudah diberitahukan', async () => {
    await buatAkun();
    await daftarkanPerangkat(TOKEN_A, budiToken);

    await applySessionEvent({ phoneNumber: NOMOR_PERUSAHAAN, status: 'scan_required' });

    const kejadian = await prisma.whatsAppSessionEvent.findFirstOrThrow();
    expect(kejadian.notifiedAt).not.toBeNull();

    // Sudah diberitahukan, jadi tidak muncul lagi di antrean tarikan mobile.
    const res = await request(app)
      .get('/api/whatsapp/session-events?unnotifiedOnly=true')
      .set(auth(hrToken));
    expect(res.body.pagination.total).toBe(0);
  });

  it('menyisakan kejadian di antrean kalau push gagal', async () => {
    await buatAkun();
    await daftarkanPerangkat(TOKEN_A, budiToken);
    setPengirimPush(pengirimPalsu({ terkirim: 0, gagal: 1, tokenTidakSah: [] }));

    await applySessionEvent({ phoneNumber: NOMOR_PERUSAHAAN, status: 'disconnected' });

    // Push yang gagal tidak boleh membuat kejadian dianggap tersampaikan:
    // aplikasi mobile masih harus bisa menemukannya saat menarik antrean.
    const kejadian = await prisma.whatsAppSessionEvent.findFirstOrThrow();
    expect(kejadian.notifiedAt).toBeNull();
  });

  it('tidak memberi tahu saat sesi berhasil tersambung', async () => {
    await buatAkun();
    await daftarkanPerangkat(TOKEN_A, budiToken);

    await applySessionEvent({ phoneNumber: NOMOR_PERUSAHAAN, status: 'connected' });

    // Notifikasi yang tidak bisa ditindaklanjuti melatih orang mengabaikan
    // notifikasi berikutnya.
    expect(terkirim).toHaveLength(0);
  });

  it('tidak memberi tahu siapa pun kalau nomor belum dipegang karyawan', async () => {
    const res = await request(app)
      .post('/api/whatsapp/accounts')
      .set(auth(hrToken))
      .send({ phoneNumber: NOMOR_PERUSAHAAN, label: 'Nomor Cadangan' });
    expectStatus(res, 201);
    await daftarkanPerangkat(TOKEN_A, budiToken);

    await applySessionEvent({ phoneNumber: NOMOR_PERUSAHAAN, status: 'disconnected' });

    expect(terkirim).toHaveLength(0);
    // Kejadiannya tetap tercatat dan tetap terlihat HR.
    expect(await prisma.whatsAppSessionEvent.count()).toBe(1);
  });

  it('tidak membocorkan isi percakapan ke dalam notifikasi', async () => {
    await buatAkun();
    await daftarkanPerangkat(TOKEN_A, budiToken);

    await applySessionEvent({
      phoneNumber: NOMOR_PERUSAHAAN,
      status: 'disconnected',
      note: 'Sesi terputus saat memproses pesan "nomor kartu 4111 1111"',
    });

    // Muatan push melewati server Google dan tampil di layar terkunci.
    const isi = JSON.stringify(terkirim[0]);
    expect(isi).not.toContain('4111');
    expect(isi).not.toContain('nomor kartu');
  });

  it('kegagalan notifikasi tidak menggagalkan pencatatan kejadian', async () => {
    await buatAkun();
    await daftarkanPerangkat(TOKEN_A, budiToken);
    setPengirimPush(async () => {
      throw new Error('Firebase sedang bermasalah');
    });

    const hasil = await applySessionEvent({ phoneNumber: NOMOR_PERUSAHAAN, status: 'disconnected' });

    // Webhook yang gagal karena Firebase akan membuat pengirimnya mengulang
    // kiriman yang sebenarnya sudah tersimpan.
    expect(hasil.status).toBe('tercatat');
    expect(await prisma.whatsAppSessionEvent.count()).toBe(1);
  });
});
