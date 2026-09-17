import { createHmac } from 'crypto';
import {
  normalizePhoneNumber,
  samePhoneNumber,
  resolveScope,
  verifyWebhookSignature,
} from '../src/utils/whatsappRules';

describe('normalizePhoneNumber', () => {
  it('membakukan tiga bentuk penulisan nomor Indonesia ke hasil yang sama', () => {
    const hasil = ['081234567890', '+6281234567890', '6281234567890'].map(normalizePhoneNumber);
    expect(new Set(hasil).size).toBe(1);
    expect(hasil[0]).toBe('6281234567890');
  });

  it('mengabaikan spasi, tanda hubung, dan kurung', () => {
    expect(normalizePhoneNumber('+62 812-3456-7890')).toBe('6281234567890');
    expect(normalizePhoneNumber('(0812) 3456 7890')).toBe('6281234567890');
  });

  it('membiarkan nomor asing apa adanya', () => {
    // Pelanggan luar negeri tetap menghubungi nomor perusahaan.
    expect(normalizePhoneNumber('+1 415 555 0123')).toBe('14155550123');
  });

  it('menolak masukan yang terlalu pendek', () => {
    expect(normalizePhoneNumber('12345')).toBeNull();
    expect(normalizePhoneNumber('')).toBeNull();
    expect(normalizePhoneNumber('bukan nomor')).toBeNull();
  });

  it('menolak nomor delapan digit yang hampir pasti salah ketik', () => {
    // Nomor rusak yang lolos akan masuk daftar nomor perusahaan — daftar
    // yang justru menjadi penegak ruang lingkup pemantauan.
    expect(normalizePhoneNumber('12345678')).toBeNull();
    expect(normalizePhoneNumber('0812345')).toBeNull();
  });

  it('menerima nomor lengkap yang sah', () => {
    expect(normalizePhoneNumber('081234567890')).toBe('6281234567890');
    expect(normalizePhoneNumber('+14155550123')).toBe('14155550123');
  });
});

describe('samePhoneNumber', () => {
  it('menyamakan bentuk penulisan yang berbeda', () => {
    expect(samePhoneNumber('081234567890', '+6281234567890')).toBe(true);
  });

  it('membedakan nomor yang memang berbeda', () => {
    expect(samePhoneNumber('081234567890', '081234567891')).toBe(false);
  });

  it('tidak menyamakan dua masukan yang sama-sama tidak sah', () => {
    expect(samePhoneNumber('abc', 'abc')).toBe(false);
  });
});

describe('resolveScope', () => {
  const perusahaan = new Set(['628111111111']);

  it('menerima pesan masuk ke nomor perusahaan', () => {
    const h = resolveScope({ from: '08222222222', to: '08111111111', companyNumbers: perusahaan });

    expect(h.allowed).toBe(true);
    expect(h.direction).toBe('incoming');
    expect(h.companyNumber).toBe('628111111111');
    expect(h.contactNumber).toBe('628222222222');
  });

  it('menerima pesan keluar dari nomor perusahaan', () => {
    const h = resolveScope({ from: '08111111111', to: '08222222222', companyNumbers: perusahaan });

    expect(h.allowed).toBe(true);
    expect(h.direction).toBe('outgoing');
    expect(h.companyNumber).toBe('628111111111');
  });

  it('menolak percakapan antar dua nomor pribadi', () => {
    // Inilah batasan yang membedakan pemantauan kanal kerja dari
    // penyadapan komunikasi pribadi.
    const h = resolveScope({ from: '08222222222', to: '08333333333', companyNumbers: perusahaan });

    expect(h.allowed).toBe(false);
    expect(h.rejection).toBe('not_company_number');
  });

  it('mencocokkan daftar walau bentuk penulisannya berbeda', () => {
    // Daftar menyimpan 628..., pesan datang sebagai 08...
    const h = resolveScope({ from: '08222222222', to: '+62 811-111-1111', companyNumbers: perusahaan });
    expect(h.allowed).toBe(true);
  });

  it('menolak nomor yang tidak sah', () => {
    const h = resolveScope({ from: 'xyz', to: '08111111111', companyNumbers: perusahaan });
    expect(h.rejection).toBe('invalid_number');
  });

  it('memperlakukan pengirim sebagai pemilik arsip bila keduanya nomor perusahaan', () => {
    const dua = new Set(['628111111111', '628999999999']);
    const h = resolveScope({ from: '08111111111', to: '08999999999', companyNumbers: dua });

    expect(h.allowed).toBe(true);
    expect(h.companyNumber).toBe('628111111111');
    expect(h.direction).toBe('outgoing');
  });
});

describe('verifyWebhookSignature', () => {
  const secret = 'rahasia-webhook-bellys';
  const body = JSON.stringify({ messageId: 'abc', text: 'halo' });
  const tandaTangan = createHmac('sha256', secret).update(body).digest('hex');

  it('menerima tanda tangan yang benar', () => {
    expect(verifyWebhookSignature({ rawBody: body, signature: tandaTangan, secret })).toBe(true);
  });

  it('menerima bentuk berawalan sha256=', () => {
    expect(
      verifyWebhookSignature({ rawBody: body, signature: `sha256=${tandaTangan}`, secret })
    ).toBe(true);
  });

  it('menolak tanda tangan yang salah', () => {
    const palsu = createHmac('sha256', 'kunci-lain').update(body).digest('hex');
    expect(verifyWebhookSignature({ rawBody: body, signature: palsu, secret })).toBe(false);
  });

  it('menolak bila isi pesannya diubah', () => {
    // Tanpa ini, siapa pun yang tahu alamat webhook bisa menyisipkan
    // percakapan palsu ke arsip yang dipakai audit.
    const diubah = JSON.stringify({ messageId: 'abc', text: 'sudah diubah' });
    expect(verifyWebhookSignature({ rawBody: diubah, signature: tandaTangan, secret })).toBe(false);
  });

  it('menolak bila tanda tangannya tidak ada', () => {
    expect(verifyWebhookSignature({ rawBody: body, signature: undefined, secret })).toBe(false);
  });

  it('menolak tanda tangan yang panjangnya berbeda tanpa melempar error', () => {
    expect(verifyWebhookSignature({ rawBody: body, signature: 'pendek', secret })).toBe(false);
  });
});
