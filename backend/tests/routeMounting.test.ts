import fs from 'fs';
import path from 'path';

/**
 * Penjaga terhadap satu kelas bug yang sudah dua kali terjadi di proyek ini.
 *
 * Hampir semua router di-mount di akar /api. Middleware yang dipasang lewat
 * router.use() berjalan untuk SEMUA permintaan /api/* yang melewati router
 * itu — bukan hanya rute miliknya. router.use(requireRole(HR)) di satu router
 * membuat setiap router yang di-mount sesudahnya menolak karyawan biasa
 * dengan 403, dan gejalanya baru terlihat di suite penuh, bukan saat
 * berkas test router itu dijalankan sendirian.
 *
 * authenticateToken adalah satu-satunya yang boleh di router.use(): idempoten
 * dan memang dituntut semua router yang di-mount di /api. Webhook, yang tidak
 * memakai JWT, karena itu harus di-mount sebelum semuanya — dan itu dijaga
 * di bawah.
 */
const DIR_RUTE = path.resolve(__dirname, '../src/routes');
const berkasRute = fs.readdirSync(DIR_RUTE).filter((f) => f.endsWith('Routes.ts'));

/** Kode tanpa komentar: komentar yang MENJELASKAN larangan ini sendiri
 *  memuat teks yang dilarang, dan tidak boleh ikut dihitung. */
const kodeSaja = (isi: string) =>
  isi.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('Pemasangan router', () => {
  it.each(berkasRute)('%s tidak memasang pembatas peran di tingkat router', (berkas) => {
    const isi = kodeSaja(fs.readFileSync(path.join(DIR_RUTE, berkas), 'utf8'));
    const pelanggaran = isi.match(/router\.use\(\s*requireRole/g);
    expect(pelanggaran).toBeNull();
  });

  it.each(berkasRute)('%s hanya memakai router.use untuk authenticateToken', (berkas) => {
    const isi = kodeSaja(fs.readFileSync(path.join(DIR_RUTE, berkas), 'utf8'));
    const semuaUse = [...isi.matchAll(/router\.use\(([^)]*)\)/g)].map((m) => m[1].trim());
    const asing = semuaUse.filter((arg) => arg !== 'authenticateToken');
    expect(asing).toEqual([]);
  });

  it('webhook di-mount sebelum router mana pun yang memakai JWT', () => {
    const app = fs.readFileSync(path.resolve(__dirname, '../src/app.ts'), 'utf8');
    const posisiWebhook = app.indexOf("app.use('/api/webhook', webhookRoutes)");
    const posisiPertamaJwt = app.indexOf("app.use('/api/auth', authRoutes)");
    expect(posisiWebhook).toBeGreaterThan(-1);
    expect(posisiWebhook).toBeLessThan(posisiPertamaJwt);
  });
});
