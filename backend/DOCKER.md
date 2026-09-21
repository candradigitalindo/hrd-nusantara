# Menjalankan dengan Docker

> **Status: sudah dijalankan di produksi** (hrd.nbp.co.id, 21 September 2026).
> Catatan di bawah semula ditulis dari pemeriksaan statis karena Docker tidak
> terpasang di mesin pengembangan; yang sudah terbukti kini ditandai, dan yang
> masih belum diuji tetap dibiarkan terbuka.
>
> Untuk stack produksinya sendiri lihat `DEPLOY.md` di akar repo — compose
> produksi terpisah dari `docker-compose.yml` yang ada di sini.

## Menjalankan

```bash
cp .env.docker.example .env      # di akar repo, bukan di backend/
# isi POSTGRES_USER, POSTGRES_PASSWORD, JWT_SECRET
docker compose up -d --build
docker compose logs -f backend
```

Migrasi database dijalankan otomatis saat container start.

Akun pertama dibuat sekali secara manual:

```bash
docker compose exec backend node dist/seed.js
```

`node dist/seed.js`, bukan `npx ts-node src/seed.ts`: image dipasang dengan
`npm ci --omit=dev` dan hanya membawa `dist/`, jadi `ts-node` maupun `src/`
tidak ada di dalam container.

## Yang sudah diperiksa tanpa Docker

| Yang diperiksa | Cara | Hasil |
|---|---|---|
| `docker-compose.yml` sah sebagai YAML | parser js-yaml | lolos |
| Semua variabel wajib `env.ts` tersedia di compose | pembandingan otomatis | 2 wajib, keduanya ada |
| Tidak ada variabel compose yang tak dikenal aplikasi | pembandingan otomatis | bersih |
| 28 variabel compose terdokumentasi di `.env.docker.example` | pembandingan otomatis | lengkap |
| Build produksi `tsc -> dist` | dijalankan | 102 berkas |
| `node dist/index.js` melayani `/health` | dijalankan | 200 |
| Perintah healthcheck benar saat sehat dan saat mati | dijalankan | exit 0 / exit 1 |
| Jalur model cocok antara skrip unduh dan compose | pembacaan | cocok |

## Yang ditemukan dan diperbaiki

### 1. Alpine tidak bisa menjalankan pengenalan wajah

Dockerfile sebelumnya memakai `node:22-alpine`. Pemeriksaan pada binari
`onnxruntime-node` menunjukkan ia ter-link ke glibc:

```
GLIBC_2.17, libc.so.6, ld-linux-aarch64.so.1
```

Alpine memakai musl, bukan glibc. Modulnya gagal dimuat, dan gagalnya baru
terlihat pada presensi pertama di produksi — bukan saat build.

Base image diganti ke `node:22-bookworm-slim`. Image jadi lebih besar;
pengenalan wajah yang mati di produksi jauh lebih mahal.

`sharp` tidak terpengaruh: ia membawa varian musl maupun glibc.

### 2. Sesi WhatsApp tidak akan bisa tersimpan

Container berjalan sebagai user `node`, tapi `/app/whatsapp-sessions` tidak
pernah dibuat di dalam image. Volume bernama yang dipasang ke direktori yang
belum ada akan dibuat Docker sebagai milik root, sehingga proses tidak bisa
menulis ke sana — artinya kredensial sesi gagal tersimpan dan **setiap
restart menuntut scan QR ulang**.

Direktorinya kini dibuat dan di-`chown node:node` di dalam image, supaya
volumenya mewarisi kepemilikan yang benar.

### 3. Kunci privat bisa ikut masuk image

`.dockerignore` tidak memuat `secrets/`. Dockerfile sekarang menyalin secara
selektif sehingga belum bocor, tapi satu `COPY . .` di kemudian hari sudah
cukup untuk membawa kunci Firebase ke dalam image yang berpindah-pindah antar
registry.

`secrets/`, `whatsapp-sessions/`, `uploads/`, dan `models/` kini dikecualikan.

Folder unggahan yang sama juga menyimpan APK rilis aplikasi mobile (`apk/`),
jadi rilis tidak hilang saat kontainer dibuat ulang.

### 4. Backend tidak punya healthcheck

`postgres` dan `redis` punya, backend tidak. Padahal container yang hidup
belum tentu melayani: migrasi dijalankan lebih dulu saat start, dan kalau
gagal prosesnya berhenti tanpa pernah mendengarkan.

## Catatan: FIELD_ENCRYPTION_KEY wajib

Sejak koordinat presensi dan embedding wajah ikut dienkripsi, kunci ini
wajib — compose menolak start tanpa itu (`:?`). Generate sekali dengan
`openssl rand -base64 32`, simpan di tempat yang aman, dan **jangan pernah
diganti** tanpa `npm run sensitive:reencrypt`: baris lama tidak akan terbaca
lagi, dan untuk embedding wajah itu berarti seluruh karyawan harus mendaftar
ulang wajahnya.

## Catatan: izin berkas kredensial Firebase

`./backend/secrets` dipasang read-only ke `/app/secrets`. Di dalam container
prosesnya berjalan sebagai uid 1000 (`node`), sedangkan di host berkasnya
milik Anda dengan izin 600.

Di Docker Desktop macOS biasanya tetap terbaca karena lapisan berbagi
berkasnya mengabaikan kepemilikan. **Di host Linux ini akan gagal.** Kalau
notifikasi push mati dengan galat izin:

```bash
sudo chown -R 1000:1000 backend/secrets
```

## Menjalankan test tanpa Node di host

Mesin produksi tidak memasang Node, jadi `npm test` dijalankan di dalam
container. Tahap `builder` pada Dockerfile sudah memuat devDependencies dan
bobot model, tapi `tests/` sengaja dikecualikan `.dockerignore` — berkasnya
di-mount saat menjalankan, bukan ikut ke dalam image.

```bash
cd backend

# Database test, terpisah dari produksi dan tanpa port ke host.
docker network create hrd-test-net
docker run -d --name hrd-test-db --network hrd-test-net --cpus 1 --memory 512m \
  -e POSTGRES_USER=uji -e POSTGRES_PASSWORD=uji -e POSTGRES_DB=hrd_db_test \
  postgres:16-alpine

# .env.test menunjuk ke container itu, bukan ke localhost.
sed 's|^DATABASE_URL=.*|DATABASE_URL="postgresql://uji:uji@hrd-test-db:5432/hrd_db_test?schema=public"|' \
  .env.test.example > .env.test

docker build --target builder -t hrd-backend-test .

# cpuset dan cpu-shares menjaga agar test tidak menyendat aplikasi lain
# di server yang sama.
docker run --rm --network hrd-test-net --cpuset-cpus 2,3 --cpu-shares 256 --memory 3g \
  -v "$PWD/tests:/app/tests:ro" \
  -v "$PWD/jest.config.ts:/app/jest.config.ts:ro" \
  -v "$PWD/tsconfig.test.json:/app/tsconfig.test.json:ro" \
  -v "$PWD/.env.test:/app/.env.test:ro" \
  hrd-backend-test npm test

# Bereskan setelah selesai.
docker rm -f hrd-test-db && docker network rm hrd-test-net
```

Satu jebakan: berkas yang di-mount harus berada di dalam direktori repo.
Berkas di `/tmp` milik sesi yang ter-namespace tidak terlihat oleh daemon
Docker, dan bind mount-nya akan berubah jadi direktori kosong — gejalanya
`.env.test tidak ditemukan` padahal berkasnya jelas ada.

Seluruh suite: 46 berkas, 957 test, sekitar 11 menit dengan dua core.

## Yang masih harus diuji

Terbukti saat deploy pertama ke hrd.nbp.co.id:

- [x] Build berhasil sampai selesai
- [x] Unduhan bobot model saat build berhasil, termasuk verifikasi sha256
- [x] Container backend mencapai status `healthy`
- [x] Migrasi berjalan pada database kosong — 29 migrasi, volume baru
- [x] `POST /api/auth/login` menjawab dari dalam container
- [x] Seluruh test suite lolos di dalam container: 46 berkas, 957 test

Belum terbukti:

- [ ] Pendaftaran wajah sungguhan di produksi. `faceEnrollment.test.ts` dan
      `faceRecognition.test.ts` lolos di dalam container `node:22-bookworm-slim`,
      jadi onnxruntime memang termuat di base image ini — tapi itu tahap
      `builder`, belum pendaftaran sungguhan lewat image runtime.
- [ ] Sesi WhatsApp bertahan setelah `docker compose restart backend`. Belum
      bisa diuji: `WHATSAPP_BAILEYS_ENABLED=false`, jadi belum ada sesi.
- [ ] `npm run push:test` membaca kredensial Firebase. Belum ada berkas
      service account yang dipasang.
