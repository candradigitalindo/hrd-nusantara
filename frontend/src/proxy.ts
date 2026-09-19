import { NextRequest, NextResponse } from "next/server";

/**
 * Pemeriksaan optimistis: halaman aplikasi butuh cookie sesi, halaman login
 * tidak. Keabsahan tokennya sendiri diputuskan backend pada setiap panggilan
 * API — di sini hanya mencegah orang tanpa sesi melihat kerangka halaman.
 */
const NAMA_COOKIE = "hrd_sesi";

export function proxy(req: NextRequest) {
  const adaSesi = Boolean(req.cookies.get(NAMA_COOKIE)?.value);
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/login")) {
    if (adaSesi) return NextResponse.redirect(new URL("/", req.url));
    return NextResponse.next();
  }

  if (!adaSesi) {
    const ke = new URL("/login", req.url);
    if (pathname !== "/") ke.searchParams.set("kembali", pathname);
    return NextResponse.redirect(ke);
  }

  return NextResponse.next();
}

export const config = {
  // Semua halaman kecuali aset statis dan route handler API.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
