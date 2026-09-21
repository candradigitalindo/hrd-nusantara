#!/usr/bin/env bash
#
# Deploy stack HRD Nusantara (hrd.nbp.co.id).
#
# Alasan skrip ini ada, alih-alih `docker compose up -d --build`:
#
# 1. Build dibatasi resource-nya. Server ini 4 core dan dipakai bersama stack
#    radius, CASN, klinik, dan WordPress. `npm ci` + `next build` + `tsc`
#    tanpa batas akan mengisi keempat core dan menyendatkan semuanya. Build di
#    sini dipagari cpuset, cpu-shares, dan batas memori.
# 2. Build dan rollout dipisah. Container lama tetap melayani selama image
#    baru dibangun; kalau build gagal, tidak ada yang tersentuh sama sekali.
# 3. Image lama disimpan sebagai :sebelumnya supaya bisa dibalikkan cepat.
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

COMPOSE_FILE=docker-compose.prod.yml
ENV_FILE=.env.prod

# --- Pagar resource saat build -------------------------------------------
# cpuset: build hanya boleh memakai 2 dari 4 core; core 0-1 tetap bebas untuk
# aplikasi yang sedang melayani pengguna.
# cpu-shares 256 (bawaan 1024): walau berbagi core, container lain menang
# empat banding satu saat berebut CPU.
# memory: build tidak boleh menghabiskan RAM dan memicu OOM di stack lain.
BUILD_CPUSET="${BUILD_CPUSET:-2,3}"
BUILD_CPU_SHARES="${BUILD_CPU_SHARES:-256}"
BUILD_MEMORY="${BUILD_MEMORY:-4g}"
BUILD_MEMORY_SWAP="${BUILD_MEMORY_SWAP:-6g}"

# Batas di atas hanya dihormati builder klasik. BuildKit mengabaikannya diam-
# diam, jadi ia dimatikan secara eksplisit di sini — kalau tidak, "build yang
# dibatasi" akan berubah jadi build tanpa batas tanpa ada yang memberi tahu.
export DOCKER_BUILDKIT=0

pesan() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
galat() { printf '\n\033[1;31m!! %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || galat "$ENV_FILE tidak ada. Salin dari .env.prod.example lalu isi rahasianya."

# Network bersama reverse-proxy. Dibuat sekali, dipakai semua aplikasi.
docker network inspect web >/dev/null 2>&1 || {
  pesan "Membuat network 'web'"
  docker network create web
}

bangun() {
  local nama="$1" konteks="$2"
  # Sisa argumen (mis. --no-cache) diteruskan apa adanya ke docker build.
  shift 2

  # Simpan image yang sedang jalan supaya ada jalan pulang kalau versi baru
  # ternyata bermasalah. Docker baru memindahkan tag :latest setelah build
  # sukses, jadi build gagal tidak merusak apa pun.
  if docker image inspect "$nama:latest" >/dev/null 2>&1; then
    docker tag "$nama:latest" "$nama:sebelumnya"
  fi

  pesan "Membangun $nama (cpuset=$BUILD_CPUSET, shares=$BUILD_CPU_SHARES, memori=$BUILD_MEMORY)"
  docker build \
    --cpuset-cpus "$BUILD_CPUSET" \
    --cpu-shares "$BUILD_CPU_SHARES" \
    --memory "$BUILD_MEMORY" \
    --memory-swap "$BUILD_MEMORY_SWAP" \
    -t "$nama:latest" \
    "$@" \
    "$konteks"
}

# Argumen tambahan dari baris perintah diteruskan ke kedua build,
# misalnya: ./deploy.sh --no-cache
bangun hrd-backend ./backend "$@"
bangun hrd-frontend ./frontend "$@"

pesan "Menjalankan stack"
# Tanpa --build: image sudah jadi di atas. --remove-orphans hanya berlaku pada
# project 'hrd', stack lain di server ini tidak ikut terpengaruh.
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --remove-orphans

pesan "Status"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps

cat <<'CATATAN'

Selesai. Beberapa hal yang tidak dilakukan skrip ini dengan sendirinya:

  * Akun pertama dibuat sekali secara manual:
      docker compose -f docker-compose.prod.yml --env-file .env.prod \
        exec backend npx ts-node src/seed.ts

  * Membalikkan ke versi sebelumnya:
      docker tag hrd-backend:sebelumnya hrd-backend:latest
      docker compose -f docker-compose.prod.yml --env-file .env.prod up -d backend

  * Membersihkan image lama milik stack ini saja (JANGAN `docker system prune`,
    itu ikut menghapus cache stack lain):
      docker image prune -f --filter 'label=com.docker.compose.project=hrd'

CATATAN
