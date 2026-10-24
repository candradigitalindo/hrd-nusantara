import { Reply } from "lucide-react";
import { formatNomorWa, tampakLid } from "@/lib/utils";
import type { Percakapan } from "@/lib/types";
import { LABEL_TIPE } from "./util-wa";

/** Kutipan tetap terbaca walau pesan asal belum dimuat atau tidak masuk arsip. */
export const KutipanPesan = ({
  kutipan,
  onLihatAsal,
}: {
  kutipan: NonNullable<Percakapan["quotedMessage"]>;
  onLihatAsal?: () => void;
}) => {
  const pengirim = kutipan.pengirim;
  const nomor = pengirim?.nomor && !tampakLid(pengirim.nomor, pengirim.lid) ? pengirim.nomor : null;
  const nama = pengirim?.nama ?? pengirim?.karyawan?.name ?? (nomor ? formatNomorWa(nomor) : null);
  const tipe = kutipan.messageType;
  const label = tipe && tipe !== "text" ? LABEL_TIPE[tipe] ?? "Pesan" : null;
  const isi = kutipan.messageBody?.trim()
    ? [label, kutipan.messageBody].filter(Boolean).join(" · ")
    : label ?? "Pesan asli tidak tersedia";
  const konten = (
    <>
      <span className="flex items-start gap-1 text-[11px] font-semibold text-primary [overflow-wrap:anywhere]">
        <Reply className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        <span>Membalas {nama ?? "pesan"}</span>
      </span>
      <span className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs text-muted [overflow-wrap:anywhere]">{isi}</span>
    </>
  );

  return (
    <blockquote className="mb-1.5 overflow-hidden rounded-lg border-l-4 border-primary/60 bg-surface-2/80">
      {onLihatAsal ? (
        <button type="button" onClick={onLihatAsal} title="Lihat pesan yang dibalas" className="block w-full px-2.5 py-2 text-left hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2">
          {konten}
        </button>
      ) : (
        <div className="px-2.5 py-2">{konten}</div>
      )}
    </blockquote>
  );
};
