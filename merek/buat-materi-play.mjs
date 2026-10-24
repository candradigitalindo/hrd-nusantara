// Materi Google Play memakai ikon merek dan kebijakan yang sama dengan aplikasi.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const akar = join(dirname(fileURLToPath(import.meta.url)), '..');
const sharp = createRequire(join(akar, 'frontend/package.json'))('sharp');
const tujuan = join(akar, 'mobile/play');
mkdirSync(tujuan, { recursive: true });
const ikon = readFileSync(join(akar, 'merek/ikon-presensi.svg'), 'utf8').replace('rx="14"', '');
await sharp(Buffer.from(ikon)).resize(512, 512).flatten({ background: '#4A7C62' }).removeAlpha().png().toFile(join(tujuan, 'icon.png'));

const grafik = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500" viewBox="0 0 1024 500">
<defs><linearGradient id="latar" x2="1" y2="1"><stop stop-color="#244D3A"/><stop offset="1" stop-color="#4A7C62"/></linearGradient></defs>
<rect width="1024" height="500" fill="url(#latar)"/>
<circle cx="950" cy="40" r="260" fill="#FFFFFF" opacity=".035"/>
<circle cx="40" cy="490" r="260" fill="#FFFFFF" opacity=".035"/>
<g transform="translate(70 143)"><rect width="205" height="205" rx="42" fill="#4A7C62"/>
${ikon.replace(/<svg[^>]*>/, '<svg x="0" y="0" width="205" height="205" viewBox="0 0 64 64">')}</g>
<g fill="white" font-family="DejaVu Sans, sans-serif">
<text x="318" y="216" font-size="56" font-weight="700">HRD Nusantara</text>
<text x="320" y="270" font-size="27">Presensi dan layanan karyawan</text>
<rect x="320" y="303" width="238" height="3" rx="1.5" fill="#D9A627"/>
<text x="320" y="348" font-size="19" fill="#E3EBE6">Untuk karyawan perusahaan</text></g></svg>`;
writeFileSync(join(tujuan, 'feature-graphic.svg'), grafik);
await sharp(Buffer.from(grafik)).flatten({ background: '#4A7C62' }).removeAlpha().png().toFile(join(tujuan, 'feature-graphic.png'));

const kebijakan = JSON.parse(readFileSync(join(tujuan, 'privacy-policy-id.json'), 'utf8'));
const lolos = (nilai) => String(nilai).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const bagian = kebijakan.sections.map((b, i) => `<section id="bagian-${i + 1}"><h2>${lolos(b.title)}</h2>${b.paragraphs.map((p) => `<p>${lolos(p)}</p>`).join('')}</section>`).join('\n');
// Cloudflare tidak boleh mengganti kontak publik kebijakan menjadi teks yang
// hanya dapat dibaca setelah JavaScript mendekode alamat email.
const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kebijakan Privasi — ${lolos(kebijakan.appName)}</title><meta name="description" content="Kebijakan privasi aplikasi HRD Nusantara: pengelolaan data, pemantauan lokasi, dan permintaan data karyawan."><link rel="canonical" href="${lolos(kebijakan.publicUrl)}"><style>body{margin:0;background:#f4f7f5;color:#183226;font:17px/1.75 system-ui,sans-serif}main{max-width:780px;margin:40px auto;padding:32px;background:white;border-radius:20px}h1{font-size:34px;line-height:1.2}h2{font-size:22px;margin-top:32px}a{color:#285b3f}.label{color:#4A7C62;font-weight:700}.tanggal{color:#53665b}footer{border-top:1px solid #dce5df;padding-top:20px;margin-top:32px}@media(max-width:600px){main{margin:0;padding:24px 20px;border-radius:0}h1{font-size:28px}}</style></head><body><!--email_off--><main><p class="label">${lolos(kebijakan.appName)}</p><h1>Kebijakan Privasi</h1><p class="tanggal">Diperbarui ${lolos(kebijakan.updatedAt)}</p>${bagian}<footer><p>Kontak pengelola: <a href="mailto:${lolos(kebijakan.contactEmail)}?subject=Permintaan%20Data%20HRD%20Nusantara">${lolos(kebijakan.contactEmail)}</a></p><p><a href="/">Kembali ke HRD Nusantara</a></p></footer></main><!--/email_off--></body></html>\n`;
mkdirSync(join(akar, 'frontend/public'), { recursive: true });
writeFileSync(join(akar, 'frontend/public/kebijakan-privasi.html'), html);
console.log('Ikon 512×512, feature graphic 1024×500, dan halaman kebijakan privasi dibuat.');
