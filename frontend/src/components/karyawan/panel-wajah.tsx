"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ScanFace, Camera, CameraOff, ImageUp, RotateCcw, Trash2, X, Check, Clock } from "lucide-react";
import { api, ambilGalat } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button, TombolAksi } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Modal, ConfirmDialog } from "@/components/ui/modal";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatTanggal } from "@/lib/utils";
import type { PendaftaranWajah } from "@/lib/types";
import {
  kueriWajah,
  FotoKiriman,
  KeteranganKiriman,
  TombolTinjau,
  DialogSetujuiWajah,
  DialogTolakWajah,
  PilihanGantiFoto,
  type AksiTinjau,
  type KirimanWajah,
} from "./tinjau-wajah";

/**
 * Sisi terpanjang foto yang dikirim. Wajah tetap jauh di atas batas minimal
 * deteksi server (60 px), sementara berkasnya hanya ratusan KB — jauh dari
 * batas body 10 MB yang kalau terlampaui ditolak tanpa pesan yang jelas.
 */
const SISI_MAKS = 1280;
const MUTU_JPEG = 0.9;

/**
 * Menggambar ulang sumber ke kanvas lalu menjadikannya JPEG. Server membaca
 * piksel apa adanya tanpa melihat tag orientasi EXIF, sedangkan peramban
 * menerapkannya saat menggambar — jadi foto ponsel yang "tegak lewat EXIF"
 * terkirim benar-benar tegak. Metadata (termasuk GPS) ikut terbuang.
 */
const keJpeg = (sumber: CanvasImageSource, lebar: number, tinggi: number) => {
  const skala = Math.min(1, SISI_MAKS / Math.max(lebar, tinggi));
  const kanvas = document.createElement("canvas");
  kanvas.width = Math.round(lebar * skala);
  kanvas.height = Math.round(tinggi * skala);
  const ctx = kanvas.getContext("2d");
  if (!ctx) throw new Error("Peramban tidak bisa memproses gambar");
  ctx.drawImage(sumber, 0, 0, kanvas.width, kanvas.height);
  return kanvas.toDataURL("image/jpeg", MUTU_JPEG);
};

const bacaFoto = async (berkas: File) => {
  const url = URL.createObjectURL(berkas);
  try {
    const img = await new Promise<HTMLImageElement>((selesai, gagal) => {
      const i = new Image();
      i.onload = () => selesai(i);
      i.onerror = () => gagal(new Error("Berkas ini bukan gambar yang bisa dibaca peramban. Pakai JPG atau PNG."));
      i.src = url;
    });
    return keJpeg(img, img.naturalWidth, img.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
};

/**
 * Wajah karyawan yang dicocokkan dengan selfie saat check-in. Ada dua jalan
 * masuk: HR mendaftarkannya langsung di sini, atau karyawan mengirim selfie
 * dari aplikasi lalu HR menyetujuinya di sini. Kiriman dari aplikasi tidak
 * pernah dipakai sebelum disetujui — lihat tinjau-wajah.tsx untuk alasannya.
 *
 * `bolehDaftar` (izin wajah.buat) juga izin menyetujui/menolak kiriman.
 */
export const PanelWajah = ({
  employeeId,
  employeeName,
  bolehDaftar,
  bolehHapus,
}: {
  employeeId: string;
  employeeName: string;
  bolehDaftar: boolean;
  bolehHapus: boolean;
}) => {
  const qc = useQueryClient();
  const [daftarBuka, setDaftarBuka] = React.useState(false);
  const [hapus, setHapus] = React.useState<PendaftaranWajah | null>(null);
  const [tinjau, setTinjau] = React.useState<AksiTinjau>(null);

  const { data, isLoading, isError, error } = useQuery(kueriWajah(employeeId));

  const aktif = data?.data ?? [];
  const siap = aktif.filter((w) => !w.stale);
  const pending = data?.pending ?? null;
  const kiriman: KirimanWajah | null = pending && {
    id: pending.id,
    employeeId,
    employeeName,
    createdAt: pending.createdAt,
    livenessScore: pending.livenessScore,
    stale: pending.stale,
  };

  const segarkan = () => {
    qc.invalidateQueries({ queryKey: ["wajah", employeeId] });
    // Kolom "Wajah" di daftar karyawan ikut berubah.
    qc.invalidateQueries({ queryKey: ["karyawan"] });
  };

  const nonaktifkan = useMutation({
    mutationFn: async (w: PendaftaranWajah) => api.delete(`/face-enrollments/${w.id}`),
    onSuccess: (_, dinonaktifkan) => {
      segarkan();
      const sisa = siap.filter((w) => w.id !== dinonaktifkan.id).length;
      notifikasi.sukses(
        "Foto wajah dinonaktifkan",
        sisa > 0 ? `${sisa} foto lain masih dipakai untuk check-in.` : `${employeeName} tidak bisa check-in dengan wajah sampai didaftarkan lagi.`
      );
      setHapus(null);
    },
    onError: (e) => notifikasi.galat(e),
  });

  const fotoTerakhir = hapus !== null && !hapus.stale && siap.length === 1;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Wajah untuk Presensi</CardTitle>
          <CardDescription>
            {!data ? (
              "Dicocokkan dengan selfie saat check-in"
            ) : siap.length > 0 ? (
              `${siap.length} foto aktif · dicocokkan dengan selfie saat check-in`
            ) : kiriman ? (
              <span className="text-info">Foto dari aplikasi menunggu persetujuan — check-in dengan verifikasi wajah ditolak sampai disetujui</span>
            ) : (
              <span className="text-warning">Belum terdaftar — check-in dengan verifikasi wajah akan ditolak</span>
            )}
          </CardDescription>
        </div>
        {bolehDaftar && data && (
          <Button size="sm" className="shrink-0" onClick={() => setDaftarBuka(true)}>
            <ScanFace className="h-4 w-4" aria-hidden /> {siap.length > 0 ? "Tambah foto" : "Daftarkan"}
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0 sm:p-0">
        {isLoading ? (
          <SkeletonBaris jumlah={2} />
        ) : isError ? (
          <div className="p-4 sm:p-5">
            <Alert tone="danger" title="Data wajah tidak bisa dimuat">{ambilGalat(error).pesan}</Alert>
          </div>
        ) : (
          <>
            {kiriman && (
              <KartuMenunggu
                kiriman={kiriman}
                bolehTinjau={bolehDaftar}
                className={aktif.length > 0 ? "border-b border-border" : undefined}
                onAksi={setTinjau}
              />
            )}
            {aktif.length === 0 ? (
              // Bila ada kiriman menunggu, kartunya sudah menjelaskan keadaannya;
              // ajakan "Daftarkan wajah" yang besar hanya membuat HR ragu apakah
              // harus memotret ulang. Tombol "Daftarkan" di kepala kartu tetap ada.
              !kiriman && (
                <EmptyState
                  icon={ScanFace}
                  title="Wajah belum terdaftar"
                  description={
                    bolehDaftar
                      ? `Daftarkan wajah ${employeeName} agar bisa check-in dengan Verifikasi Wajah, atau minta ${employeeName} mengirim selfie dari menu Profil di aplikasi. Sampai saat itu, presensi tetap bisa lewat GPS atau QR.`
                      : "Minta HR mendaftarkan wajah karyawan ini."
                  }
                  action={
                    bolehDaftar && (
                      <Button onClick={() => setDaftarBuka(true)}>
                        <Camera className="h-4 w-4" aria-hidden /> Daftarkan wajah
                      </Button>
                    )
                  }
                />
              )
            ) : (
              <>
                {siap.length === 0 && (
                  <div className="p-4 sm:p-5 pb-0 sm:pb-0">
                    <Alert tone="warning" title="Perlu didaftarkan ulang">
                      Model pengenalan wajah di server sudah diganti ({data?.activeModel}). Foto lama tidak bisa dibandingkan dengan model baru,
                      jadi check-in wajah {employeeName} ditolak sampai didaftarkan lagi.
                    </Alert>
                  </div>
                )}
                <ul className="divide-y divide-border">
                  {aktif.map((w, i) => (
                    <li key={w.id} className="flex items-center gap-3 px-4 py-3 sm:px-5 animate-fade-up">
                      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-lg", w.stale ? "bg-warning-soft text-warning" : "bg-success-soft text-success")}>
                        <ScanFace className="h-5 w-5" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          Foto {aktif.length - i}
                          {w.stale ? <Badge tone="warning" dot>Perlu daftar ulang</Badge> : <Badge tone="success" dot>Dipakai</Badge>}
                        </p>
                        <p className="text-xs text-muted">
                          {formatTanggal(w.createdAt, "d MMM yyyy HH:mm")}
                          {/* Kiriman mandiri "didaftarkan" oleh karyawannya sendiri; yang berarti untuk audit adalah siapa yang menyetujui. */}
                          {w.source === "self"
                            ? ` · dari aplikasi${w.reviewedBy ? `, disetujui ${w.reviewedBy.name}` : ""}`
                            : w.enrolledBy && ` · oleh ${w.enrolledBy.name}`}{" "}
                          · mutu deteksi {Math.round(w.detectionScore * 100)}%
                        </p>
                      </div>
                      {bolehHapus && (
                        <TombolAksi icon={Trash2} label={`Nonaktifkan foto ${aktif.length - i}`} tone="bahaya" onClick={() => setHapus(w)} />
                      )}
                    </li>
                  ))}
                </ul>
                {bolehDaftar && siap.length === 1 && (
                  <p className="border-t border-border px-4 py-3 text-xs text-muted sm:px-5">
                    Tambahkan 1–2 foto lagi dengan kondisi berbeda (mis. berkacamata, pencahayaan lain) supaya pencocokan saat check-in lebih andal.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </CardContent>

      <DialogDaftarWajah
        open={daftarBuka}
        onClose={() => setDaftarBuka(false)}
        employeeId={employeeId}
        employeeName={employeeName}
        jumlahAktif={aktif.length}
        onTerdaftar={segarkan}
      />

      <ConfirmDialog
        open={Boolean(hapus)}
        onClose={() => setHapus(null)}
        onConfirm={() => hapus && nonaktifkan.mutate(hapus)}
        loading={nonaktifkan.isPending}
        danger
        title="Nonaktifkan foto wajah?"
        description={
          fotoTerakhir
            ? `Ini satu-satunya foto yang dipakai. Setelah dinonaktifkan, ${employeeName} tidak bisa check-in dengan wajah sampai didaftarkan lagi. Jejak pendaftarannya tetap tersimpan untuk audit.`
            : "Foto ini tidak dipakai lagi untuk mencocokkan presensi. Jejak pendaftarannya tetap tersimpan untuk audit."
        }
        confirmLabel="Nonaktifkan"
        confirmIcon={Trash2}
      />

      <DialogSetujuiWajah kiriman={tinjau?.jenis === "setujui" ? tinjau.kiriman : null} onClose={() => setTinjau(null)} />
      <DialogTolakWajah kiriman={tinjau?.jenis === "tolak" ? tinjau.kiriman : null} onClose={() => setTinjau(null)} />
    </Card>
  );
};

/**
 * Kiriman dari aplikasi yang menunggu, di atas daftar foto aktif. Foto hanya
 * dimuat untuk peninjau: endpoint fotonya memang khusus wajah.buat, dan
 * pemegang wajah.lihat cukup tahu bahwa ada kiriman yang menunggu.
 */
const KartuMenunggu = ({
  kiriman,
  bolehTinjau,
  className,
  onAksi,
}: {
  kiriman: KirimanWajah;
  bolehTinjau: boolean;
  className?: string;
  onAksi: (aksi: NonNullable<AksiTinjau>) => void;
}) => (
  <div className={cn("p-4 sm:p-5", className)}>
    <div className="flex gap-3 rounded-xl border border-info/30 bg-info-soft p-3 animate-fade-up">
      {bolehTinjau ? (
        <FotoKiriman key={kiriman.id} id={kiriman.id} alt={`Foto wajah kiriman ${kiriman.employeeName}`} className="h-28 w-21 shrink-0 sm:h-32 sm:w-24" />
      ) : (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface text-info">
          <Clock className="h-5 w-5" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-medium">Menunggu persetujuan</p>
        <KeteranganKiriman kiriman={kiriman} />
        {bolehTinjau ? (
          <>
            <p className="text-xs text-muted">Pastikan orang di foto ini benar {kiriman.employeeName} sebelum menyetujui.</p>
            <TombolTinjau kiriman={kiriman} onAksi={onAksi} className="pt-2" />
          </>
        ) : (
          <p className="text-xs text-muted">Belum dipakai untuk check-in sampai HR yang berwenang menyetujuinya.</p>
        )}
      </div>
    </div>
  </div>
);

type PropsDialog = {
  open: boolean;
  onClose: () => void;
  employeeId: string;
  employeeName: string;
  jumlahAktif: number;
  onTerdaftar: () => void;
};

const DialogDaftarWajah = (props: PropsDialog) => {
  // Di-mount ulang tiap dibuka: state bersih, dan kamera pasti mati saat ditutup.
  if (!props.open) return null;
  return <IsiDaftarWajah {...props} />;
};

const IsiDaftarWajah = ({ onClose, employeeId, employeeName, jumlahAktif, onTerdaftar }: PropsDialog) => {
  const [sumber, setSumber] = React.useState<"kamera" | "unggah">("kamera");
  const [foto, setFoto] = React.useState<string | null>(null);
  const [ganti, setGanti] = React.useState(false);
  const [galat, setGalat] = React.useState<string | null>(null);

  const pilihSumber = (s: "kamera" | "unggah") => {
    setSumber(s);
    setFoto(null);
    setGalat(null);
  };

  const ulangi = () => {
    setFoto(null);
    setGalat(null);
  };

  const pilihBerkas = async (berkas: File | undefined) => {
    if (!berkas) return;
    setGalat(null);
    try {
      setFoto(await bacaFoto(berkas));
    } catch (e) {
      setGalat(e instanceof Error ? e.message : "Berkas tidak bisa dibaca");
    }
  };

  const daftar = useMutation({
    mutationFn: async () =>
      (
        await api.post<PendaftaranWajah>(
          `/employees/${employeeId}/face-enrollments`,
          { image: foto, replaceExisting: ganti },
          // Pemuatan model wajah pertama kali di server bisa lebih lama dari batas bawaan 20 detik.
          { timeout: 60_000 }
        )
      ).data,
    onSuccess: () => {
      onTerdaftar();
      notifikasi.sukses("Wajah terdaftar", `${employeeName} sekarang bisa check-in dengan Verifikasi Wajah.`);
      onClose();
    },
    // Galat ditampilkan di dalam dialog, bukan toast: HR perlu membacanya
    // sambil memotret ulang (mis. "Tidak ada wajah terdeteksi").
    onError: (e) => setGalat(ambilGalat(e).pesan),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Daftarkan Wajah"
      description={`${employeeName} · foto dicocokkan dengan selfie saat check-in`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={daftar.isPending}>
            <X className="h-4 w-4" aria-hidden /> Batal
          </Button>
          <Button onClick={() => daftar.mutate()} loading={daftar.isPending} disabled={!foto}>
            {!daftar.isPending && <Check className="h-4 w-4" aria-hidden />} Daftarkan
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div role="tablist" aria-label="Sumber foto" className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
          {(
            [
              ["kamera", "Kamera", Camera],
              ["unggah", "Unggah foto", ImageUp],
            ] as const
          ).map(([kunci, label, Ikon]) => (
            <button
              key={kunci}
              type="button"
              role="tab"
              aria-selected={sumber === kunci}
              onClick={() => pilihSumber(kunci)}
              disabled={daftar.isPending}
              className={cn(
                "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                sumber === kunci ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground"
              )}
            >
              <Ikon className="h-4 w-4" aria-hidden /> {label}
            </button>
          ))}
        </div>

        {foto ? (
          <div className="space-y-2">
            <div className="overflow-hidden rounded-xl border border-border bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={foto} alt={`Foto wajah ${employeeName}`} className="mx-auto max-h-80 object-contain" />
            </div>
            <Button variant="outline" size="sm" onClick={ulangi} disabled={daftar.isPending}>
              <RotateCcw className="h-4 w-4" aria-hidden /> {sumber === "kamera" ? "Foto ulang" : "Pilih foto lain"}
            </Button>
          </div>
        ) : sumber === "kamera" ? (
          <Kamera onJepret={setFoto} onTidakTersedia={() => pilihSumber("unggah")} />
        ) : (
          <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-8 text-center transition-colors hover:border-primary/60">
            <ImageUp className="h-6 w-6 text-muted" aria-hidden />
            <span className="text-sm text-muted">
              <span className="font-medium text-primary">Pilih foto</span> wajah {employeeName} dari perangkat
            </span>
            <span className="text-xs text-muted">JPG atau PNG, satu orang, wajah menghadap depan</span>
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              data-testid="berkas-wajah"
              onChange={(e) => {
                void pilihBerkas(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        )}

        {galat && (
          <Alert tone="danger" title="Foto belum bisa dipakai">
            {galat}
          </Alert>
        )}

        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          <li>Hanya {employeeName} yang terlihat, wajah menghadap kamera dan memenuhi bingkai.</li>
          <li>Cahaya cukup dan rata; lepas masker, topi, dan kacamata hitam.</li>
          <li>Sebaiknya dipotret langsung di tempat — kondisinya mirip selfie saat check-in.</li>
        </ul>

        {jumlahAktif > 0 && (
          <PilihanGantiFoto jumlah={jumlahAktif} nama={employeeName} checked={ganti} onChange={setGanti} disabled={daftar.isPending} />
        )}
      </div>
    </Modal>
  );
};

type GalatKamera = "ditolak" | "sibuk" | "tidak_ada" | "tidak_aman";
type KeadaanKamera = "memuat" | "hidup" | GalatKamera;

/** Tipe DOM menganggapnya selalu ada, padahal di luar HTTPS/localhost `mediaDevices` tidak ada sama sekali. */
const kameraTersedia = () => typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";

const keadaanAwal = (): KeadaanKamera => {
  if (kameraTersedia()) return "memuat";
  return typeof window !== "undefined" && !window.isSecureContext ? "tidak_aman" : "tidak_ada";
};

/**
 * Nama galat getUserMedia → keadaan. Izin yang ditolak dibedakan dari kamera
 * yang sedang dipegang aplikasi lain (Zoom/Teams di Windows melempar
 * NotReadableError walau izinnya sudah diberikan) — petunjuknya berbeda.
 */
const galatKamera = (e: unknown): GalatKamera => {
  const nama = e instanceof DOMException ? e.name : "";
  if (nama === "NotAllowedError" || nama === "SecurityError") return "ditolak";
  if (nama === "NotFoundError" || nama === "OverconstrainedError") return "tidak_ada";
  return "sibuk";
};

const PESAN_KAMERA: Record<GalatKamera, { judul: string; isi: string }> = {
  ditolak: { judul: "Akses kamera ditolak", isi: "Izinkan kamera untuk situs ini di pengaturan peramban, lalu buka dialog ini lagi. Atau unggah foto yang sudah ada." },
  sibuk: { judul: "Kamera tidak bisa dibuka", isi: "Kamera mungkin sedang dipakai aplikasi lain (mis. Zoom atau Teams). Tutup aplikasi itu lalu buka dialog ini lagi, atau unggah foto." },
  tidak_ada: { judul: "Kamera tidak tersedia", isi: "Perangkat ini tidak punya kamera yang bisa dipakai peramban. Unggah foto wajah sebagai gantinya." },
  tidak_aman: { judul: "Kamera butuh koneksi aman", isi: "Peramban hanya mengizinkan kamera di alamat HTTPS. Buka aplikasi lewat https://, atau unggah foto." },
};

/** Pratinjau kamera depan dengan bingkai wajah; tombolnya memotret satu frame. */
const Kamera = ({ onJepret, onTidakTersedia }: { onJepret: (foto: string) => void; onTidakTersedia: () => void }) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [keadaan, setKeadaan] = React.useState<KeadaanKamera>(keadaanAwal);

  React.useEffect(() => {
    if (!kameraTersedia()) return;
    let aliran: MediaStream | null = null;
    let batal = false;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (batal) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        aliran = s;
        const video = videoRef.current;
        if (video) {
          video.srcObject = s;
          void video.play().catch(() => undefined);
        }
        setKeadaan("hidup");
      })
      .catch((e: unknown) => {
        if (!batal) setKeadaan(galatKamera(e));
      });
    return () => {
      batal = true;
      aliran?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const jepret = () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return;
    // Frame diambil apa adanya (tidak dicerminkan), sama seperti foto kamera
    // depan di aplikasi; hanya pratinjaunya yang dicerminkan.
    onJepret(keJpeg(video, video.videoWidth, video.videoHeight));
  };

  if (keadaan !== "memuat" && keadaan !== "hidup") {
    return (
      <Alert
        tone="warning"
        title={PESAN_KAMERA[keadaan].judul}
        action={
          <Button variant="outline" size="sm" onClick={onTidakTersedia}>
            <ImageUp className="h-4 w-4" aria-hidden /> Unggah foto saja
          </Button>
        }
      >
        {PESAN_KAMERA[keadaan].isi}
      </Alert>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} muted playsInline className="h-full w-full -scale-x-100 object-cover" aria-label="Pratinjau kamera" />
        <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="aspect-[3/4] h-4/5 rounded-[50%] border-2 border-dashed border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        </div>
        {keadaan === "memuat" && (
          <div className="absolute inset-0 grid place-items-center text-sm text-white/80">
            <span className="inline-flex items-center gap-2">
              <CameraOff className="h-4 w-4" aria-hidden /> Menyalakan kamera…
            </span>
          </div>
        )}
      </div>
      <Button className="w-full" onClick={jepret} disabled={keadaan !== "hidup"}>
        <Camera className="h-4 w-4" aria-hidden /> Ambil foto
      </Button>
    </div>
  );
};
