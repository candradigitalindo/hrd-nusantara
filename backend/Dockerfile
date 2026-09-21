# ---------- Tahap build ----------
#
# Debian, BUKAN Alpine. onnxruntime-node hanya membawa binari Linux yang
# ter-link ke glibc — pemeriksaan pada berkasnya menunjukkan GLIBC_2.x,
# libc.so.6, dan ld-linux-aarch64.so.1. Di Alpine yang memakai musl, modul
# itu gagal dimuat, dan gagalnya baru terlihat pada presensi pertama di
# produksi, bukan saat build. Image Debian memang lebih besar; pengenalan
# wajah yang mati di produksi jauh lebih mahal.
FROM node:22-bookworm-slim AS builder

# openssl untuk query engine Prisma; curl dan ca-certificates untuk mengunduh
# bobot model.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Bobot model diunduh saat build, bukan saat container start: image jadi
# mandiri dan tidak perlu jaringan keluar saat dijalankan di produksi.
COPY scripts ./scripts
RUN bash scripts/download-models.sh

# ---------- Tahap runtime ----------
FROM node:22-bookworm-slim AS runner

# fontconfig + DejaVu: teks pada foto absensi ber-stempel dirender sharp
# lewat SVG; tanpa font, hurufnya jadi kotak.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY prisma ./prisma
# Client hasil generate dibawa dari tahap build, bukan di-generate ulang.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/models ./models

# Direktori yang ditulis saat runtime, keduanya dipasang sebagai volume oleh
# compose. Kepemilikannya harus sudah benar DI DALAM IMAGE: volume bernama
# mewarisi kepemilikan direktori yang ditimpanya, dan kalau direktorinya belum
# ada, Docker membuatnya milik root — proses yang berjalan sebagai "node"
# lalu tidak bisa menulis ke sana. Untuk whatsapp-sessions itu berarti
# kredensial sesi gagal tersimpan dan tiap restart menuntut scan QR ulang.
RUN mkdir -p /app/uploads /app/whatsapp-sessions \
  && chown -R node:node /app/uploads /app/whatsapp-sessions /app/models

# Jalan sebagai user non-root bawaan image node.
USER node

EXPOSE 3000

# Migrasi dijalankan saat container start supaya skema database selalu
# sinkron dengan versi kode yang di-deploy.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
