# Deploy produksi — hrd.nbp.co.id

Panduan untuk yang mengelola server, bukan untuk pengembangan lokal. Untuk
menjalankan di laptop sendiri, pakai `docker-compose.yml` dan `DOCKER.md`.

## Kenapa ada dua stack

`docker-compose.yml` (pengembangan) mempublikasikan port 3000, 5432, dan 6379
ke host. Di server produksi ketiganya sudah dipakai aplikasi lain — port 3000
oleh stack radius, 6379 oleh Redis-nya. Menjalankan stack dev di sana akan
gagal atau merebut port milik aplikasi yang sedang melayani pengguna.

`docker-compose.prod.yml` **tidak mempublikasikan satu port pun**. Satu-satunya
container yang bisa dihubungi dari luar stack adalah `hrd_nginx`, lewat network
Docker bersama bernama `web`. PostgreSQL, Redis, backend, dan frontend tidak
terjangkau dari host maupun dari stack lain.

```
Internet → Cloudflare → proxy_nginx (:80)  ─── network 'web' ───  hrd_nginx
                                                                     │
                                                    network 'hrd_internal'
                                                     ┌───────────────┼───────────────┐
                                                  frontend        backend       postgres/redis
                                                  (Next :3001)   (Express :3000)
```

## Pembagian rute di `hrd_nginx`

| Jalur | Tujuan | Alasan |
|---|---|---|
| `/api/backend/*` | frontend (Next) | Pola BFF. Token JWT ditempel di server Next dari cookie httpOnly, browser tidak pernah memegangnya. |
| `/api/*` | backend (Express) | Aplikasi Android memanggil API langsung, tidak lewat BFF. |
| `/health` | backend | Untuk pemantauan dari luar. |
| sisanya | frontend | Halaman web. |

Urutannya penting: nginx memilih prefix terpanjang, jadi `/api/backend/` tetap
menang atas `/api/` walaupun ditulis di blok yang berbeda.

Aplikasi Flutter dibangun dengan:

```bash
flutter build apk --dart-define=API_URL=https://hrd.nbp.co.id/api
```

## Menjalankan

```bash
cp .env.prod.example .env.prod
# isi POSTGRES_PASSWORD, JWT_SECRET (openssl rand -base64 48),
# dan FIELD_ENCRYPTION_KEY (openssl rand -base64 32)
chmod 600 .env.prod

./deploy.sh
```

`deploy.sh`, bukan `docker compose up --build`. Bedanya:

* **Build dipagari resource.** Server ini 4 core dan dipakai bersama empat
  stack lain. Build dijalankan dengan `--cpuset-cpus 2,3` (core 0-1 tetap bebas
  untuk aplikasi yang sedang melayani), `--cpu-shares 256` (kalah prioritas
  empat banding satu saat berebut CPU), dan batas memori 4 GB. Bisa diubah
  lewat variabel lingkungan `BUILD_CPUSET`, `BUILD_CPU_SHARES`, `BUILD_MEMORY`.
* **Build dan rollout dipisah.** Container lama tetap melayani selama image
  baru dibangun. Kalau build gagal, tidak ada yang tersentuh.
* **Image lama disimpan** sebagai tag `:sebelumnya`.

Argumen tambahan diteruskan ke `docker build`, misalnya `./deploy.sh --no-cache`.

### Akun pertama

Dibuat sekali, setelah stack jalan:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec backend node dist/seed.js
```

`node dist/seed.js`, bukan `npx ts-node src/seed.ts` seperti di `DOCKER.md`:
image produksi dipasang dengan `npm ci --omit=dev` dan hanya membawa `dist/`,
jadi `ts-node` maupun `src/` tidak ada di dalamnya.

## Operasi harian

```bash
# Alias supaya tidak perlu mengetik ulang
alias hrd='docker compose -f docker-compose.prod.yml --env-file .env.prod'

hrd ps
hrd logs -f backend
hrd restart backend
hrd down            # hanya project 'hrd'; stack lain tidak ikut berhenti
```

### Membalikkan ke versi sebelumnya

```bash
docker tag hrd-backend:sebelumnya hrd-backend:latest
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d backend
```

### Membersihkan image lama

```bash
docker image prune -f --filter 'label=com.docker.compose.project=hrd'
```

**Jangan** `docker system prune` di server ini: perintah itu ikut menghapus
image dan cache milik stack radius, CASN, klinik, dan WordPress.

## Batas resource

Dipasang di `docker-compose.prod.yml` supaya satu stack tidak bisa
menjatuhkan yang lain:

| Service | CPU | Memori |
|---|---|---|
| backend | 2.0 | 3 GB |
| frontend | 1.5 | 1 GB |
| postgres | 1.0 | 1 GB |
| redis | 0.5 | 256 MB |
| nginx | 0.5 | 128 MB |

Log dibatasi 10 MB × 3 berkas per container. Daemon Docker di server ini tidak
memasang rotasi log sama sekali, jadi batasnya dipasang per service.

`FACE_ONNX_THREADS=2` menahan pengenalan wajah agar tidak mengambil keempat
core saat ada presensi berbarengan.

## WhatsApp: kapan boleh dan tidak boleh deploy

Dinyalakan lewat `WHATSAPP_MONITORING_ENABLED=true` dan
`WHATSAPP_BAILEYS_ENABLED=true` di `.env.prod`. Kredensial sesi disimpan di
database (tabel `WhatsAppAuthKey`, terenkripsi dengan `FIELD_ENCRYPTION_KEY`),
jadi ikut cadangan `pg_dump`. Saat boot backend membuka ulang akun yang pernah
tertaut dan kredensialnya masih tersimpan — nomor-nomor itu **tersambung
sendiri** setelah `deploy.sh`, tanpa scan ulang.

Kredensial dihapus begitu tautannya tidak sah lagi (di-logout dari ponsel atau
oleh HR, kredensial rusak), sehingga sambungan berikutnya langsung memunculkan
QR baru.

Yang **tidak** dibuka ulang adalah akun yang belum pernah tertaut atau sedang
menunggu scan: belum ada kredensial yang bisa dipulihkan. Restart backend saat seseorang sedang memindai QR
membuat QR-nya mati diam-diam — halaman *WhatsApp Saya* tetap berbunyi
"Pindai kode QR" tapi tidak menampilkan apa pun. Pemulihannya sepele
(tombol *Minta kode baru*), tapi lebih baik dihindari:

```bash
# Ada yang sedang memindai? Jangan deploy dulu.
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -T postgres psql -U hrd -d hrd_db -tAc \
  "SELECT COUNT(*) FROM \"WhatsAppAccount\" WHERE \"sessionStatus\"='pending_scan'"
```

## Catatan: Redis belum terpakai

Stack menjalankan Redis dan backend menunggunya sampai sehat, tapi **tidak ada
kode backend yang membacanya**. Satu-satunya penyebutan `REDIS_URL` di `src/`
adalah validasi di `config/env.ts`; tidak ada `createClient`, dan tidak ada
endpoint logout maupun daftar token yang dicabut. Token JWT berlaku sampai
kedaluwarsa sendiri (8 jam) dan tidak bisa dicabut lebih awal.

Containernya dibiarkan jalan supaya `REDIS_URL` langsung bekerja begitu
fiturnya dipakai. Kalau memang tidak akan dipakai dalam waktu dekat, service
`redis` beserta `depends_on`-nya boleh dihapus dari `docker-compose.prod.yml`
— itu membebaskan satu container dan menghilangkan satu tahap tunggu saat
start.

## Data yang harus ikut dicadangkan

Volume bernama, semuanya berawalan `hrd_`:

| Volume | Isi | Kalau hilang |
|---|---|---|
| `hrd_pgdata` | Seluruh database | Semua data HRD hilang |
| `hrd_uploads` | Foto pendaftaran wajah, dokumen karyawan, APK rilis | Pendaftaran wajah harus diulang |
| `hrd_redisdata` | Cache dan daftar token dicabut | Token yang sudah dicabut hidup lagi |

Cadangan database:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -T postgres pg_dump -U hrd hrd_db | gzip > hrd-$(date +%F).sql.gz
```

`backend/secrets/` di-mount read-only dari host dan tidak ikut ke dalam image.
Isinya (kunci Firebase) tidak ikut git — cadangkan terpisah.

## Reverse proxy di depan

Blok server untuk `hrd.nbp.co.id` ada di
`/home/daniswara/radius-server/nginx-proxy/nginx.conf`, mengarah ke
`hrd_nginx`. Setelah diubah:

```bash
docker exec proxy_nginx nginx -t && docker exec proxy_nginx nginx -s reload
```

TLS diterminasi di Cloudflare; `proxy_nginx` hanya berbicara HTTP di dalam
network `web`. Redirect HTTP→HTTPS memakai header `X-Forwarded-Proto` dari
Cloudflare, sama seperti aplikasi lain di server ini.
