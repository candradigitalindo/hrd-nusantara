import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { NAMA_COOKIE } from "../backend/[...path]/route";

/** Logout: cukup menghapus cookie. Token JWT-nya sendiri stateless. */
export async function DELETE() {
  (await cookies()).delete(NAMA_COOKIE);
  return NextResponse.json({ ok: true });
}
