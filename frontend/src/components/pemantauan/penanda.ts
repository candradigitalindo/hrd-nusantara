// Pembuat ikon penanda peta linimasa (L.divIcon) beserta cache-nya.
//
// Ikon di-cache per kunci keadaan: react-leaflet memanggil setIcon setiap
// identitas ikon berubah, jadi ikon yang sama harus objek yang sama supaya
// DOM penanda tidak dibangun ulang tiap render. Isi HTML hanya angka dan
// glyph konstanta — teks buatan admin (nama/alamat lokasi) TIDAK PERNAH
// masuk ke sini karena divIcon memakai innerHTML; teks itu lewat <Tooltip>.

import L from "leaflet";

// Path SVG disalin dari lucide (lisensi ISC) agar penanda tidak butuh React.
const GLYPH = {
  gedung:
    '<path d="M10 12h4"/><path d="M10 8h4"/><path d="M14 21v-3a2 2 0 0 0-4 0v3"/><path d="M6 10H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-2"/><path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/>',
  masuk: '<path d="m10 17 5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>',
  pulang: '<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
} as const;

const svg = (isi: string) => `<svg viewBox="0 0 24 24" aria-hidden="true">${isi}</svg>`;

/** Jaring pengaman: semua yang masuk HTML divIcon di-escape walau asalnya modul sendiri. */
export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const cache = new Map<string, L.DivIcon>();

const ikon = (kunci: string, html: string): L.DivIcon => {
  let i = cache.get(kunci);
  if (!i) {
    // className sendiri menggantikan kotak putih bawaan .leaflet-div-icon;
    // iconSize [0,0] + isi translate(-50%,-50%) membuat pemusatan tidak
    // bergantung pada lebar pil yang berubah-ubah.
    i = L.divIcon({ className: "rl-penanda", html, iconSize: [0, 0] });
    cache.set(kunci, i);
  }
  return i;
};

const atributKeadaan = (aktif: boolean, terkait = false) =>
  `${aktif ? ' data-aktif="true"' : ""}${terkait ? ' data-terkait="true"' : ""}`;

/** "2 · 4 · 6"; lebih dari tiga nomor: "2 · 4 +2". */
export const teksNomor = (nomor: number[]): string => {
  if (nomor.length <= 3) return nomor.join(" · ");
  return `${nomor.slice(0, 2).join(" · ")} +${nomor.length - 2}`;
};

/**
 * Pil nomor urut singgah, satu per tempat (kunjungan berulang tidak bertumpuk).
 * Presensi yang koordinatnya jatuh di tempat ini menempel sebagai lencana di
 * sudut pil, supaya benderanya tidak menutupi nomor.
 */
export const ikonTempat = (o: {
  kerja: boolean;
  nomor: number[];
  label: string;
  aktif: boolean;
  terkait: boolean;
  presensi: ("masuk" | "pulang")[];
  presensiBahaya: boolean;
  /** Hari ini dan karyawan sedang berada di tempat ini: pil berdenyut biru, bukan titik terpisah. */
  langsung: boolean;
}) => {
  const teks = o.nomor.length ? teksNomor(o.nomor) : o.label;
  // Hanya nomor urut dan huruf "A".."Z" buatan modul — bukan nama tempat.
  const isi = escapeHtml(teks).replace(/ · /g, " <i>·</i> ").replace(/ \+/, " <i>+</i>");
  const jenisPresensi = [...new Set(o.presensi)];
  const lencana = jenisPresensi.length
    ? `<span class="lencana-presensi"${o.presensiBahaya ? ' data-bahaya="true"' : ""}>${jenisPresensi.map((j) => svg(j === "masuk" ? GLYPH.masuk : GLYPH.pulang)).join("")}</span>`
    : "";
  const kunci = `tempat|${o.kerja ? 1 : 0}|${teks}|${o.aktif ? 1 : 0}|${o.terkait ? 1 : 0}|${jenisPresensi.join(",")}|${o.presensiBahaya ? 1 : 0}|${o.langsung ? 1 : 0}`;
  return ikon(
    kunci,
    `<div class="penanda-tempat penanda-tempat--${o.kerja ? "kerja" : "lain"}"${atributKeadaan(o.aktif, o.terkait || o.langsung)}${o.langsung ? ' data-langsung="true"' : ""}>${o.kerja ? svg(GLYPH.gedung) : ""}${isi ? `<span>${isi}</span>` : ""}${lencana}</div>`,
  );
};

/** Titik kecil pengganti pil yang tertutup pil lain pada zoom ini; kembali jadi pil saat diperbesar. */
export const ikonTempatRingkas = (o: { kerja: boolean; terkait: boolean }) =>
  ikon(
    `tempat-ringkas|${o.kerja ? 1 : 0}|${o.terkait ? 1 : 0}`,
    `<div class="penanda-tempat-ringkas penanda-tempat-ringkas--${o.kerja ? "kerja" : "lain"}"${atributKeadaan(false, o.terkait)}></div>`,
  );

/** Perkiraan lebar pil (px) untuk menghitung tumpang-tindih tanpa mengukur DOM. */
export const lebarPil = (o: { kerja: boolean; nomor: number[]; label: string }) => {
  const teks = o.nomor.length ? teksNomor(o.nomor) : o.label;
  return teks.length * 7 + (o.kerja ? 17 : 0) + 22;
};

/** Bendera presensi masuk/pulang di atas koordinatnya; `sisi` menggeser yang berdempetan. */
export const ikonPresensi = (o: { jenis: "masuk" | "pulang"; sisi: "kanan" | "kiri"; cocok: string; aktif: boolean }) =>
  ikon(
    `presensi|${o.jenis}|${o.sisi}|${o.cocok}|${o.aktif ? 1 : 0}`,
    `<div class="penanda-presensi" data-sisi="${o.sisi}" data-cocok="${escapeHtml(o.cocok)}"${atributKeadaan(o.aktif, true)}><span class="tiang"></span><span class="kaki"></span><span class="bendera">${svg(o.jenis === "masuk" ? GLYPH.masuk : GLYPH.pulang)}</span></div>`,
  );

/** Belah ketupat merah untuk titik yang ditandai palsu oleh sistem ponsel. */
export const ikonPalsu = (aktif: boolean) =>
  ikon(`palsu|${aktif ? 1 : 0}`, `<div class="penanda-palsu"${atributKeadaan(aktif, true)}></div>`);

/** Titik disaring (janggal / akurasi buruk) yang sedang difokuskan dari "Perlu diperiksa". */
export const ikonDisaring = (alasan: "janggal" | "akurasi") =>
  ikon(`disaring|${alasan}`, `<div class="penanda-disaring" data-alasan="${alasan}" data-aktif="true"></div>`);

export const ikonAwal = () => ikon("awal", '<div class="penanda-awal" data-terkait="true"></div>');
/** Posisi jejak sebenarnya saat titik palsu tercatat (pasangan garis "… dari jejak"). */
export const ikonPasangan = () => ikon("pasangan", '<div class="penanda-pasangan" data-aktif="true"></div>');
export const ikonAkhir = () => ikon("akhir", '<div class="penanda-akhir" data-terkait="true"></div>');
export const ikonTerlihat = (aktif: boolean) =>
  ikon(`terlihat|${aktif ? 1 : 0}`, `<div class="penanda-terlihat"${atributKeadaan(aktif)}></div>`);
export const ikonLangsung = () =>
  ikon("langsung", '<div class="penanda-langsung" data-terkait="true"><span class="denyut"></span><span class="titik"></span></div>');

/** Chevron arah perjalanan; sudut dibulatkan 5° supaya cache tetap kecil. */
export const ikonPanah = (sudut: number) => {
  const s = ((Math.round(sudut / 5) * 5) % 360 + 360) % 360;
  return ikon(`panah|${s}`, `<div class="penanda-panah" style="transform:translate(-50%,-50%) rotate(${s}deg)">${svg(GLYPH.chevron)}</div>`);
};
