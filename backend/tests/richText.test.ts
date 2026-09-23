import { bersihkanHtml, pasanganTeks, teksDariHtml } from '../src/utils/richText';

describe('Pembersihan HTML dari editor', () => {
  it('membuang skrip dan penangan kejadian, menyisakan isinya', () => {
    expect(bersihkanHtml('<p>Halo</p><script>alert(1)</script>')).toBe('<p>Halo</p>');
    expect(bersihkanHtml('<p onclick="curi()">Halo</p>')).toBe('<p>Halo</p>');
    expect(bersihkanHtml('<img src=x onerror="alert(1)">')).toBe('');
    expect(bersihkanHtml('<iframe src="https://jahat.id"></iframe>')).toBe('');
    expect(bersihkanHtml('<style>body{display:none}</style><p>Aman</p>')).toBe('<p>Aman</p>');
  });

  it('menolak tautan berskema berbahaya, menerima http/mailto', () => {
    expect(bersihkanHtml('<a href="javascript:alert(1)">klik</a>')).not.toContain('javascript');
    expect(bersihkanHtml('<a href="data:text/html;base64,PHNjcmlwdD4=">klik</a>')).not.toContain('data:');
    const aman = bersihkanHtml('<a href="https://hrd.nbp.co.id">buka</a>');
    expect(aman).toContain('href="https://hrd.nbp.co.id"');
    // Tautan keluar tidak boleh membawa akses ke halaman asal.
    expect(aman).toContain('rel="noopener noreferrer nofollow"');
    expect(bersihkanHtml('<a href="mailto:hr@resto.id">surel</a>')).toContain('mailto:');
  });

  it('mempertahankan format yang memang dipakai editor', () => {
    const html =
      '<h2>Syarat</h2><ul><li><strong>Tegas</strong> dan <em>miring</em></li></ul>' +
      '<p style="text-align:center">Tengah</p><table><tbody><tr><td>1</td></tr></tbody></table>';
    const bersih = bersihkanHtml(html);
    expect(bersih).toContain('<h2>Syarat</h2>');
    expect(bersih).toContain('<strong>Tegas</strong>');
    expect(bersih).toContain('text-align:center');
    expect(bersih).toContain('<table>');
  });

  it('gaya di luar daftar putih dibuang, termasuk url() yang bisa memuat skrip', () => {
    const bersih = bersihkanHtml('<p style="background-image:url(javascript:alert(1));color:#ff0000">x</p>');
    expect(bersih).not.toContain('background-image');
    expect(bersih).not.toContain('javascript');
    expect(bersih).toContain('color:#ff0000');
  });

  it('isi kosong dianggap tidak ada', () => {
    expect(bersihkanHtml('<p></p>')).toBe('');
    expect(bersihkanHtml('<p><br></p>')).toBe('');
    expect(bersihkanHtml('   ')).toBe('');
    expect(bersihkanHtml(null)).toBe('');
  });
});

describe('Teks polos untuk klien lama', () => {
  it('mempertahankan pergantian baris dan menandai butir daftar', () => {
    expect(teksDariHtml('<p>Baris satu</p><p>Baris dua</p>')).toBe('Baris satu\nBaris dua');
    expect(teksDariHtml('<ul><li>Satu</li><li>Dua</li></ul>')).toBe('• Satu\n• Dua');
    expect(teksDariHtml('Sebelum<br>Sesudah')).toBe('Sebelum\nSesudah');
  });

  it('mengembalikan entitas ke karakter aslinya', () => {
    expect(teksDariHtml('<p>Gaji &gt; 5 juta &amp; bonus</p>')).toBe('Gaji > 5 juta & bonus');
    expect(teksDariHtml('<p>Tanda&nbsp;kutip &quot;ini&quot;</p>')).toBe('Tanda kutip "ini"');
  });
});

describe('Pasangan HTML + teks polos', () => {
  it('teks polos diturunkan dari HTML, bukan dari kiriman terpisah', () => {
    // Kiriman teks polos yang berbeda isinya sengaja diabaikan: dua kolom yang
    // bercerita beda adalah bug yang sulit terlihat.
    expect(pasanganTeks('<p>Isi <strong>asli</strong></p>', 'isi palsu')).toEqual({
      html: '<p>Isi <strong>asli</strong></p>',
      teks: 'Isi asli',
    });
  });

  it('klien lama yang hanya mengirim teks polos mengosongkan kolom HTML', () => {
    expect(pasanganTeks(undefined, 'Teks biasa')).toEqual({ html: null, teks: 'Teks biasa' });
  });

  it('HTML kosong tanpa teks polos berarti tidak ada perubahan', () => {
    expect(pasanganTeks('<p></p>', undefined)).toBeNull();
    expect(pasanganTeks(undefined, undefined)).toBeNull();
  });
});
