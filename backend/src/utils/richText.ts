// src/utils/richText.ts
//
// Teks berformat dari editor WYSIWYG di web.
//
// Dua aturan yang menentukan bentuk berkas ini:
//
// 1. HTML dari klien TIDAK PERNAH dipercaya. Yang disimpan adalah hasil
//    pembersihan di server dengan daftar putih; pembersihan di peramban hanya
//    kenyamanan tampilan, dan siapa pun bisa memanggil API tanpa peramban.
// 2. Versi teks polosnya selalu ikut disimpan. Aplikasi Android yang sudah
//    terpasang menampilkan kolom lama apa adanya — kalau isinya berubah jadi
//    HTML, yang terbaca di sana adalah tag mentah.
import sanitizeHtml from 'sanitize-html';

/** Batas panjang HTML yang disimpan; jauh di atas kebutuhan wajar satu pengumuman. */
export const BATAS_HTML = 200_000;

/**
 * Daftar putih tag dan atribut.
 *
 * Tidak ada <img>, <iframe>, <script>, <style>, maupun atribut on*: gambar
 * perlu jalur unggahan tersendiri, dan sisanya adalah jalan masuk skrip.
 */
const ATURAN: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'hr',
    'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'mark', 'code', 'pre',
    'h1', 'h2', 'h3', 'h4',
    'ul', 'ol', 'li',
    'blockquote',
    'a',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'span', 'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
    '*': ['style'],
  },
  // Hanya properti gaya yang memang dihasilkan editor, dengan nilai yang
  // dibatasi polanya — "style" bebas adalah pintu untuk url(javascript:…).
  allowedStyles: {
    '*': {
      'text-align': [/^(left|right|center|justify)$/],
      color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/],
      'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/],
    },
  },
  // Skema tautan dibatasi: javascript:, data:, dan vbscript: ditolak.
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href'],
  // Tautan keluar dibuka di tab baru tanpa membawa akses ke halaman asal.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer nofollow' }),
  },
  disallowedTagsMode: 'discard',
};

/** HTML yang sudah aman disimpan dan ditampilkan; string kosong bila tidak ada isinya. */
export const bersihkanHtml = (html: string | null | undefined): string => {
  if (!html) return '';
  const bersih = sanitizeHtml(html.slice(0, BATAS_HTML), ATURAN).trim();
  // Editor mengirim <p></p> untuk isi kosong; itu bukan isi.
  return teksDariHtml(bersih).trim() === '' ? '' : bersih;
};

const ENTITAS: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

/**
 * Teks polos dari HTML, dengan pergantian baris dipertahankan.
 *
 * Inilah yang dibaca klien lama dan dipakai sebagai bahan pencarian, jadi
 * "satu paragraf per baris" lebih berguna daripada membuang semua spasi.
 */
export const teksDariHtml = (html: string | null | undefined): string => {
  if (!html) return '';
  return html
    .replace(/<\s*(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|li|h[1-4]|tr|blockquote|pre)\s*>/gi, '\n')
    .replace(/<\s*li\s*[^>]*>/gi, '• ')
    .replace(/<\/\s*t[dh]\s*>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, kode: string) => String.fromCharCode(Number(kode)))
    .replace(/&[a-z]+;|&#39;/gi, (e) => ENTITAS[e.toLowerCase()] ?? e)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/**
 * Menyiapkan sepasang kolom dari satu masukan.
 *
 * Bila klien mengirim HTML, teks polosnya diturunkan dari situ — bukan dari
 * kiriman terpisah — supaya keduanya tidak pernah bercerita berbeda. Bila
 * klien lama hanya mengirim teks polos, kolom HTML dikosongkan.
 */
export const pasanganTeks = (
  html: string | null | undefined,
  teksPolos: string | null | undefined
): { html: string | null; teks: string } | null => {
  if (html !== undefined && html !== null) {
    const bersih = bersihkanHtml(html);
    if (bersih === '') return teksPolos !== undefined && teksPolos !== null ? { html: null, teks: teksPolos } : null;
    return { html: bersih, teks: teksDariHtml(bersih) };
  }
  if (teksPolos !== undefined && teksPolos !== null) return { html: null, teks: teksPolos };
  return null;
};

// Catatan versi: sanitize-html dipatok di 2.17.0. Rilis yang lebih baru
// menarik htmlparser2 v12 yang hanya ESM, sedangkan test dan build proyek ini
// berjalan sebagai CommonJS — hasilnya seluruh suite gagal dimuat.
