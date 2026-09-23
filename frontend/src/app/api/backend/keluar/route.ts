import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { NAMA_COOKIE } from "../[...path]/route";

/**
 * Logout: cukup menghapus cookie sesi. Token JWT-nya sendiri stateless.
 *
 * Jalurnya sengaja berada di bawah `/api/backend/`, bukan `/api/`. Di produksi
 * nginx mengirim `/api/*` ke backend Express dan hanya `/api/backend/*` ke
 * Next (lihat nginx/hrd.conf); endpoint ini milik Next, jadi di luar prefix
 * itu ia tidak pernah sampai — dan itulah yang dulu membuat logout gagal diam-
 * diam di produksi padahal jalan di pengembangan.
 *
 * Segmen statis `keluar` menang atas proxy catch-all `[...path]` di sebelahnya,
 * jadi permintaan ini tidak diteruskan ke Express. Namanya sengaja berbahasa
 * Indonesia: rute backend seluruhnya berbahasa Inggris, sehingga tidak ada
 * jalur backend yang bisa tertutupi olehnya.
 */
export async function DELETE() {
  (await cookies()).delete(NAMA_COOKIE);
  return NextResponse.json({ ok: true });
}
