import { prisma, resetDatabase } from './helpers/db';
import { isCiphertext } from '../src/utils/fieldCrypto';
import { generateULID } from '../src/utils/generateULID';
import {
  akunDenganTautanTersimpan,
  hapusKredensialTersimpan,
  muatAuthState,
  type AlatBaileys,
} from '../src/services/whatsapp/authStore';
import { akunUntukDibukaUlang } from '../src/services/whatsapp/bootstrap';

/**
 * Tiruan bagian Baileys yang dipakai authStore. Aturan Buffer-nya sama dengan
 * BufferJSON asli: Buffer menjadi { type: 'Buffer', data: <base64> } dan
 * kembali menjadi Buffer saat dibaca.
 */
class DataKunciSinkron {
  constructor(public readonly isi: Record<string, unknown>) {}
}

const alat: AlatBaileys = {
  BufferJSON: {
    replacer: (_kunci, nilai) => {
      const v = nilai as { type?: string; data?: number[] } | null;
      if (Buffer.isBuffer(nilai) || nilai instanceof Uint8Array || v?.type === 'Buffer') {
        return { type: 'Buffer', data: Buffer.from((v?.data ?? nilai) as Uint8Array).toString('base64') };
      }
      return nilai;
    },
    reviver: (_kunci, nilai) => {
      const v = nilai as { type?: string; data?: unknown } | null;
      if (v && typeof v === 'object' && v.type === 'Buffer' && typeof v.data === 'string') {
        return Buffer.from(v.data, 'base64');
      }
      return nilai;
    },
  },
  initAuthCreds: () => ({
    noiseKey: { private: Buffer.from('rahasia-noise'), public: Buffer.from('publik-noise') },
    registrationId: 4321,
    me: undefined,
  }),
  proto: { Message: { AppStateSyncKeyData: { fromObject: (objek) => new DataKunciSinkron(objek) } } },
};

type Creds = { noiseKey: { private: Buffer }; registrationId: number; me?: { id: string } };

let nomorUrut = 0;
const buatAkun = async (ubah: { sessionStatus?: string; isActive?: boolean; lastConnectedAt?: Date } = {}) => {
  nomorUrut += 1;
  const akun = await prisma.whatsAppAccount.create({
    data: {
      id: `01TESTAKUNWA${String(nomorUrut).padStart(14, '0')}`,
      label: `Akun ${nomorUrut}`,
      kind: 'personal',
      ...ubah,
    },
  });
  return akun.id;
};

/** Menyimpan creds yang sudah dipasangkan dengan ponsel, seperti setelah QR dipindai. */
const tautkan = async (accountId: string) => {
  const { state, saveCreds } = await muatAuthState(accountId, alat);
  (state.creds as Creds).me = { id: '628111111111:7@s.whatsapp.net' };
  await saveCreds();
};

const jumlahBaris = (accountId: string) => prisma.whatsAppAuthKey.count({ where: { accountId } });

beforeEach(async () => {
  await resetDatabase();
});

describe('Kredensial sesi WhatsApp di database', () => {
  it('akun tanpa kredensial mendapat kredensial baru, supaya sambungannya memunculkan QR', async () => {
    const id = await buatAkun();
    const { state } = await muatAuthState(id, alat);

    expect((state.creds as Creds).registrationId).toBe(4321);
    expect((state.creds as Creds).me).toBeUndefined();
    expect(await jumlahBaris(id)).toBe(0);
  });

  it('creds yang disimpan kembali utuh, termasuk Buffer', async () => {
    const id = await buatAkun();
    await tautkan(id);

    const { state } = await muatAuthState(id, alat);
    const creds = state.creds as Creds;
    expect(creds.me?.id).toBe('628111111111:7@s.whatsapp.net');
    // Kunci Signal yang kembali sebagai objek biasa, bukan Buffer, membuat
    // Baileys gagal mendekripsi pesan tanpa pesan galat yang jelas.
    expect(Buffer.isBuffer(creds.noiseKey.private)).toBe(true);
    expect(creds.noiseKey.private.toString()).toBe('rahasia-noise');
  });

  it('isinya tersimpan terenkripsi, bukan teks terbuka', async () => {
    const id = await buatAkun();
    await tautkan(id);

    const baris = await prisma.whatsAppAuthKey.findMany({ where: { accountId: id } });
    expect(baris).toHaveLength(1);
    expect(isCiphertext(baris[0].value)).toBe(true);
    expect(baris[0].value).not.toContain('628111111111');
  });

  it('kunci Signal bisa disimpan, dibaca, dan dihapus dengan nilai kosong', async () => {
    const id = await buatAkun();
    const { state } = await muatAuthState(id, alat);

    await state.keys.set({
      'pre-key': {
        '1': { private: Buffer.from('satu') },
        '2': { private: Buffer.from('dua') },
      },
    });
    let hasil = await state.keys.get('pre-key', ['1', '2', '3']);
    expect(Object.keys(hasil).sort()).toEqual(['1', '2']);
    expect((hasil['1'] as { private: Buffer }).private.toString()).toBe('satu');

    await state.keys.set({ 'pre-key': { '1': null } });
    hasil = await state.keys.get('pre-key', ['1', '2']);
    expect(Object.keys(hasil)).toEqual(['2']);
  });

  it('kunci sinkronisasi riwayat kembali sebagai objek proto', async () => {
    const id = await buatAkun();
    const { state } = await muatAuthState(id, alat);

    await state.keys.set({ 'app-state-sync-key': { AAAA: { keyData: Buffer.from('k') } } });
    const hasil = await state.keys.get('app-state-sync-key', ['AAAA']);

    expect(hasil.AAAA).toBeInstanceOf(DataKunciSinkron);
  });

  it('menyimpan ratusan kunci sekaligus, seperti saat nomor pertama kali tertaut', async () => {
    const id = await buatAkun();
    const { state } = await muatAuthState(id, alat);

    const preKey: Record<string, unknown> = {};
    for (let i = 1; i <= 1200; i += 1) preKey[String(i)] = { private: Buffer.from(`k${i}`) };
    await state.keys.set({ 'pre-key': preKey });

    expect(await jumlahBaris(id)).toBe(1200);
    const hasil = await state.keys.get('pre-key', ['1', '600', '1200']);
    expect((hasil['1200'] as { private: Buffer }).private.toString()).toBe('k1200');

    // Ditulis ulang: diperbarui, bukan digandakan.
    await state.keys.set({ 'pre-key': { '1': { private: Buffer.from('baru') } } });
    expect(await jumlahBaris(id)).toBe(1200);
    expect(((await state.keys.get('pre-key', ['1']))['1'] as { private: Buffer }).private.toString()).toBe('baru');
  });

  it('kunci satu akun tidak terbaca oleh akun lain', async () => {
    const a = await buatAkun();
    const b = await buatAkun();
    await (await muatAuthState(a, alat)).state.keys.set({ session: { 'x.0': { milik: 'a' } } });

    const hasil = await (await muatAuthState(b, alat)).state.keys.get('session', ['x.0']);
    expect(hasil).toEqual({});
  });

  it('ikut terhapus bila akunnya dihapus', async () => {
    const id = await buatAkun();
    await tautkan(id);

    await prisma.whatsAppAccount.delete({ where: { id } });
    expect(await jumlahBaris(id)).toBe(0);
  });
});

describe('Membuang kredensial yang tidak sah lagi', () => {
  it('menghapus creds dan seluruh kunci akun itu saja', async () => {
    const id = await buatAkun();
    const lain = await buatAkun();
    await tautkan(id);
    await tautkan(lain);
    await (await muatAuthState(id, alat)).state.keys.set({ 'pre-key': { '1': { a: 1 } } });

    await hapusKredensialTersimpan(id);

    expect(await jumlahBaris(id)).toBe(0);
    expect(await jumlahBaris(lain)).toBe(1);
    // Dimuat lagi: kredensial baru, jadi sambungan berikutnya memunculkan QR.
    expect(((await muatAuthState(id, alat)).state.creds as Creds).me).toBeUndefined();
  });

  it('tulisan soket lama sesudahnya tidak menghidupkan kredensial kembali', async () => {
    // Soket yang baru saja di-logout masih bisa memancarkan creds.update atau
    // menyimpan kunci dari pesan yang sedang diproses.
    const id = await buatAkun();
    const lama = await muatAuthState(id, alat);
    (lama.state.creds as Creds).me = { id: '628111111111:7@s.whatsapp.net' };
    await lama.saveCreds();

    await hapusKredensialTersimpan(id);
    await lama.saveCreds();
    await lama.state.keys.set({ session: { 'x.0': { a: 1 } } });

    expect(await jumlahBaris(id)).toBe(0);

    // Soket baru yang dibuka sesudahnya tetap bisa menyimpan.
    const baru = await muatAuthState(id, alat);
    await baru.saveCreds();
    expect(await jumlahBaris(id)).toBe(1);
  });

  it('tulisan yang masih mengantre saat dihapus ikut dibatalkan', async () => {
    const id = await buatAkun();
    const lama = await muatAuthState(id, alat);

    // Tidak ditunggu: penghapusan datang saat simpanan ini masih di antrean.
    const simpan = lama.saveCreds();
    const hapus = hapusKredensialTersimpan(id);
    await Promise.all([simpan, hapus]);

    expect(await jumlahBaris(id)).toBe(0);
  });
});

describe('Nomor yang dibuka ulang saat backend mulai', () => {
  it('hanya yang benar-benar pernah tertaut dan kredensialnya masih ada', async () => {
    const tertaut = await buatAkun({ sessionStatus: 'connected', lastConnectedAt: new Date() });
    await tautkan(tertaut);

    const putusSementara = await buatAkun({ sessionStatus: 'disconnected', lastConnectedAt: new Date() });
    await tautkan(putusSementara);

    // Kasus "Administrator": QR-nya pernah kedaluwarsa sehingga tercatat
    // terputus, padahal belum pernah dipindai. Dulu dibuka di setiap deploy.
    await buatAkun({ sessionStatus: 'disconnected' });

    // Creds sisa QR yang belum dipindai: membukanya hanya memunculkan QR.
    const sisaQr = await buatAkun({ sessionStatus: 'disconnected' });
    await (await muatAuthState(sisaQr, alat)).saveCreds();

    // Di-logout dari ponsel: kredensialnya sudah dibuang.
    const dilogout = await buatAkun({ sessionStatus: 'pending_scan', lastConnectedAt: new Date() });
    await tautkan(dilogout);
    await hapusKredensialTersimpan(dilogout);

    const nonaktif = await buatAkun({ sessionStatus: 'connected', isActive: false, lastConnectedAt: new Date() });
    await tautkan(nonaktif);

    const akun = await akunUntukDibukaUlang();
    expect(akun.map((a) => a.id).sort()).toEqual([tertaut, putusSementara].sort());
  });

  it('creds yang tidak bisa dibaca dilewati, bukan menggagalkan boot', async () => {
    const id = await buatAkun({ sessionStatus: 'connected', lastConnectedAt: new Date() });
    await prisma.whatsAppAuthKey.create({
      data: { id: generateULID(), accountId: id, category: 'creds', keyId: '', value: 'v1.rusak.rusak.rusak' },
    });

    expect(await akunDenganTautanTersimpan([id])).toEqual(new Set());
  });
});
