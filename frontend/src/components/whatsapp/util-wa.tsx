"use client";

import { isThisYear, isToday, isYesterday } from "date-fns";
import { UserRound, UsersRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { WARNA_JENIS } from "@/components/shift/util-shift";
import { cn, formatTanggal, formatWaktu, inisial, tampakLid } from "@/lib/utils";
import { STATUS, statusAkun } from "./daftar-nomor";
import type { NomorWa, Utas, WarnaJenisShift } from "@/lib/types";

/** Jeda penyegaran daftar chat dan isi chat. */
export const SEGAR_MS = 15_000;

export const LABEL_TIPE: Record<string, string> = {
  image: "Foto",
  video: "Video",
  audio: "Pesan suara",
  document: "Dokumen",
  text: "Pesan",
};

/** Waktu singkat ala aplikasi chat: jam untuk hari ini, "Kemarin", lalu tanggal. */
export const waktuSingkat = (nilai: string) => {
  const d = new Date(nilai);
  if (isToday(d)) return formatWaktu(d);
  if (isYesterday(d)) return "Kemarin";
  return formatTanggal(d, isThisYear(d) ? "d MMM" : "d MMM yyyy");
};

/** Nama yang mewakili sebuah nomor: karyawan pemegang nomor pribadi, label untuk nomor perusahaan. */
export const namaNomor = (n: Pick<NomorWa, "kind" | "label" | "employee">) =>
  n.kind === "personal" ? (n.employee?.name ?? n.label) : n.label;

/**
 * Status efektif dari server dibakukan ke titik warna yang sama dengan tab
 * Nomor; "menyambung" dan "nonaktif" tidak punya padanan di sana.
 */
export const tampilanStatus = (status: string) =>
  status === "connecting"
    ? { label: "Menyambung", titik: "bg-info", teks: "text-info" }
    : status === "inactive"
      ? { label: "Nonaktif", titik: "bg-danger", teks: "text-danger" }
      : STATUS[statusAkun(status)];

/** Judul chat: nama kontak (atau karyawan) untuk chat pribadi, nama grup untuk grup. */
export const judulUtas = (u: Utas) =>
  u.jenis === "grup"
    ? (u.grup?.nama ?? "Grup tanpa nama")
    : (u.kontak?.nama ?? u.kontak?.karyawan?.name ?? "Kontak tanpa nama");

export const utasBernama = (u: Utas) =>
  u.jenis === "grup" ? Boolean(u.grup?.nama) : Boolean(u.kontak?.nama ?? u.kontak?.karyawan?.name);

/** Nomor asli lawan bicara chat pribadi, atau null bila WhatsApp hanya memberi LID. */
export const nomorAsliUtas = (u: Utas): string | null => {
  if (u.jenis === "grup") return null;
  if (u.kontak) return u.kontak.nomor && !tampakLid(u.kontak.nomor, u.kontak.lid) ? u.kontak.nomor : null;
  return tampakLid(u.contactNumber) ? null : u.contactNumber;
};

/*
 * Warna pembeda orang memakai palet jenis shift (sudah punya pasangan mode
 * gelap dan kontras >= 4.5:1). Abu-abu tidak dipakai: warna itu milik
 * "Pengirim tidak tercatat". Kelas ditulis utuh agar dibangkitkan Tailwind.
 */
const TEKS_ORANG: Partial<Record<WarnaJenisShift, string>> = {
  teal: "text-jenis-teal",
  blue: "text-jenis-blue",
  amber: "text-jenis-amber",
  violet: "text-jenis-violet",
  rose: "text-jenis-rose",
  green: "text-jenis-green",
  orange: "text-jenis-orange",
};
const PALET_ORANG = Object.keys(TEKS_ORANG) as WarnaJenisShift[];

/** FNV-1a: cepat, stabil antarmuat, cukup acak untuk memilih warna. */
const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** Kunci yang sama (nomor, LID, nama) selalu jatuh ke warna yang sama di semua layar. */
export const warnaOrang = (kunci: string) => {
  const k = PALET_ORANG[hash(kunci) % PALET_ORANG.length];
  return { teks: TEKS_ORANG[k] ?? "text-jenis-teal", chip: WARNA_JENIS[k].chip };
};

/** Inisial dari huruf dan angka saja: nama profil WhatsApp sering diawali emoji atau tanda. */
const inisialAman = (nama: string) => inisial(nama.replace(/[^\p{L}\p{N}\s]/gu, " ").trim());

export const AvatarWa = ({
  nama,
  grup,
  kunciWarna,
  kecil,
}: {
  /** null bila kontak tak bernama: ikon orang, bukan inisial "KT" dari "Kontak tanpa nama". */
  nama: string | null;
  grup?: boolean;
  kunciWarna: string;
  kecil?: boolean;
}) => {
  const huruf = !grup && nama ? inisialAman(nama) : "";
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold",
        kecil ? "h-9 w-9 text-xs" : "h-10 w-10 text-sm",
        grup ? "bg-info-soft text-info" : huruf ? warnaOrang(kunciWarna).chip : "bg-surface-2 text-muted"
      )}
      aria-hidden
    >
      {grup ? <UsersRound className="h-4 w-4" /> : huruf || <UserRound className="h-4 w-4" />}
    </span>
  );
};

export const LencanaKaryawan = () => (
  <Badge tone="primary" className="px-1.5 py-0 text-[10px] leading-4">
    Karyawan
  </Badge>
);

/** Pengganti nomor bila WhatsApp hanya memberi ID samaran (LID). LID-nya sendiri tidak pernah ditulis. */
export const LencanaLid = () => (
  <Badge
    tone="warning"
    className="px-1.5 py-0 text-[11px] leading-4"
    title="WhatsApp hanya memberi ID samaran untuk kontak ini; nomor aslinya belum diketahui."
  >
    Nomor disembunyikan WhatsApp
  </Badge>
);
