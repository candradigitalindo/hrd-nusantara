// Pembuat seluruh ikon aplikasi dari satu sumber bentuk.
//
// Lambangnya menggambarkan Presensi: kalender dengan centang — bentuk yang
// sama dipakai menu Presensi di web (lucide CalendarCheck), digambar ulang
// dengan garis lebih tebal supaya tetap tegas pada ikon peluncur 48 px.
//
// Jalankan dari akar repo:  node merek/buat-ikon.mjs
// Keluarannya (favicon web, mipmap Android, AppIcon iOS) ikut di-commit
// supaya build tidak bergantung pada skrip ini.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const akar = join(dirname(fileURLToPath(import.meta.url)), '..');
// Tidak ada package.json di akar repo; sharp (dengan librsvg) sudah terpasang
// sebagai bagian dari Next di frontend, jadi dipakai dari sana.
const sharp = createRequire(pathToFileURL(join(akar, 'frontend', 'package.json')))('sharp');

// ---- Warna merek, sama dengan globals.css dan core/tema.dart ----
const HIJAU = '#4A7C62';
const PUTIH = '#FFFFFF';
const EMAS = '#D9A627';

/**
 * Glif di dalam kotak 64×64. Isinya membentang x 13–51, y 11,5–51: sengaja
 * menyisakan tepi supaya aman dipotong bulat maupun squircle.
 */
const glif = ({ kalender, centang }) => `
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <g stroke="${kalender}" stroke-width="3.6">
      <rect x="13" y="17" width="38" height="34" rx="5"/>
      <path d="M23 11.5v7M41 11.5v7"/>
      <path d="M13 28h38"/>
    </g>
    <path d="M23.5 39 29.5 45 41 33" stroke="${centang}" stroke-width="4.8"/>
  </g>`;

/** Ikon utuh: petak hijau bersudut tumpul + glif. Dipakai favicon dan ikon peluncur. */
const svgPetak = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512" role="img" aria-label="HRD Nusantara">
  <title>HRD Nusantara — presensi</title>
  <rect width="64" height="64" rx="14" fill="${HIJAU}"/>${glif({ kalender: PUTIH, centang: EMAS })}
</svg>
`;

/** Ikon iOS tidak boleh transparan dan sudutnya dipotong sistem: tanpa rx. */
const svgPetakSiku = svgPetak.replace('rx="14" ', '');

/**
 * Lapisan depan ikon adaptif Android: kanvas 108dp, glif di zona aman 66dp.
 * Latarnya lapisan warna terpisah (@color/ic_launcher_background).
 */
const svgLapisanDepan = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108" width="432" height="432">
  <g transform="translate(4 4) scale(1.5625)">${glif({ kalender: PUTIH, centang: EMAS })}</g>
</svg>
`;

const tulis = (relatif, isi) => {
  const tujuan = join(akar, relatif);
  mkdirSync(dirname(tujuan), { recursive: true });
  writeFileSync(tujuan, isi);
  return relatif;
};

const png = async (svg, ukuran, relatif, { tanpaAlfa = false } = {}) => {
  const tujuan = join(akar, relatif);
  mkdirSync(dirname(tujuan), { recursive: true });
  let gambar = sharp(Buffer.from(svg), { density: 384 }).resize(ukuran, ukuran);
  if (tanpaAlfa) gambar = gambar.flatten({ background: HIJAU }).removeAlpha();
  await gambar.png({ compressionLevel: 9 }).toFile(tujuan);
  return `${relatif} (${ukuran}px)`;
};

/** ICO = wadah sederhana; tiap ukuran disimpan sebagai PNG di dalamnya. */
const ico = async (svg, ukuran, relatif) => {
  const gambar = await Promise.all(
    ukuran.map((u) => sharp(Buffer.from(svg), { density: 384 }).resize(u, u).png({ compressionLevel: 9 }).toBuffer())
  );
  const kepala = Buffer.alloc(6);
  kepala.writeUInt16LE(0, 0); // reserved
  kepala.writeUInt16LE(1, 2); // type: ikon
  kepala.writeUInt16LE(ukuran.length, 4);
  let offset = 6 + 16 * ukuran.length;
  const entri = ukuran.map((u, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(u >= 256 ? 0 : u, 0);
    e.writeUInt8(u >= 256 ? 0 : u, 1);
    e.writeUInt8(0, 2); // jumlah warna palet
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bit per piksel
    e.writeUInt32LE(gambar[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += gambar[i].length;
    return e;
  });
  return tulis(relatif, Buffer.concat([kepala, ...entri, ...gambar]));
};

// Kerapatan Android: mdpi sebagai acuan 1×.
const KERAPATAN = [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]];

const hasil = [];
const main = async () => {
  // ---- Sumber bentuk, ikut disimpan agar bisa dipakai perancang ----
  hasil.push(tulis('merek/ikon-presensi.svg', svgPetak));
  hasil.push(tulis('merek/ikon-presensi-lapisan-depan.svg', svgLapisanDepan));

  // ---- Web ----
  hasil.push(tulis('frontend/src/app/icon.svg', svgPetak));
  hasil.push(await png(svgPetak, 180, 'frontend/src/app/apple-icon.png'));
  hasil.push(await ico(svgPetak, [16, 32, 48], 'frontend/src/app/favicon.ico'));

  // ---- Android: ikon lama (petak utuh) + lapisan depan ikon adaptif ----
  for (const [nama, faktor] of KERAPATAN) {
    hasil.push(await png(svgPetak, Math.round(48 * faktor), `mobile/android/app/src/main/res/mipmap-${nama}/ic_launcher.png`));
    hasil.push(
      await png(svgLapisanDepan, Math.round(108 * faktor), `mobile/android/app/src/main/res/mipmap-${nama}/ic_launcher_foreground.png`)
    );
  }

  // ---- iOS: ukuran diambil dari Contents.json yang sudah ada ----
  // Tanpa kanal alfa sama sekali: App Store menolak ikon 1024 yang RGBA
  // (ITMS-90717) walaupun semua pikselnya opak.
  const setIkon = 'mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset';
  const daftar = JSON.parse(readFileSync(join(akar, setIkon, 'Contents.json'), 'utf8'));
  for (const item of daftar.images) {
    const ukuran = Math.round(parseFloat(item.size) * parseFloat(item.scale));
    hasil.push(await png(svgPetakSiku, ukuran, `${setIkon}/${item.filename}`, { tanpaAlfa: true }));
  }

  console.log(hasil.join('\n'));
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
