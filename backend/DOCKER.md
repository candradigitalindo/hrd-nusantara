# Menjalankan dengan Docker

> **Status: belum pernah benar-benar dijalankan.** Docker tidak terpasang di
> mesin tempat backend ini dikembangkan. Isi berkas ini adalah hasil
> pemeriksaan statis dan pengujian bagian-bagian yang bisa diuji tanpa Docker.
> Bagian "Yang masih harus diuji" di bawah wajib dijalankan sekali sebelum
> dipakai produksi.

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
docker compose exec backend npx ts-node src/seed.ts
```

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

### 4. Backend tidak punya healthcheck

`postgres` dan `redis` punya, backend tidak. Padahal container yang hidup
belum tentu melayani: migrasi dijalankan lebih dulu saat start, dan kalau
gagal prosesnya berhenti tanpa pernah mendengarkan.

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

## Yang masih harus diuji

Belum ada satu pun dari ini yang pernah dijalankan:

- [ ] `docker compose build` berhasil sampai selesai
- [ ] Unduhan bobot model saat build berhasil, termasuk verifikasi sha256
- [ ] Container backend mencapai status `healthy`
- [ ] Migrasi berjalan pada database kosong
- [ ] `POST /api/auth/login` menjawab dari dalam container
- [ ] Pendaftaran wajah berhasil — ini yang membuktikan onnxruntime benar-benar
      jalan di base image yang baru
- [ ] Sesi WhatsApp bertahan setelah `docker compose restart backend`
      (tidak menuntut scan QR ulang)
- [ ] `npm run push:test` dari dalam container membaca kredensial Firebase
