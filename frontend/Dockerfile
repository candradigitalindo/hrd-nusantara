# ---------- Tahap build ----------
#
# Debian slim, senada dengan backend. Tailwind v4 memakai binari native
# (lightningcss) yang ter-link ke glibc; di Alpine/musl varian yang terunduh
# bisa tidak cocok dan gagalnya baru terlihat saat `next build`.
FROM node:22-bookworm-slim AS builder

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# next/font mengunduh Geist saat build dan menyalinnya ke dalam keluaran,
# sehingga container tidak perlu jaringan keluar saat start.
RUN npm run build

# ---------- Tahap runtime ----------
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# server.js keluaran standalone membaca keduanya; tanpa HOSTNAME ia hanya
# mendengarkan localhost dan tidak bisa dihubungi dari container lain.
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

# Keluaran standalone sudah membawa node_modules seperlunya (hasil pelacakan
# berkas oleh Next), jadi `npm ci` tidak perlu diulang di tahap ini.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node

EXPOSE 3001

CMD ["node", "server.js"]
