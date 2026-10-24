import type { PengaturanPemantauan, PosisiKaryawan } from "./types";

export interface KeadaanPemantauan {
  label: string;
  nada: "success" | "warning" | "danger" | "neutral";
  rincian: string;
}

const waktu = (iso: string | null | undefined): number | null => {
  const nilai = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(nilai) ? nilai : null;
};

/** Status saat ini memakai titik terbaru seluruh waktu, bukan titik pada tanggal riwayat. */
export const keadaanPemantauan = (
  p: PosisiKaryawan,
  pengaturan: PengaturanPemantauan | undefined,
  sekarang: number,
): KeadaanPemantauan => {
  if (!pengaturan) return { label: "Pengaturan belum tersedia", nada: "neutral", rincian: "Muat ulang untuk membaca pengaturan pemantauan." };
  if (!pengaturan.enabled) return { label: "Nonaktif", nada: "neutral", rincian: "Pemantauan lokasi dinonaktifkan oleh admin." };

  const s = p.status;
  if (!s) return { label: "Belum melaporkan status", nada: "warning", rincian: "Status izin dan persetujuan belum diterima dari aplikasi mobile." };
  if (!s.consentAt) return { label: "Belum menyetujui", nada: "warning", rincian: "Pengungkapan pemantauan lokasi belum disetujui di aplikasi mobile." };
  if (s.permission === "service_off") return { label: "Layanan lokasi mati", nada: "danger", rincian: "Aktifkan layanan lokasi di pengaturan ponsel." };
  if (s.permission === "denied_forever") return { label: "Izin lokasi diblokir", nada: "danger", rincian: "Izinkan akses lokasi untuk HRD Nusantara melalui pengaturan ponsel." };
  if (s.permission === "denied") return { label: "Izin lokasi ditolak", nada: "danger", rincian: "Buka aplikasi mobile dan berikan izin lokasi." };
  if (s.permission === "notifications_denied") return { label: "Notifikasi pemantauan diblokir", nada: "danger", rincian: "Izinkan notifikasi aplikasi dan kanal Pemantauan lokasi agar pengiriman dapat berjalan." };
  if (s.permission === "unavailable") return { label: "Status izin belum tersedia", nada: "warning", rincian: "Ponsel belum dapat membaca izin pemantauan. Buka aplikasi mobile untuk memeriksa kembali." };
  if (s.permission !== "granted_always" && s.permission !== "granted_while_in_use") {
    return { label: "Status izin belum diketahui", nada: "warning", rincian: "Buka aplikasi mobile agar status izin diperbarui." };
  }

  const selamaBekerja = pengaturan.mode === "while_working";
  if (selamaBekerja && p.currentAttendance === undefined) {
    return { label: "Status presensi belum tersedia", nada: "neutral", rincian: "Muat ulang untuk memastikan ada presensi yang masih terbuka hari ini." };
  }
  if (selamaBekerja && !p.currentAttendance) {
    return { label: "Di luar presensi", nada: "neutral", rincian: "Tidak ada presensi terbuka hari ini; lokasi dikirim hanya selama check-in." };
  }

  const ambangMenit = Math.max(30, pengaturan.intervalMinutes * 3);
  const ambang = ambangMenit * 60_000;
  const checkIn = selamaBekerja ? waktu(p.currentAttendance?.checkIn) : null;
  if (selamaBekerja && checkIn === null) {
    return { label: "Status presensi belum tersedia", nada: "neutral", rincian: "Waktu check-in belum dapat dibaca. Muat ulang status presensi." };
  }
  // Pengaturan terbaru mencakup pengaktifan ulang. Beri waktu ponsel membaca
  // konfigurasi, menyetujui pemantauan, atau mulai mengirim sesudah check-in.
  const mulai = Math.max(waktu(pengaturan.updatedAt) ?? 0, waktu(s.consentAt) ?? 0, checkIn ?? 0);
  const terakhir = waktu(p.last?.recordedAt);
  if ((terakhir === null || terakhir < mulai) && mulai <= sekarang && sekarang - mulai <= ambang) {
    return {
      label: "Menunggu lokasi",
      nada: "neutral",
      rincian: checkIn !== null && mulai === checkIn
        ? `Check-in baru tercatat; menunggu lokasi pada presensi ini (batas ${ambangMenit} menit).`
        : `Pemantauan baru disiapkan; menunggu lokasi terbaru (batas ${ambangMenit} menit).`,
    };
  }

  const bantuan = "Lokasi terbaru belum diterima; periksa koneksi dan pengaturan ponsel."
    + (s.permission === "granted_while_in_use" ? " Buka aplikasi, izinkan lokasi sepanjang waktu, dan periksa pembatasan baterai." : " Buka aplikasi mobile untuk memeriksa kembali.");
  if (!p.last) return { label: "Belum pernah mengirim", nada: "warning", rincian: bantuan };
  if (terakhir === null || terakhir > sekarang + 5 * 60_000) {
    return { label: "Waktu lokasi belum dapat dinilai", nada: "warning", rincian: "Periksa waktu ponsel dan muat ulang lokasi terbaru." };
  }
  // receivedAt tidak dipakai: unggahan antrean lama bukan bukti lokasi masih baru.
  if (sekarang - terakhir > ambang) return { label: "Tidak melapor", nada: "warning", rincian: bantuan };
  return {
    label: "Aktif",
    nada: "success",
    rincian: `Lokasi terbaru masih dalam batas ${ambangMenit} menit.`
      + (s.permission === "granted_while_in_use" ? " Izin lokasi hanya saat aplikasi digunakan." : ""),
  };
};
