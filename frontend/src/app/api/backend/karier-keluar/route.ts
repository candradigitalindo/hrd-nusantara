import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { NAMA_COOKIE_PELAMAR } from "../[...path]/route";

/**
 * Keluar dari portal karier: cukup menghapus cookie sesinya; tokennya sendiri
 * stateless.
 *
 * Jalurnya sengaja di bawah `/api/backend/` — di produksi nginx mengirim
 * `/api/*` lainnya ke backend Express, jadi endpoint milik Next di luar prefix
 * itu tidak akan pernah sampai. Namanya "karier-keluar", bukan "karier", agar
 * tidak menutupi satu pun rute portal di backend.
 */
export async function DELETE() {
  (await cookies()).delete(NAMA_COOKIE_PELAMAR);
  return NextResponse.json({ ok: true });
}
