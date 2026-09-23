#!/usr/bin/env bash
#
# Membangun APK rilis HRD Nusantara dengan versi yang selalu unik, lalu
# (opsional) mengunggahnya ke menu Aplikasi Mobile di web.
#
# Kenapa versinya ber-stempel waktu: Android menganggap dua APK dengan
# versionCode sama sebagai aplikasi yang sama — memasang build baru di atas
# yang lama ditolak atau dianggap "sudah terpasang". Maka setiap build
# mendapat versionCode dari menit sejak epoch (selalu naik, muat di int32)
# dan versionName `<versi pubspec>+<YYYYMMDDHHMM WIB>` supaya terbaca di
# halaman unduh dan di Profil aplikasi. Versi dasar tetap diatur di
# pubspec.yaml (`version: 0.2.0+2`); angka setelah `+` di sana diabaikan.
#
# Pakai:
#   ./rilis.sh                         # APK arm64 (ponsel 64-bit), tanpa unggah
#   ./rilis.sh --semua-abi             # satu APK berisi semua ABI (±3x lebih besar)
#   ./rilis.sh --unggah                # bangun lalu unggah; minta username/password HR
#   HRD_TOKEN=… ./rilis.sh --unggah    # pakai token JWT yang sudah ada
#   CATATAN_RILIS="…" ./rilis.sh --unggah   # catatan rilis tanpa prompt
#   API_URL=https://… ./rilis.sh       # backend yang dipanggil aplikasi (bawaan: produksi)
#   UNGGAH_URL=http://backend:3000/api DOCKER_NETWORK=hrd_hrd_internal ./rilis.sh --unggah
#                                      # unggah lewat jaringan internal Docker di server
#
# versionCode di manifest APK = angka di atas + offset ABI dari plugin Gradle
# Flutter saat --split-per-abi (arm64-v8a +2000). Yang dilaporkan dan diunggah
# skrip ini selalu angka manifest — itulah yang dibandingkan Android.
#
# Tanpa Flutter di PATH, skrip menjalankan dirinya sendiri di image Docker
# ghcr.io/cirruslabs/flutter (cache pub & Gradle disimpan di volume Docker).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

API_URL="${API_URL:-https://hrd.nbp.co.id/api}"
UNGGAH_URL="${UNGGAH_URL:-$API_URL}"
IMAGE="${FLUTTER_IMAGE:-ghcr.io/cirruslabs/flutter:latest}"
UNGGAH=0
SEMUA_ABI=0
DALAM_DOCKER=0
for arg in "$@"; do
  case "$arg" in
    --unggah) UNGGAH=1 ;;
    --semua-abi) SEMUA_ABI=1 ;;
    --dalam-docker) DALAM_DOCKER=1 ;;
    -h|--help) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "argumen tidak dikenal: $arg" >&2; exit 2 ;;
  esac
done

if ! command -v flutter >/dev/null 2>&1; then
  if (( DALAM_DOCKER )); then
    echo "flutter tidak ditemukan di dalam image $IMAGE" >&2
    exit 1
  fi
  echo "==> flutter tidak ada di PATH; memakai $IMAGE"
  TTY=()
  [[ -t 0 ]] && TTY=(-it)
  exec docker run --rm "${TTY[@]}" ${DOCKER_NETWORK:+--network "$DOCKER_NETWORK"} \
    -v "$PWD:/work" -w /work \
    -v hrd-pub-cache:/root/.pub-cache -e PUB_CACHE=/root/.pub-cache \
    -v hrd-gradle-cache:/root/.gradle \
    -e API_URL="$API_URL" -e UNGGAH_URL="$UNGGAH_URL" -e HRD_TOKEN="${HRD_TOKEN:-}" -e CATATAN_RILIS="${CATATAN_RILIS:-}" \
    "$IMAGE" bash -c "git config --global --add safe.directory '*'; ./rilis.sh --dalam-docker $*"
fi

# --- Versi unik ------------------------------------------------------------
VERSI_DASAR=$(sed -nE 's/^version: *([0-9]+\.[0-9]+\.[0-9]+).*/\1/p' pubspec.yaml)
[[ -n "$VERSI_DASAR" ]] || { echo "version di pubspec.yaml tidak terbaca" >&2; exit 1; }
STEMPEL=$(TZ=Asia/Jakarta date +%Y%m%d%H%M)
NOMOR=$(( $(date +%s) / 60 ))
NAMA="${VERSI_DASAR}+${STEMPEL}"

# --- Build -------------------------------------------------------------------
ARGS=(--release --build-name="$NAMA" --build-number="$NOMOR" --dart-define=API_URL="$API_URL")
if (( SEMUA_ABI )); then
  ABI=semua-abi
  OFFSET_ABI=0
  echo "==> flutter build apk (semua ABI) versi $NAMA · versionCode $NOMOR"
  flutter build apk "${ARGS[@]}"
  APK=build/app/outputs/flutter-apk/app-release.apk
else
  ABI=arm64
  OFFSET_ABI=2000 # plugin Gradle Flutter: arm64-v8a = 2 × 1000
  echo "==> flutter build apk (arm64) versi $NAMA · versionCode $NOMOR"
  flutter build apk "${ARGS[@]}" --target-platform android-arm64 --split-per-abi
  APK=build/app/outputs/flutter-apk/app-arm64-v8a-release.apk
fi
[[ -f "$APK" ]] || { echo "APK tidak ditemukan: $APK" >&2; exit 1; }
NOMOR_APK=$(( NOMOR + OFFSET_ABI ))

mkdir -p build/rilis
KELUARAN="build/rilis/hrd-nusantara-${NAMA}-${ABI}.apk"
cp "$APK" "$KELUARAN"
if command -v sha256sum >/dev/null 2>&1; then SHA=$(sha256sum "$KELUARAN" | cut -c1-64); else SHA=$(shasum -a 256 "$KELUARAN" | cut -c1-64); fi
UKURAN=$(( $(wc -c < "$KELUARAN") / 1024 / 1024 ))

# Angka sebenarnya dibaca dari manifest APK bila build-tools ada; kalau berbeda
# dari perhitungan, manifest yang dipakai (itulah yang dilihat Android).
AAPT2=$(ls "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"/build-tools/*/aapt2 2>/dev/null | tail -1 || true)
if [[ -n "$AAPT2" ]]; then
  MANIFEST=$("$AAPT2" dump badging "$KELUARAN" | sed -nE "s/.*versionCode='([0-9]+)' versionName='([^']+)'.*/\1 \2/p")
  if [[ -n "$MANIFEST" ]]; then
    read -r NOMOR_MANIFEST NAMA_MANIFEST <<<"$MANIFEST"
    if [[ "$NOMOR_MANIFEST" != "$NOMOR_APK" || "$NAMA_MANIFEST" != "$NAMA" ]]; then
      echo "==> manifest APK: versionCode=$NOMOR_MANIFEST versionName=$NAMA_MANIFEST (berbeda dari perhitungan; manifest yang dipakai)"
    fi
    NOMOR_APK=$NOMOR_MANIFEST
    NAMA=$NAMA_MANIFEST
  fi
fi

cat <<INFO

APK siap: $KELUARAN
  Nama versi  : $NAMA
  versionCode : $NOMOR_APK
  Ukuran      : ${UKURAN} MB ($ABI)
  SHA-256     : $SHA
INFO

# --- Unggah ------------------------------------------------------------------
(( UNGGAH )) || { echo "Unggah lewat menu Aplikasi Mobile di web dengan nama versi & versionCode di atas, atau jalankan ulang dengan --unggah."; exit 0; }

TOKEN="${HRD_TOKEN:-}"
if [[ -z "$TOKEN" ]]; then
  read -rp "Nomor HP / email HR: " USERNAME
  read -rsp "Password: " PASSWORD
  echo
  BADAN=$(printf '{"username":"%s","password":"%s"}' "${USERNAME//\"/\\\"}" "${PASSWORD//\"/\\\"}")
  TOKEN=$(curl -sS -X POST "$UNGGAH_URL/auth/login" -H 'Content-Type: application/json' -d "$BADAN" | sed -nE 's/.*"token":"([^"]+)".*/\1/p')
  [[ -n "$TOKEN" ]] || { echo "Login gagal." >&2; exit 1; }
fi
CATATAN="${CATATAN_RILIS:-}"
if [[ -z "$CATATAN" && -t 0 ]]; then read -rp "Catatan rilis (untuk karyawan, boleh kosong): " CATATAN; fi

echo "==> mengunggah ke $UNGGAH_URL/mobile/releases"
KODE=$(curl -sS -o build/rilis/unggah.json -w '%{http_code}' -X POST "$UNGGAH_URL/mobile/releases" \
  --url-query "versionName=$NAMA" --url-query "versionCode=$NOMOR_APK" \
  ${CATATAN:+--url-query "notes=$CATATAN"} \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/vnd.android.package-archive' \
  --data-binary @"$KELUARAN")
case "$KODE" in
  201) echo "Rilis $NAMA (versionCode $NOMOR_APK) kini ditawarkan di halaman unduh." ;;
  413) echo "Ditolak 413: batas ukuran badan di nginx/proxy lebih kecil dari APK (${UKURAN} MB). Naikkan client_max_body_size di proxy depan." >&2; exit 1 ;;
  *) echo "Unggah gagal (HTTP $KODE): $(cat build/rilis/unggah.json)" >&2; exit 1 ;;
esac
