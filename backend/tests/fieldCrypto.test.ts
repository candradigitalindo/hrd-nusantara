import {
  encryptField,
  decryptField,
  isCiphertext,
  tokenizeText,
  blindIndex,
  buildSearchTokens,
} from '../src/utils/fieldCrypto';
import { retentionCutoff } from '../src/utils/whatsappRetention';

describe('Enkripsi kolom', () => {
  it('mengembalikan teks asli setelah dienkripsi lalu didekripsi', () => {
    const asli = 'Keluhan tamu kamar 203: AC tidak dingin sejak semalam';
    expect(decryptField(encryptField(asli))).toBe(asli);
  });

  it('tidak menyisakan jejak teks asli di dalam ciphertext', () => {
    const sandi = encryptField('nomor kartu tamu 4111 1111 1111 1111');

    expect(sandi).not.toContain('4111');
    expect(sandi).not.toContain('kartu');
    // Yang tersimpan di database harus tidak berarti apa-apa bagi yang
    // membacanya langsung.
    expect(sandi.startsWith('v1.')).toBe(true);
  });

  it('menghasilkan ciphertext berbeda untuk teks yang sama', () => {
    // IV acak. Kalau dua pesan identik menghasilkan ciphertext identik,
    // yang memegang database bisa menghitung pesan mana yang berulang
    // tanpa pernah membukanya.
    const a = encryptField('baik pak');
    const b = encryptField('baik pak');

    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe(decryptField(b));
  });

  it('menolak ciphertext yang diubah orang', () => {
    const sandi = encryptField('gaji Budi 8.500.000');
    const [versi, iv, tag, ct] = sandi.split('.');

    // Membalik satu karakter pada bagian isi.
    const dirusak = [versi, iv, tag, (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1)].join('.');

    // Tag GCM yang menangkap ini. Tanpa tag, hasilnya adalah teks sampah
    // yang diam-diam dipercaya sebagai isi pesan.
    expect(() => decryptField(dirusak)).toThrow();
  });

  it('melewatkan baris lama yang masih tersimpan terbuka', () => {
    // Baris yang ditulis sebelum enkripsi ada harus tetap terbaca,
    // bukan menjatuhkan seluruh daftar arsip.
    expect(decryptField('pesan lama sebelum enkripsi')).toBe('pesan lama sebelum enkripsi');
    expect(isCiphertext('pesan lama sebelum enkripsi')).toBe(false);
    expect(isCiphertext(encryptField('x'))).toBe(true);
  });

  it('menangani teks kosong dan karakter non-latin', () => {
    expect(decryptField(encryptField(''))).toBe('');
    expect(decryptField(encryptField('terima kasih 🙏 感谢'))).toBe('terima kasih 🙏 感谢');
  });
});

describe('Indeks buta untuk pencarian', () => {
  it('memecah teks menjadi kata unik tanpa tanda baca', () => {
    expect(tokenizeText('Keluhan: pesanan LAMA, pesanan salah!')).toEqual([
      'keluhan',
      'pesanan',
      'lama',
      'salah',
    ]);
  });

  it('membuang kata satu huruf', () => {
    // Satu huruf cocok dengan hampir semua pesan, jadi tidak berguna
    // sebagai penyaring dan hanya membengkakkan indeks.
    expect(tokenizeText('a b ac')).toEqual(['ac']);
  });

  it('membatasi jumlah token per pesan', () => {
    const banyak = Array.from({ length: 500 }, (_, i) => `kata${i}`).join(' ');
    expect(tokenizeText(banyak)).toHaveLength(200);
  });

  it('menghasilkan token yang sama untuk kata yang sama', () => {
    // Inilah yang membuat pencarian mungkin: kata yang dicari menghasilkan
    // token yang sama seperti saat pesan disimpan.
    expect(blindIndex('reservasi')).toBe(blindIndex('reservasi'));
    expect(blindIndex('reservasi')).not.toBe(blindIndex('reservas'));
  });

  it('tidak bisa dibalikkan menjadi kata aslinya', () => {
    const token = blindIndex('rahasia');

    expect(token).not.toContain('rahasia');
    expect(token).toMatch(/^[0-9a-f]{20}$/);
  });

  it('tidak membedakan huruf besar kecil saat mencari', () => {
    const disimpan = buildSearchTokens('Keluhan: pesanan lama');

    expect(disimpan).toContain(blindIndex('keluhan'));
    expect(buildSearchTokens('KELUHAN')[0]).toBe(blindIndex('keluhan'));
  });
});

describe('Batas masa simpan arsip', () => {
  const sekarang = new Date('2026-09-17T10:00:00.000Z');

  it('menghitung batas mundur sebanyak hari yang diatur', () => {
    expect(retentionCutoff(sekarang, 30)).toEqual(new Date('2026-08-18T10:00:00.000Z'));
  });

  it('mengembalikan null kalau retensi tidak diatur', () => {
    // null berarti "jangan hapus apa pun". Menafsirkannya sebagai
    // "hapus semua" akan menghabiskan seluruh arsip.
    expect(retentionCutoff(sekarang, 0)).toBeNull();
    expect(retentionCutoff(sekarang, -5)).toBeNull();
    expect(retentionCutoff(sekarang, NaN)).toBeNull();
  });
});
