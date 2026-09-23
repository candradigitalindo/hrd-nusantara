import { NextRequest, NextResponse } from "next/server";

/**
 * Pemeriksaan optimistis: halaman aplikasi butuh cookie sesi, halaman login
 * tidak. Keabsahan tokennya sendiri diputuskan backend pada setiap panggilan
 * API — di sini hanya mencegah orang tanpa sesi melihat kerangka halaman.
 */
const NAMA_COOKIE = "hrd_sesi";
const NAMA_COOKIE_PELAMAR = "hrd_pelamar";

/**
 * Halaman yang memang untuk umum: landing, lowongan, unduhan aplikasi, ujian
 * bertoken, dan pintu masuk portal karier. Diperiksa sebagai awalan.
 */
const PUBLIK = [
  "/lowongan",
  "/unduh",
  "/tes/",
  "/karier/masuk",
  "/karier/daftar",
  // Berkas yang dibaca mesin pencari. Tanpa ini keduanya ikut dipantulkan ke
  // /login dan yang terbaca crawler adalah halaman HTML, bukan peta situs.
  "/robots.txt",
  "/sitemap.xml",
];

export function proxy(req: NextRequest) {
  const adaSesi = Boolean(req.cookies.get(NAMA_COOKIE)?.value);
  const adaSesiPelamar = Boolean(req.cookies.get(NAMA_COOKIE_PELAMAR)?.value);
  const { pathname } = req.nextUrl;

  // Akar adalah landing page untuk umum; karyawan yang sudah masuk langsung
  // dibawa ke dashboard internalnya.
  if (pathname === "/") {
    return adaSesi ? NextResponse.redirect(new URL("/dashboard", req.url)) : NextResponse.next();
  }

  if (PUBLIK.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();

  // Portal pelamar punya sesinya sendiri, terpisah dari sesi karyawan.
  if (pathname.startsWith("/karier")) {
    if (adaSesiPelamar) return NextResponse.next();
    const ke = new URL("/karier/masuk", req.url);
    ke.searchParams.set("kembali", pathname);
    return NextResponse.redirect(ke);
  }

  if (pathname.startsWith("/login")) {
    if (adaSesi) return NextResponse.redirect(new URL("/dashboard", req.url));
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
