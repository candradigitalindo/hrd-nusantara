"use client";

import * as React from "react";
import { AlertTriangle, Camera, CameraOff, Check, ChevronLeft, ChevronRight, Clock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea, Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/modal";
import { notifikasi } from "@/hooks/use-notifikasi";
import { cn } from "@/lib/utils";
import { TeksKaya } from "@/components/ui/editor-teks";
import type { HasilKirimCbt, RuangUjian } from "@/lib/types";

/** Jawaban yang sedang dipegang layar, sebelum dan sesudah tersimpan di server. */
type Jawaban = { chosen: string[]; text: string | null };

export interface ApiUjian {
  simpan: (jawaban: { questionId: string; chosen: string[]; text: string | null }[]) => Promise<{ dikirimOtomatis?: boolean }>;
  kirim: () => Promise<HasilKirimCbt>;
  kejadian: (type: string, detail?: string) => Promise<void>;
  foto: (dataUrl: string) => Promise<void>;
  gambarSoal: (questionId: string) => string;
}

const jam = (detik: number) => {
  const d = Math.max(0, detik);
  const h = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = d % 60;
  const dua = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${dua(h)}:${dua(m)}:${dua(s)}` : `${dua(m)}:${dua(s)}`;
};

const terisi = (j: Jawaban | undefined) => Boolean(j && (j.chosen.length > 0 || (j.text ?? "").trim().length > 0));

export const RuangUjianCbt = ({
  ruang,
  api,
  onSelesai,
}: {
  ruang: RuangUjian;
  api: ApiUjian;
  onSelesai: (hasil: HasilKirimCbt) => void;
}) => {
  const [jawaban, setJawaban] = React.useState<Record<string, Jawaban>>(() =>
    Object.fromEntries(ruang.answers.map((a) => [a.questionId, { chosen: a.chosen, text: a.text }]))
  );
  const [indeks, setIndeks] = React.useState(0);
  const [sisa, setSisa] = React.useState(ruang.sisaDetik);
  const [mengirim, setMengirim] = React.useState(false);
  const [konfirmasi, setKonfirmasi] = React.useState(false);
  const [kamera, setKamera] = React.useState<"mati" | "hidup" | "ditolak">("mati");
  const [tersimpanPada, setTersimpanPada] = React.useState<Date | null>(null);

  const kotor = React.useRef<Set<string>>(new Set());
  const sudahKirim = React.useRef(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);

  const soal = ruang.questions[indeks];
  const jumlahTerisi = ruang.questions.filter((q) => terisi(jawaban[q.id])).length;

  // --- Simpan otomatis -----------------------------------------------------
  // Jawaban dikumpulkan lalu dikirim sekaligus tiap beberapa detik: satu
  // permintaan per ketukan akan menabrak batas laju saat satu ruangan ujian
  // menyimpan berbarengan.
  const simpanKotor = React.useCallback(async () => {
    if (kotor.current.size === 0 || sudahKirim.current) return;
    const daftar = [...kotor.current].map((id) => ({
      questionId: id,
      chosen: jawaban[id]?.chosen ?? [],
      text: jawaban[id]?.text ?? null,
    }));
    kotor.current.clear();
    try {
      const hasil = await api.simpan(daftar);
      setTersimpanPada(new Date());
      if (hasil.dikirimOtomatis) {
        sudahKirim.current = true;
        notifikasi.peringatan("Waktu habis", "Jawaban yang sudah tersimpan dikirim otomatis.");
        onSelesai({ status: "submitted", menungguPenilaian: true, nilai: null });
      }
    } catch (e) {
      // Jawaban tetap ditandai kotor supaya dicoba lagi pada siklus berikutnya.
      daftar.forEach((j) => kotor.current.add(j.questionId));
      notifikasi.galat(e, "Jawaban belum tersimpan");
    }
  }, [api, jawaban, onSelesai]);

  React.useEffect(() => {
    const t = setInterval(simpanKotor, 4000);
    return () => clearInterval(t);
  }, [simpanKotor]);

  const ubahJawaban = (questionId: string, isi: Jawaban) => {
    setJawaban((j) => ({ ...j, [questionId]: isi }));
    kotor.current.add(questionId);
  };

  // --- Hitung mundur -------------------------------------------------------
  const kirim = React.useCallback(
    async (otomatis = false) => {
      if (sudahKirim.current) return;
      sudahKirim.current = true;
      setMengirim(true);
      try {
        await simpanKotor();
        const hasil = await api.kirim();
        if (otomatis) notifikasi.peringatan("Waktu habis", "Jawaban Anda dikirim otomatis.");
        onSelesai(hasil);
      } catch (e) {
        sudahKirim.current = false;
        notifikasi.galat(e, "Gagal mengirim jawaban");
      } finally {
        setMengirim(false);
      }
    },
    [api, onSelesai, simpanKotor]
  );

  React.useEffect(() => {
    const t = setInterval(() => {
      setSisa((s) => {
        if (s <= 1) {
          clearInterval(t);
          void kirim(true);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [kirim]);

  // --- Pengawasan ----------------------------------------------------------
  React.useEffect(() => {
    if (!ruang.test.recordProctorEvents) return;
    const keluar = () => {
      if (document.visibilityState === "hidden") void api.kejadian("keluar_layar");
      else void api.kejadian("kembali");
    };
    const salin = () => void api.kejadian("salin");
    const tempel = () => void api.kejadian("tempel");
    document.addEventListener("visibilitychange", keluar);
    document.addEventListener("copy", salin);
    document.addEventListener("paste", tempel);
    return () => {
      document.removeEventListener("visibilitychange", keluar);
      document.removeEventListener("copy", salin);
      document.removeEventListener("paste", tempel);
    };
  }, [api, ruang.test.recordProctorEvents]);

  // Peringatan sebelum menutup tab: menutup tab tidak membatalkan hitung mundur.
  React.useEffect(() => {
    const tanya = (e: BeforeUnloadEvent) => {
      if (sudahKirim.current) return;
      e.preventDefault();
    };
    window.addEventListener("beforeunload", tanya);
    return () => window.removeEventListener("beforeunload", tanya);
  }, []);

  // Foto pengawasan berkala.
  React.useEffect(() => {
    if (!ruang.test.proctorPhotos) return;
    let aliran: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let batal = false;

    const jepret = async () => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return;
      const kanvas = document.createElement("canvas");
      kanvas.width = 480;
      kanvas.height = Math.round((video.videoHeight / video.videoWidth) * 480);
      kanvas.getContext("2d")?.drawImage(video, 0, 0, kanvas.width, kanvas.height);
      try {
        await api.foto(kanvas.toDataURL("image/jpeg", 0.7));
      } catch {
        // Foto yang gagal terkirim tidak boleh menghentikan ujian.
      }
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 640, facingMode: "user" }, audio: false })
      .then((s) => {
        if (batal) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        aliran = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          void videoRef.current.play();
        }
        setKamera("hidup");
        void jepret();
        timer = setInterval(jepret, Math.max(30, ruang.test.proctorPhotoIntervalSec) * 1000);
      })
      .catch(() => {
        setKamera("ditolak");
        void api.kejadian("kamera_mati", "izin kamera ditolak peserta");
      });

    return () => {
      batal = true;
      if (timer) clearInterval(timer);
      aliran?.getTracks().forEach((t) => t.stop());
    };
  }, [api, ruang.test.proctorPhotos, ruang.test.proctorPhotoIntervalSec]);

  // --- Tampilan ------------------------------------------------------------
  const isi = jawaban[soal.id] ?? { chosen: [], text: null };
  const pilihSatu = (kode: string) => ubahJawaban(soal.id, { chosen: [kode], text: null });
  const pilihBanyak = (kode: string) => {
    const ada = isi.chosen.includes(kode);
    ubahJawaban(soal.id, { chosen: ada ? isi.chosen.filter((k) => k !== kode) : [...isi.chosen, kode], text: null });
  };

  const hampirHabis = sisa <= 60;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold">{ruang.test.title}</p>
            <p className="text-xs text-muted">
              {ruang.peserta.nama} · {jumlahTerisi}/{ruang.questions.length} soal terisi
              {tersimpanPada && ` · tersimpan ${tersimpanPada.toLocaleTimeString("id-ID")}`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {ruang.test.proctorPhotos && (
              <span className={cn("inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs", kamera === "hidup" ? "bg-success-soft text-success" : "bg-warning-soft text-warning")}>
                {kamera === "hidup" ? <Camera className="h-3.5 w-3.5" aria-hidden /> : <CameraOff className="h-3.5 w-3.5" aria-hidden />}
                {kamera === "hidup" ? "Kamera aktif" : "Kamera mati"}
              </span>
            )}
            <span
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 font-mono text-lg font-semibold tabular-nums",
                hampirHabis ? "bg-danger-soft text-danger" : "bg-surface-2 text-foreground"
              )}
              aria-live={hampirHabis ? "assertive" : "off"}
            >
              <Clock className="h-4 w-4" aria-hidden /> {jam(sisa)}
            </span>
            <Button onClick={() => setKonfirmasi(true)} loading={mengirim} disabled={mengirim}>
              {!mengirim && <Send className="h-4 w-4" aria-hidden />} Kirim
            </Button>
          </div>
        </div>
      </div>

      {kamera === "ditolak" && (
        <Alert tone="warning" title="Kamera tidak bisa diakses">
          Tes ini memakai foto pengawasan. Izinkan kamera di peramban Anda, lalu muat ulang halaman. Penolakan izin tercatat pada hasil.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <Card className="p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted">
              Soal {indeks + 1} dari {ruang.questions.length} · {soal.category}
            </p>
            <p className="text-xs text-muted">{soal.points} poin</p>
          </div>
          <TeksKaya html={soal.textHtml} teks={soal.text} className="mt-3 text-[15px] leading-relaxed" />

          {soal.imagePath && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={api.gambarSoal(soal.id)} alt="Gambar pendukung soal" className="mt-4 max-h-80 rounded-xl border border-border object-contain" />
          )}

          <div className="mt-5 space-y-2">
            {(soal.type === "pilihan_ganda" || soal.type === "benar_salah") &&
              soal.options.map((o) => (
                <label
                  key={o.kode}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                    isi.chosen.includes(o.kode) ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2"
                  )}
                >
                  <input
                    type="radio"
                    name={`soal-${soal.id}`}
                    className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                    checked={isi.chosen.includes(o.kode)}
                    onChange={() => pilihSatu(o.kode)}
                  />
                  <span className="text-sm">{o.teks}</span>
                </label>
              ))}

            {soal.type === "banyak_jawaban" && (
              <>
                <p className="text-xs text-muted">Pilih semua yang benar.</p>
                {soal.options.map((o) => (
                  <label
                    key={o.kode}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors",
                      isi.chosen.includes(o.kode) ? "border-primary bg-primary-soft" : "border-border hover:bg-surface-2"
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                      checked={isi.chosen.includes(o.kode)}
                      onChange={() => pilihBanyak(o.kode)}
                    />
                    <span className="text-sm">{o.teks}</span>
                  </label>
                ))}
              </>
            )}

            {soal.type === "isian" && (
              <Input
                value={isi.text ?? ""}
                onChange={(e) => ubahJawaban(soal.id, { chosen: [], text: e.target.value })}
                placeholder="Ketik jawaban singkat"
                aria-label="Jawaban singkat"
              />
            )}

            {soal.type === "esai" && (
              <Textarea
                rows={8}
                value={isi.text ?? ""}
                onChange={(e) => ubahJawaban(soal.id, { chosen: [], text: e.target.value })}
                placeholder="Tulis jawaban Anda"
                aria-label="Jawaban esai"
              />
            )}
          </div>

          <div className="mt-6 flex items-center justify-between gap-2">
            <Button variant="outline" onClick={() => setIndeks((i) => Math.max(0, i - 1))} disabled={indeks === 0}>
              <ChevronLeft className="h-4 w-4" aria-hidden /> Sebelumnya
            </Button>
            <Button
              variant="outline"
              onClick={() => setIndeks((i) => Math.min(ruang.questions.length - 1, i + 1))}
              disabled={indeks === ruang.questions.length - 1}
            >
              Berikutnya <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </Card>

        <Card className="h-fit p-4">
          <p className="text-sm font-medium">Navigasi soal</p>
          <p className="mt-1 text-xs text-muted">Kotak berwarna berarti sudah dijawab.</p>
          <div className="mt-3 grid grid-cols-6 gap-1.5 lg:grid-cols-5">
            {ruang.questions.map((q, i) => (
              <button
                key={q.id}
                type="button"
                onClick={() => setIndeks(i)}
                aria-label={`Ke soal ${i + 1}${terisi(jawaban[q.id]) ? ", sudah dijawab" : ""}`}
                aria-current={i === indeks ? "true" : undefined}
                className={cn(
                  "grid h-9 place-items-center rounded-lg text-sm font-medium transition-colors",
                  i === indeks && "ring-2 ring-[var(--ring)]",
                  terisi(jawaban[q.id]) ? "bg-primary text-on-primary" : "bg-surface-2 text-muted hover:bg-border"
                )}
              >
                {i + 1}
              </button>
            ))}
          </div>
        </Card>
      </div>

      {/* Pratinjau kamera disembunyikan: yang dibutuhkan hanya alirannya. */}
      {ruang.test.proctorPhotos && <video ref={videoRef} muted playsInline className="sr-only" />}

      <ConfirmDialog
        open={konfirmasi}
        onClose={() => setKonfirmasi(false)}
        onConfirm={() => {
          setKonfirmasi(false);
          void kirim();
        }}
        loading={mengirim}
        danger={jumlahTerisi < ruang.questions.length}
        title="Kirim jawaban sekarang?"
        description={
          jumlahTerisi < ruang.questions.length
            ? `Masih ada ${ruang.questions.length - jumlahTerisi} soal yang belum dijawab. Setelah dikirim, tes tidak bisa dibuka lagi.`
            : "Semua soal sudah dijawab. Setelah dikirim, tes tidak bisa dibuka lagi."
        }
        confirmLabel="Kirim"
        confirmIcon={Check}
      />
    </div>
  );
};

/** Layar setelah tes selesai, dipakai karyawan maupun pelamar. */
export const SelesaiUjian = ({ hasil, kembali }: { hasil: HasilKirimCbt; kembali?: React.ReactNode }) => (
  <div className="mx-auto max-w-lg p-6">
    <Card className="p-6 text-center">
      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-success-soft text-success">
        <Check className="h-7 w-7" aria-hidden />
      </span>
      <h1 className="mt-4 text-xl font-semibold">Jawaban terkirim</h1>
      {hasil.menungguPenilaian ? (
        <p className="mt-2 text-sm text-muted">
          Sebagian soal dinilai penguji, jadi nilainya belum keluar. HR akan memberi tahu hasilnya.
        </p>
      ) : hasil.nilai ? (
        <div className="mt-4 space-y-1">
          <p className="text-3xl font-bold tabular-nums">{hasil.nilai.persen}%</p>
          <p className="text-sm text-muted">
            {hasil.nilai.total} dari {hasil.nilai.maksimal} poin
          </p>
          {hasil.nilai.lulus !== null && (
            <p className={cn("mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm font-medium", hasil.nilai.lulus ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
              {hasil.nilai.lulus ? <Check className="h-4 w-4" aria-hidden /> : <AlertTriangle className="h-4 w-4" aria-hidden />}
              {hasil.nilai.lulus ? "Lulus" : "Belum lulus"}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-sm text-muted">Hasil tes ini hanya dibuka untuk HR.</p>
      )}
      {kembali && <div className="mt-6">{kembali}</div>}
    </Card>
  </div>
);
