"use client";

import { Download, FileText } from "lucide-react";
import type { Percakapan } from "@/lib/types";

const ukuranBerkas = (bytes: number | null) => {
  if (!bytes) return null;
  return bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
};

const ALASAN_TANPA_BERKAS: Record<string, string> = {
  terlalu_besar: "Berkas melewati batas ukuran, tidak ikut disimpan",
  gagal: "Berkas sudah tidak bisa diunduh dari WhatsApp saat pesan ini tiba",
  tidak_didukung: "Driver WhatsApp saat itu belum bisa mengunduh berkas",
};

/**
 * Isi berkas sebuah pesan: foto, video, pesan suara, dokumen.
 *
 * Pesan suara dan foto tanpa keterangan tidak punya teks sama sekali, jadi
 * bagian inilah isi pesannya. Berkasnya diambil lewat BFF supaya token sesi
 * ikut terpasang, dan server tetap memeriksa perannya sendiri.
 */
export const MediaPesan = ({ pesan, bolehBuka }: { pesan: Percakapan; bolehBuka: boolean }) => {
  const url = `/api/backend/whatsapp/conversations/${pesan.id}/media`;
  const tipe = (pesan.mediaMimeType ?? "").split(";")[0].trim();

  if (!pesan.mediaTersedia) {
    const alasan = pesan.mediaStatus ? ALASAN_TANPA_BERKAS[pesan.mediaStatus] : null;
    return alasan ? <p className="mt-1 text-xs italic text-muted">{alasan}</p> : null;
  }

  if (!bolehBuka) {
    return <p className="mt-1 text-xs italic text-muted">Berkas {pesan.messageType} tersimpan — hanya Super Admin yang bisa membukanya</p>;
  }

  const keterangan = [pesan.mediaFileName, ukuranBerkas(pesan.mediaSizeBytes)].filter(Boolean).join(" · ");

  return (
    <div className="mt-1.5 space-y-1">
      {tipe.startsWith("image/") ? (
        <a href={url} target="_blank" rel="noreferrer" className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={pesan.mediaFileName ?? "Foto dari WhatsApp"} className="max-h-64 min-h-16 min-w-16 rounded-lg bg-surface-2 object-contain" loading="lazy" />
        </a>
      ) : tipe.startsWith("video/") ? (
        <video src={url} controls preload="metadata" className="max-h-64 w-full max-w-sm rounded-lg" />
      ) : tipe.startsWith("audio/") ? (
        <audio src={url} controls preload="none" className="w-64 max-w-full" />
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1.5 text-sm text-primary hover:underline">
          <FileText className="h-4 w-4" aria-hidden /> {pesan.mediaFileName ?? "Buka berkas"}
        </a>
      )}
      <p className="flex items-center gap-2 text-[11px] text-muted">
        {keterangan}
        <a href={url} download className="inline-flex items-center gap-1 text-primary hover:underline">
          <Download className="h-3 w-3" aria-hidden /> Unduh
        </a>
      </p>
    </div>
  );
};
