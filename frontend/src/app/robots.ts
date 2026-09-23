import type { MetadataRoute } from "next";
import { ALAMAT_SITUS } from "@/lib/karier-server";

/**
 * Yang boleh diindeks hanyalah halaman publik. Seluruh aplikasi internal,
 * portal pelamar yang berisi data pribadi, dan API ditutup — bukan sebagai
 * pengamanan (itu urusan sesi), melainkan supaya tidak pernah muncul di hasil
 * pencarian.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/lowongan", "/unduh"],
        disallow: ["/api/", "/login", "/dashboard", "/karier/", "/tes/", "/karyawan", "/payroll", "/presensi", "/cuti", "/peran", "/cbt"],
      },
    ],
    sitemap: `${ALAMAT_SITUS}/sitemap.xml`,
    host: ALAMAT_SITUS,
  };
}
