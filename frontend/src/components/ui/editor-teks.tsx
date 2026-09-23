"use client";

import * as React from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { TextAlign } from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  Link2Off,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table as TableIcon,
  Underline as UnderlineIcon,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Editor teks berformat untuk kolom keterangan yang panjang.
 *
 * Yang keluar adalah HTML, dan HTML itu TETAP dibersihkan ulang di server:
 * pembersihan di sini hanya menjaga bentuk yang dihasilkan editor, sedangkan
 * API bisa dipanggil tanpa peramban sama sekali.
 *
 * Dipakai lewat Controller react-hook-form:
 *   <Controller control={f.control} name="contentHtml"
 *     render={({ field }) => <EditorTeks {...field} />} />
 */

const WARNA = [
  { nilai: "", label: "Bawaan" },
  { nilai: "#e11d48", label: "Merah" },
  { nilai: "#d97706", label: "Jingga" },
  { nilai: "#059669", label: "Hijau" },
  { nilai: "#0284c7", label: "Biru" },
];

const Tombol = ({
  ikon: Ikon,
  label,
  aktif,
  onClick,
  disabled,
}: {
  ikon: LucideIcon;
  label: string;
  aktif?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    aria-pressed={aktif}
    disabled={disabled}
    // Tanpa ini, menekan tombol memindahkan fokus keluar dari editor dan
    // membuang teks yang sedang disorot — tebal/miring lalu dikenakan pada
    // "tidak ada" alih-alih pada pilihan pengguna.
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    className={cn(
      "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
      "disabled:opacity-40 disabled:pointer-events-none",
      aktif ? "bg-primary text-on-primary" : "text-muted hover:bg-surface-2 hover:text-foreground"
    )}
  >
    <Ikon className="h-4 w-4" aria-hidden />
  </button>
);

const Pemisah = () => <span className="mx-0.5 h-5 w-px shrink-0 bg-border" aria-hidden />;

const BilahAlat = ({ editor }: { editor: Editor }) => {
  const tautkan = () => {
    const sekarang = editor.getAttributes("link").href as string | undefined;
    const alamat = window.prompt("Alamat tautan (kosongkan untuk menghapus):", sekarang ?? "https://");
    if (alamat === null) return;
    if (alamat.trim() === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    // Hanya skema yang juga diterima server; javascript: ditolak di sini
    // supaya tidak terlanjur tersimpan lalu dibuang diam-diam.
    if (!/^(https?:|mailto:|tel:)/i.test(alamat.trim())) {
      window.alert("Tautan harus diawali http://, https://, mailto:, atau tel:");
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: alamat.trim() }).run();
  };

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface-2 p-1.5" role="toolbar" aria-label="Alat format teks">
      <Tombol ikon={Undo2} label="Batalkan (Ctrl+Z)" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} />
      <Tombol ikon={Redo2} label="Ulangi (Ctrl+Y)" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} />
      <Pemisah />
      <Tombol ikon={Bold} label="Tebal" aktif={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} />
      <Tombol ikon={Italic} label="Miring" aktif={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <Tombol ikon={UnderlineIcon} label="Garis bawah" aktif={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <Tombol ikon={Strikethrough} label="Coret" aktif={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <Tombol ikon={Code} label="Kode" aktif={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()} />
      <Pemisah />
      <Tombol ikon={Heading1} label="Judul besar" aktif={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
      <Tombol ikon={Heading2} label="Judul sedang" aktif={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} />
      <Tombol ikon={Heading3} label="Judul kecil" aktif={editor.isActive("heading", { level: 4 })} onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()} />
      <Pemisah />
      <Tombol ikon={List} label="Daftar butir" aktif={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <Tombol ikon={ListOrdered} label="Daftar bernomor" aktif={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <Tombol ikon={Quote} label="Kutipan" aktif={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      <Tombol ikon={Minus} label="Garis pemisah" onClick={() => editor.chain().focus().setHorizontalRule().run()} />
      <Pemisah />
      <Tombol ikon={AlignLeft} label="Rata kiri" aktif={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()} />
      <Tombol ikon={AlignCenter} label="Rata tengah" aktif={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()} />
      <Tombol ikon={AlignRight} label="Rata kanan" aktif={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()} />
      <Tombol ikon={AlignJustify} label="Rata kiri-kanan" aktif={editor.isActive({ textAlign: "justify" })} onClick={() => editor.chain().focus().setTextAlign("justify").run()} />
      <Pemisah />
      <Tombol ikon={Link2} label="Tautan" aktif={editor.isActive("link")} onClick={tautkan} />
      <Tombol ikon={Link2Off} label="Hapus tautan" onClick={() => editor.chain().focus().unsetLink().run()} disabled={!editor.isActive("link")} />
      <Tombol ikon={TableIcon} label="Sisipkan tabel 3×3" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
      <Pemisah />
      <label className="sr-only" htmlFor="warna-teks">
        Warna teks
      </label>
      <select
        id="warna-teks"
        onMouseDown={(e) => e.stopPropagation()}
        className="h-8 rounded-md border border-border bg-surface px-2 text-xs"
        value={(editor.getAttributes("textStyle").color as string) ?? ""}
        onChange={(e) => {
          const w = e.target.value;
          if (w) editor.chain().focus().setColor(w).run();
          else editor.chain().focus().unsetColor().run();
        }}
      >
        {WARNA.map((w) => (
          <option key={w.label} value={w.nilai}>
            {w.label}
          </option>
        ))}
      </select>
      <Tombol ikon={Eraser} label="Bersihkan format" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} />
    </div>
  );
};

export const EditorTeks = ({
  value,
  onChange,
  placeholder = "Tulis di sini…",
  minTinggi = "10rem",
}: {
  value: string | null | undefined;
  onChange: (html: string) => void;
  placeholder?: string;
  minTinggi?: string;
}) => {
  // HTML terakhir yang dikirim editor ini ke atas. Tanpa penanda itu, nilai
  // yang kembali dari formulir selalu tertinggal satu ketukan dari isi editor,
  // dan penyalinan balik di bawah akan memotong huruf yang baru diketik.
  const terakhirDikirim = React.useRef<string>("");

  const editor = useEditor({
    // Next merender komponen ini di server juga; tanpa ini React memperingatkan
    // ketidakcocokan hasil render pertama.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto", "tel"] },
      }),
      TextStyleKit,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TableKit.configure({ table: { resizable: false } }),
      Placeholder.configure({ placeholder }),
    ],
    content: value ?? "",
    editorProps: {
      attributes: {
        class: "teks-kaya focus:outline-none px-3 py-2",
        style: `min-height:${minTinggi}`,
      },
    },
    onUpdate: ({ editor: e }) => {
      // Dokumen kosong dikirim sebagai string kosong, bukan "<p></p>",
      // supaya "tidak diisi" tetap terbaca sebagai tidak diisi.
      const html = e.isEmpty ? "" : e.getHTML();
      terakhirDikirim.current = html;
      onChange(html);
    },
  });

  // Nilai dari LUAR (sunting, reset formulir) disalin ke editor; nilai yang
  // baru saja dikirim editor ini sendiri diabaikan, karena isinya sudah ada di
  // layar dan menyalinnya kembali akan menghapus ketukan terakhir.
  React.useEffect(() => {
    if (!editor) return;
    const isi = value ?? "";
    if (isi === terakhirDikirim.current) return;
    if (isi !== (editor.isEmpty ? "" : editor.getHTML())) {
      terakhirDikirim.current = isi;
      editor.commands.setContent(isi, { emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) return <div className="h-40 animate-pulse rounded-xl bg-surface-2" aria-hidden />;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface focus-within:border-ring">
      <BilahAlat editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
};

/**
 * Menampilkan HTML yang sudah dibersihkan server. Dipakai di halaman baca —
 * pengumuman, lowongan, program pelatihan, soal ujian.
 */
export const TeksKaya = ({ html, teks, className }: { html?: string | null; teks?: string | null; className?: string }) => {
  if (html) {
    // Aman karena isinya sudah melewati daftar putih di server (utils/richText.ts).
    return <div className={cn("teks-kaya", className)} dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return <div className={cn("whitespace-pre-wrap", className)}>{teks}</div>;
};
