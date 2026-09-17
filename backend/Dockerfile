# ---------- Tahap build ----------
FROM node:22-alpine AS builder

# Prisma butuh openssl untuk query engine-nya.
RUN apk add --no-cache openssl

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
RUN apk add --no-cache bash curl && bash scripts/download-models.sh

# ---------- Tahap runtime ----------
FROM node:22-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY prisma ./prisma
# Client hasil generate dibawa dari tahap build, bukan di-generate ulang.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/models ./models

# Foto pendaftaran wajah ditulis ke sini; dipasang sebagai volume oleh compose.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads /app/models

# Jalan sebagai user non-root bawaan image node.
USER node

EXPOSE 3000

# Migrasi dijalankan saat container start supaya skema database selalu
# sinkron dengan versi kode yang di-deploy.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
