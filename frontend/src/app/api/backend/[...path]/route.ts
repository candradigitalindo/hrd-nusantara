import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

/**
 * Proxy ke backend Express (pola backend-for-frontend).
 *
 * Token JWT disimpan di cookie httpOnly dan hanya ditempelkan di sini, di
 * server Next. Browser tidak pernah melihat tokennya. Satu-satunya jalur
 * khusus adalah login: kalau backend menjawab 200 beserta token, token itu
 * dipindahkan ke cookie dan TIDAK diteruskan ke browser.
 */
const BACKEND = process.env.BACKEND_URL ?? "http://localhost:3000";
export const NAMA_COOKIE = "hrd_sesi";
/**
 * Sesi portal karier, terpisah dari sesi karyawan.
 *
 * Pelamar bukan karyawan: tokennya tidak boleh dipakai di rute internal, dan
 * sebaliknya. Dua cookie berbeda membuat pemisahan itu tidak bergantung pada
 * ketelitian kode di kemudian hari.
 */
export const NAMA_COOKIE_PELAMAR = "hrd_pelamar";

// "range" ikut diteruskan supaya video panjang bisa digeser: tanpa itu
// peramban hanya bisa memutarnya dari awal.
const HEADER_DITERUSKAN = ["content-type", "accept", "x-bellys-signature", "range"];

const teruskan = async (req: NextRequest, ctx: RouteContext<"/api/backend/[...path]">) => {
  const { path } = await ctx.params;
  const tujuan = new URL(`/api/${path.join("/")}`, BACKEND);
  tujuan.search = req.nextUrl.search;

  const headers = new Headers();
  for (const h of HEADER_DITERUSKAN) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  // Alamat asli pengguna diteruskan supaya jejak audit di backend mencatat
  // IP orangnya, bukan IP server Next.
  const ip = req.headers.get("x-forwarded-for") ?? "";
  if (ip) headers.set("x-forwarded-for", ip);
  const ua = req.headers.get("user-agent");
  if (ua) headers.set("user-agent", ua);

  // Jalur /karier/* memakai sesi pelamar; sisanya sesi karyawan.
  const kePortal = path[0] === "karier";
  const simpanan = await cookies();
  const token = simpanan.get(kePortal ? NAMA_COOKIE_PELAMAR : NAMA_COOKIE)?.value;
  if (token) headers.set("authorization", `Bearer ${token}`);

  const adaBody = req.method !== "GET" && req.method !== "HEAD";
  const jawaban = await fetch(tujuan, {
    method: req.method,
    headers,
    body: adaBody ? await req.arrayBuffer() : undefined,
    redirect: "manual",
    cache: "no-store",
  });

  // Masuk dan mendaftar di portal karier: tokennya dipindahkan ke cookie
  // httpOnly persis seperti login karyawan, jadi peramban tidak pernah
  // memegangnya dan XSS tidak bisa mencurinya.
  const jalur = path.join("/");
  if ((jalur === "karier/masuk" || jalur === "karier/daftar") && req.method === "POST" && jawaban.ok) {
    const data = (await jawaban.json()) as { token?: string; pelamar?: unknown; ok?: boolean };
    const res = NextResponse.json({ pelamar: data.pelamar ?? null, ok: true });
    if (data.token) {
      res.cookies.set(NAMA_COOKIE_PELAMAR, data.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 8 * 60 * 60,
      });
    }
    return res;
  }

  const isLogin = req.method === "POST" && path.join("/") === "auth/login";
  if (isLogin && jawaban.ok) {
    const data = (await jawaban.json()) as { token: string; expiresIn: string; user: unknown };
    const res = NextResponse.json({ user: data.user, expiresIn: data.expiresIn });
    res.cookies.set(NAMA_COOKIE, data.token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      // Selaras dengan JWT_EXPIRES_IN backend (bawaan 8 jam).
      maxAge: 8 * 60 * 60,
    });
    return res;
  }

  const res = new NextResponse(jawaban.body, { status: jawaban.status });
  // Header yang menentukan cara browser memperlakukan isi: tanpa
  // content-disposition, unduhan dokumen terbuka sebagai halaman kosong.
  for (const h of ["content-type", "content-length", "content-disposition", "cache-control", "x-content-type-options", "x-checksum-sha256", "accept-ranges", "content-range"]) {
    const v = jawaban.headers.get(h);
    if (v) res.headers.set(h, v);
  }
  return res;
};

export const GET = teruskan;
export const POST = teruskan;
export const PUT = teruskan;
export const PATCH = teruskan;
export const DELETE = teruskan;
