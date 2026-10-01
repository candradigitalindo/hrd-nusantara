"use client";

import * as React from "react";
import Link from "next/link";
import { queryOptions, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, X, ScanFace, ImageOff, UserCheck, CheckCircle2 } from "lucide-react";
import { api, ambilGalat } from "@/lib/api";
import { notifikasi } from "@/hooks/use-notifikasi";
import { useSesi } from "@/hooks/use-sesi";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { Field, Textarea } from "@/components/ui/input";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { cn, formatTanggal, formatRelatif } from "@/lib/utils";
import type { Halaman, PendaftaranWajah, KirimanWajahMenunggu, WajahMenunggu } from "@/lib/types";

/**
 * Peninjauan foto wajah yang dikirim karyawan dari aplikasi.
 *
 * Kiriman mandiri baru dipakai untuk check-in setelah HR menyetujuinya:
 * tanpa itu karyawan A bisa mendaftarkan wajah rekannya B sebagai wajah A,
 * lalu B "menitipkan" absen kepada A. Jadi yang diperiksa HR di sini adalah
 * apakah orang di foto benar pemilik akunnya.
 */

export type DaftarWajah = Halaman<PendaftaranWajah> & {
  activeModel: string;
  /** Opsional supaya web tetap jalan selama backend lama belum diganti. */
  pending?: KirimanWajahMenunggu | null;
};

/** Satu sumber untuk panel dan dialog setujui, supaya keduanya berbagi cache yang sama. */
export const kueriWajah = (employeeId: string) =>
  queryOptions({
    queryKey: ["wajah", employeeId],
    queryFn: async () => (await api.get<DaftarWajah>(`/employees/${employeeId}/face-enrollments?limit=100`)).data,
  });

/** Antrean persetujuan, paling lama menunggu di atas. */
export const kueriWajahMenunggu = queryOptions({
  queryKey: ["wajah-menunggu"],
  queryFn: async () => (await api.get<Halaman<WajahMenunggu>>("/face-enrollments/pending?limit=100")).data,
});

/** Yang dibutuhkan tombol dan dialog tentang satu kiriman, dari panel maupun antrean. */
export type KirimanWajah = {
  id: string;
  employeeId: string;
  employeeName: string;
  createdAt: string;
  livenessScore: number | null;
  stale: boolean;
};

export type AksiTinjau = { jenis: "setujui" | "tolak"; kiriman: KirimanWajah } | null;

const persen = (nilai: number) => `${Math.round(nilai * 100)}%`;

/** "Dikirim dari aplikasi · 5 menit yang lalu · keaslian 98%" */
export const KeteranganKiriman = ({ kiriman, className }: { kiriman: KirimanWajah; className?: string }) => (
  <p className={cn("text-xs text-muted", className)}>
    Dikirim dari aplikasi ·{" "}
    <time dateTime={kiriman.createdAt} title={formatTanggal(kiriman.createdAt, "d MMM yyyy HH:mm")}>
      {formatRelatif(kiriman.createdAt)}
    </time>
    {kiriman.livenessScore !== null && ` · keaslian ${persen(kiriman.livenessScore)}`}
  </p>
);

/**
 * Foto kiriman, lewat proxy /api/backend supaya cookie sesi ikut terkirim.
 * Server hanya melayaninya selama kiriman masih menunggu; kalau HR lain
 * sudah memprosesnya, yang tampil adalah penanda, bukan ikon gambar rusak.
 */
export const FotoKiriman = ({
  id,
  alt,
  className,
  kelasGagal,
  lazy,
}: {
  id: string;
  alt: string;
  className?: string;
  /** Ukuran penanda saat foto gagal dimuat, bila ukuran gambarnya ditentukan isi (h-auto). */
  kelasGagal?: string;
  lazy?: boolean;
}) => {
  const [gagal, setGagal] = React.useState(false);
  if (gagal) {
    return (
      <span
        role="img"
        aria-label={`${alt} tidak bisa dimuat`}
        className={cn("grid place-items-center rounded-lg bg-surface-2 text-muted", className, kelasGagal)}
      >
        <ImageOff className="h-5 w-5" aria-hidden />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- foto privat lewat proxy bersesi; next/image tidak bisa (dan tidak boleh) menyimpannya
    <img
      src={`/api/backend/face-enrollments/${id}/photo`}
      alt={alt}
      loading={lazy ? "lazy" : undefined}
      onError={() => setGagal(true)}
      className={cn("rounded-lg bg-surface-2 object-cover", className)}
    />
  );
};

/**
 * Tombol Setujui/Tolak. Kiriman milik sendiri tidak diberi tombol: server
 * menolak HR menyetujui wajahnya sendiri — kalau boleh, pemegang izin ini
 * bisa mendaftarkan wajah orang lain sebagai dirinya tanpa ada yang memeriksa.
 */
export const TombolTinjau = ({
  kiriman,
  onAksi,
  className,
}: {
  kiriman: KirimanWajah;
  onAksi: (aksi: NonNullable<AksiTinjau>) => void;
  className?: string;
}) => {
  const { data: saya } = useSesi();

  if (saya?.id === kiriman.employeeId) {
    return (
      <p className={cn("inline-flex items-center gap-1.5 text-xs font-medium text-muted", className)}>
        <UserCheck className="h-4 w-4 shrink-0" aria-hidden /> Perlu disetujui HR lain
      </p>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {kiriman.stale && (
        // Server menolak menyetujuinya (409), jadi tombol Setujui tidak ditawarkan sama sekali.
        <p className="text-xs text-warning">
          Model pengenalan wajah sudah berganti sejak foto ini dikirim. Tolak, lalu minta {kiriman.employeeName} mengirim ulang.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!kiriman.stale && (
          <Button size="sm" onClick={() => onAksi({ jenis: "setujui", kiriman })}>
            <Check className="h-4 w-4" aria-hidden /> Setujui
          </Button>
        )}
        <Button size="sm" variant="outline" className="text-danger" onClick={() => onAksi({ jenis: "tolak", kiriman })}>
          <X className="h-4 w-4" aria-hidden /> Tolak
        </Button>
      </div>
    </div>
  );
};

/** Kotak centang "Ganti N foto lama", dipakai pendaftaran HR maupun persetujuan kiriman. */
export const PilihanGantiFoto = ({
  jumlah,
  nama,
  checked,
  onChange,
  disabled,
}: {
  jumlah: number;
  nama: string;
  checked: boolean;
  onChange: (ganti: boolean) => void;
  disabled?: boolean;
}) => (
  <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-primary-soft/40">
    <input
      type="checkbox"
      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      disabled={disabled}
    />
    <span>
      <span className="block text-sm font-medium">Ganti {jumlah} foto lama</span>
      <span className="block text-xs text-muted">
        Nonaktifkan foto yang sudah ada, mis. karena penampilan {nama} berubah jauh. Biarkan kosong untuk menambah foto.
      </span>
    </span>
  </label>
);

/**
 * Setelah setujui/tolak: panel karyawan, antrean, dan kolom "Wajah" di daftar
 * ikut berubah. Bila kiriman sudah diproses, ia dibuang dari cache lebih dulu:
 * tanpa itu antrean yang muncul kembali masih memuat barisnya sampai refetch
 * selesai, dan fotonya diminta ulang lalu dijawab 404 (foto hanya dilayani
 * selama menunggu).
 */
const useSegarkanTinjauan = () => {
  const qc = useQueryClient();
  return (kiriman: KirimanWajah, sudahDiproses: boolean) => {
    if (sudahDiproses) {
      qc.setQueryData(kueriWajahMenunggu.queryKey, (lama) =>
        lama && lama.data.some((w) => w.id === kiriman.id)
          ? {
              data: lama.data.filter((w) => w.id !== kiriman.id),
              pagination: { ...lama.pagination, total: Math.max(0, lama.pagination.total - 1) },
            }
          : lama
      );
      qc.setQueryData(kueriWajah(kiriman.employeeId).queryKey, (lama) =>
        lama?.pending?.id === kiriman.id ? { ...lama, pending: null } : lama
      );
    }
    qc.invalidateQueries({ queryKey: ["wajah", kiriman.employeeId] });
    qc.invalidateQueries({ queryKey: kueriWajahMenunggu.queryKey });
    qc.invalidateQueries({ queryKey: ["karyawan"] });
  };
};

/**
 * 404/409 berarti kiriman yang tampil sudah usang (diproses HR lain, digantikan
 * kiriman baru, atau modelnya berganti). Data dimuat ulang dan dialog ditutup
 * supaya HR melihat keadaan terbaru, bukan mencoba lagi pada kiriman yang sama.
 */
const useTanganiGalatTinjau = () => {
  const segarkan = useSegarkanTinjauan();
  return (e: unknown, kiriman: KirimanWajah, judul: string, onClose: () => void) => {
    notifikasi.galat(e, judul);
    const { status } = ambilGalat(e);
    if (status === 404 || status === 409) {
      // Bisa jadi masih menunggu (409 karena model berganti), jadi tidak
      // dibuang dari cache — biar server yang menentukan lewat refetch.
      segarkan(kiriman, false);
      onClose();
    }
  };
};

type PropsDialog = { kiriman: KirimanWajah | null; onClose: () => void };

/** Di-mount ulang per kiriman: pilihan dan isian tidak terbawa ke kiriman berikutnya. */
export const DialogSetujuiWajah = ({ kiriman, onClose }: PropsDialog) =>
  kiriman ? <IsiSetujui key={kiriman.id} kiriman={kiriman} onClose={onClose} /> : null;

const IsiSetujui = ({ kiriman, onClose }: { kiriman: KirimanWajah; onClose: () => void }) => {
  const segarkan = useSegarkanTinjauan();
  const tanganiGalat = useTanganiGalatTinjau();
  const [ganti, setGanti] = React.useState(false);

  // Jumlah foto aktif untuk pilihan "Ganti N foto lama". Dari panel datanya
  // sudah ada di cache; dari antrean di daftar karyawan diambil saat dialog dibuka.
  const wajah = useQuery(kueriWajah(kiriman.employeeId));
  const jumlahAktif = wajah.data?.pagination.total ?? 0;
  const gantiLama = ganti && jumlahAktif > 0;

  const setujui = useMutation({
    mutationFn: async () =>
      (await api.post<PendaftaranWajah>(`/face-enrollments/${kiriman.id}/approve`, { replaceExisting: gantiLama })).data,
    onSuccess: () => {
      segarkan(kiriman, true);
      notifikasi.sukses(
        "Wajah disetujui",
        `${kiriman.employeeName} sekarang bisa check-in dengan Verifikasi Wajah${gantiLama ? `; ${jumlahAktif} foto lama tidak dipakai lagi` : ""}.`
      );
      onClose();
    },
    onError: (e) => tanganiGalat(e, kiriman, "Gagal menyetujui", onClose),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Setujui foto wajah?"
      description={kiriman.employeeName}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={setujui.isPending}>
            <X className="h-4 w-4" aria-hidden /> Batal
          </Button>
          {/* Ditunggu sampai jumlah foto aktif diketahui, supaya pilihan "Ganti" tidak terlewat. */}
          <Button onClick={() => setujui.mutate()} loading={setujui.isPending} disabled={wajah.isLoading}>
            {!setujui.isPending && <Check className="h-4 w-4" aria-hidden />} Setujui
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="overflow-hidden rounded-xl border border-border bg-surface-2">
          <FotoKiriman
            id={kiriman.id}
            alt={`Foto wajah kiriman ${kiriman.employeeName}`}
            className="mx-auto block h-auto max-h-80 w-auto max-w-full rounded-none object-contain"
            kelasGagal="grid h-48 w-full"
          />
        </div>
        <KeteranganKiriman kiriman={kiriman} />
        <p className="text-sm text-muted">
          Pastikan orang di foto ini benar <span className="font-medium text-foreground">{kiriman.employeeName}</span>, bukan rekan
          yang dititipi absen. Setelah disetujui, foto ini dicocokkan dengan selfie {kiriman.employeeName} setiap check-in.
        </p>
        {jumlahAktif > 0 && (
          <PilihanGantiFoto jumlah={jumlahAktif} nama={kiriman.employeeName} checked={ganti} onChange={setGanti} disabled={setujui.isPending} />
        )}
      </div>
    </Modal>
  );
};

const ALASAN_MIN = 3;
const ALASAN_MAKS = 300;
/** Alasan yang paling sering; diketuk untuk mengisi, tetap bisa disunting. */
const CONTOH_ALASAN = ["Bukan wajah karyawan ini", "Foto buram", "Wajah tertutup masker atau kacamata hitam"];

export const DialogTolakWajah = ({ kiriman, onClose }: PropsDialog) =>
  kiriman ? <IsiTolak key={kiriman.id} kiriman={kiriman} onClose={onClose} /> : null;

const IsiTolak = ({ kiriman, onClose }: { kiriman: KirimanWajah; onClose: () => void }) => {
  const segarkan = useSegarkanTinjauan();
  const tanganiGalat = useTanganiGalatTinjau();
  const [alasan, setAlasan] = React.useState("");
  const [dicoba, setDicoba] = React.useState(false);

  const bersih = alasan.trim();
  const galatAlasan =
    bersih.length < ALASAN_MIN
      ? `Tulis alasannya, minimal ${ALASAN_MIN} karakter`
      : bersih.length > ALASAN_MAKS
        ? `Maksimal ${ALASAN_MAKS} karakter`
        : undefined;

  const tolak = useMutation({
    mutationFn: async () => (await api.post(`/face-enrollments/${kiriman.id}/reject`, { reason: bersih })).data,
    onSuccess: () => {
      segarkan(kiriman, true);
      notifikasi.sukses("Foto wajah ditolak", `${kiriman.employeeName} menerima alasannya dan bisa mengirim foto baru dari aplikasi.`);
      onClose();
    },
    onError: (e) => tanganiGalat(e, kiriman, "Gagal menolak", onClose),
  });

  const kirim = () => {
    setDicoba(true);
    if (!galatAlasan) tolak.mutate();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Tolak foto wajah?"
      description={kiriman.employeeName}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={tolak.isPending}>
            <X className="h-4 w-4" aria-hidden /> Batal
          </Button>
          <Button variant="danger" onClick={kirim} loading={tolak.isPending}>
            {!tolak.isPending && <X className="h-4 w-4" aria-hidden />} Tolak
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field
          label="Alasan penolakan"
          error={dicoba ? galatAlasan : undefined}
          hint="Dikirim ke karyawan supaya tahu apa yang perlu diperbaiki saat mengirim ulang."
        >
          <Textarea
            value={alasan}
            onChange={(e) => setAlasan(e.target.value)}
            rows={3}
            maxLength={ALASAN_MAKS}
            placeholder="mis. Bukan wajah karyawan ini"
            aria-invalid={dicoba && Boolean(galatAlasan)}
            autoFocus
          />
        </Field>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {CONTOH_ALASAN.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAlasan(a)}
                disabled={tolak.isPending}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:border-primary/60 hover:text-foreground"
              >
                {a}
              </button>
            ))}
          </div>
          <span className="shrink-0 text-xs tabular-nums text-muted" aria-live="polite">
            {bersih.length}/{ALASAN_MAKS}
          </span>
        </div>
      </div>
    </Modal>
  );
};

const keKiriman = (w: WajahMenunggu): KirimanWajah => ({
  id: w.id,
  employeeId: w.employeeId,
  employeeName: w.employee.name,
  createdAt: w.createdAt,
  livenessScore: w.livenessScore,
  stale: w.stale,
});

/**
 * Pengingat di atas daftar karyawan beserta antreannya. Hanya dipasang untuk
 * pemegang wajah.buat — endpoint antrean memang menolak yang lain.
 */
export const PengingatWajahMenunggu = () => {
  const [buka, setBuka] = React.useState(false);
  const [aksi, setAksi] = React.useState<AksiTinjau>(null);
  const { data, isLoading, isError, error } = useQuery(kueriWajahMenunggu);
  const total = data?.pagination.total ?? 0;

  // Tidak merender apa pun saat kosong: pembungkus kosong pun ikut mendapat
  // jarak dari space-y tata letak dan menggeser tabel ke bawah.
  if (total === 0 && !buka && !aksi) return null;

  return (
    // Pembungkus supaya Modal (position: fixed) tidak menjadi anak langsung
    // space-y tata letak: margin bawahnya memotong lembar bawah di ponsel.
    <div>
      {total > 0 && (
        <Alert
          tone="info"
          title={`${total} foto wajah menunggu persetujuan`}
          action={
            <Button size="sm" variant="outline" onClick={() => setBuka(true)}>
              <ScanFace className="h-4 w-4" aria-hidden /> Tinjau
            </Button>
          }
        >
          Dikirim karyawan dari aplikasi. Sampai disetujui, mereka belum bisa check-in dengan Verifikasi Wajah.
        </Alert>
      )}

      {/*
        Antrean disembunyikan selama dialog setujui/tolak terbuka, bukan
        ditumpuk: Modal menutup diri pada Esc lewat document, jadi dua Modal
        bertumpuk akan tertutup bersamaan. Setelah dialog selesai antrean muncul
        lagi dengan kiriman yang sudah diproses hilang dari daftar.
      */}
      <Modal
        open={buka && !aksi}
        onClose={() => setBuka(false)}
        size="lg"
        title="Foto wajah menunggu persetujuan"
        description="Pastikan orang di setiap foto benar karyawan yang mengirimnya"
      >
        {isLoading ? (
          <SkeletonBaris jumlah={3} />
        ) : isError ? (
          <Alert tone="danger" title="Antrean tidak bisa dimuat">{ambilGalat(error).pesan}</Alert>
        ) : !data || data.data.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Semua foto sudah ditinjau" description="Tidak ada kiriman yang menunggu persetujuan." />
        ) : (
          <>
            <ul className="-mx-4 -my-4 divide-y divide-border sm:-mx-5 sm:-my-5">
              {data.data.map((w) => {
                const kiriman = keKiriman(w);
                return (
                  <li key={w.id} className="flex gap-3 px-4 py-3 sm:px-5">
                    <FotoKiriman id={w.id} alt={`Foto wajah kiriman ${w.employee.name}`} lazy className="h-24 w-18 shrink-0 sm:h-28 sm:w-21" />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <Link href={`/karyawan/${w.employeeId}`} className="block truncate font-medium hover:text-primary hover:underline">
                        {w.employee.name}
                      </Link>
                      <p className="truncate text-xs text-muted">
                        {w.employee.nik} · {w.employee.department?.name ?? "Tanpa departemen"}
                      </p>
                      <KeteranganKiriman kiriman={kiriman} />
                      <TombolTinjau kiriman={kiriman} onAksi={setAksi} className="pt-2" />
                    </div>
                  </li>
                );
              })}
            </ul>
            {total > data.data.length && (
              <p className="mt-8 text-xs text-muted">
                Menampilkan {data.data.length} kiriman terlama dari {total}. Sisanya muncul setelah yang ini ditinjau.
              </p>
            )}
          </>
        )}
      </Modal>

      <DialogSetujuiWajah kiriman={aksi?.jenis === "setujui" ? aksi.kiriman : null} onClose={() => setAksi(null)} />
      <DialogTolakWajah kiriman={aksi?.jenis === "tolak" ? aksi.kiriman : null} onClose={() => setAksi(null)} />
    </div>
  );
};
