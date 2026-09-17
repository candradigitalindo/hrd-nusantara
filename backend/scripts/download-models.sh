#!/usr/bin/env bash
# Mengunduh bobot model pengenalan wajah ke backend/models/.
#
# Bobotnya tidak ikut di-commit (lihat .gitignore) karena berkas biner besar
# tidak cocok disimpan di git. Setelah diunduh, model berjalan sepenuhnya di
# server sendiri — tidak ada panggilan keluar saat presensi berlangsung.
set -euo pipefail

PACK="${FACE_MODEL_PACK:-buffalo_s}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/models/$PACK"
BASE="https://huggingface.co/immich-app/$PACK/resolve/main"

mkdir -p "$DIR"

for part in detection recognition; do
  target="$DIR/$part.onnx"
  if [ -f "$target" ]; then
    echo "sudah ada: $part.onnx ($(du -h "$target" | cut -f1))"
    continue
  fi
  echo "mengunduh $PACK/$part ..."
  curl -sSL --fail --max-time 600 -o "$target.tmp" "$BASE/$part/model.onnx"
  mv "$target.tmp" "$target"
  echo "selesai  : $part.onnx ($(du -h "$target" | cut -f1))"
done

# --- Model anti-spoofing (deteksi wajah hidup) ---
# Dipisah dari paket pengenalan: model ini tidak ikut varian buffalo_*.
ANTISPOOF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/models/antispoof"
ANTISPOOF_FILE="$ANTISPOOF_DIR/minifasnet_v2.onnx"
ANTISPOOF_SHA="d7b3cd9ba8a7ceb13baa8c4720902e27ca3112eff52f926c08804af6b6eecc7b"

mkdir -p "$ANTISPOOF_DIR"

if [ -f "$ANTISPOOF_FILE" ]; then
  echo "sudah ada: minifasnet_v2.onnx ($(du -h "$ANTISPOOF_FILE" | cut -f1))"
else
  echo "mengunduh antispoof/minifasnet_v2 ..."
  curl -sSL --fail --max-time 600 -o "$ANTISPOOF_FILE.tmp" \
    "https://huggingface.co/garciafido/minifasnet-v2-anti-spoofing-onnx/resolve/main/minifasnet_v2.onnx"
  mv "$ANTISPOOF_FILE.tmp" "$ANTISPOOF_FILE"
  echo "selesai  : minifasnet_v2.onnx ($(du -h "$ANTISPOOF_FILE" | cut -f1))"
fi

# Bobot model menentukan siapa yang boleh absen; kalau berkasnya tertukar atau
# rusak di tengah jalan, lebih baik ketahuan sekarang daripada saat produksi.
if command -v shasum >/dev/null 2>&1; then
  AKTUAL="$(shasum -a 256 "$ANTISPOOF_FILE" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  AKTUAL="$(sha256sum "$ANTISPOOF_FILE" | awk '{print $1}')"
else
  AKTUAL="$ANTISPOOF_SHA"
  echo "peringatan: tidak ada alat sha256, checksum dilewati"
fi

if [ "$AKTUAL" != "$ANTISPOOF_SHA" ]; then
  echo "GAGAL: checksum minifasnet_v2.onnx tidak cocok." >&2
  echo "  diharapkan: $ANTISPOOF_SHA" >&2
  echo "  didapat   : $AKTUAL" >&2
  rm -f "$ANTISPOOF_FILE"
  exit 1
fi

echo
echo "Model tersimpan di $DIR dan $ANTISPOOF_DIR"
