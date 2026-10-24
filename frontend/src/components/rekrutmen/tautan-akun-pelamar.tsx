"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { sumberRekrutmen } from "@/lib/sumber-rekrutmen";

/** Mempertahankan lowongan dan asal pelamar ketika berpindah masuk/daftar. */
export function TautanAkunPelamar({ tujuan }: { tujuan: "masuk" | "daftar" }) {
  const params = useSearchParams();
  let lowongan = params.get("lowongan");
  let source = sumberRekrutmen(params.get("source"));
  const kembali = params.get("kembali");
  if (!lowongan && kembali?.startsWith("/karier/dashboard?")) {
    const q = new URLSearchParams(kembali.slice(kembali.indexOf("?") + 1));
    lowongan = q.get("lamar");
    source = sumberRekrutmen(q.get("source"));
  }
  const query = new URLSearchParams();
  if (lowongan) {
    if (tujuan === "daftar") {
      query.set("lowongan", lowongan);
      if (source) query.set("source", source);
    } else {
      const q = new URLSearchParams({ lamar: lowongan });
      if (source) q.set("source", source);
      query.set("kembali", `/karier/dashboard?${q}`);
    }
  }
  return <Link href={`/karier/${tujuan}${query.size ? `?${query}` : ""}`} className="font-medium text-primary hover:underline">{tujuan === "masuk" ? "Masuk" : "Daftar di sini"}</Link>;
}
