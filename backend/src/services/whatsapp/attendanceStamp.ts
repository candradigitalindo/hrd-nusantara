// src/services/whatsapp/attendanceStamp.ts
//
// Foto absensi ber-stempel: setelah karyawan check-in/out, WhatsApp
// miliknya sendiri mengirim fotonya (dengan pita berisi nama, jam, lokasi,
// metode) ke grup yang ia pilih — pengganti "stamp photo" yang biasa
// dikirim manual ke grup outlet.
//
// NIK dan koordinat GPS sengaja tidak dicantumkan, baik di pita maupun di
// keterangan: grup outlet berisi banyak orang dan fotonya bisa diteruskan ke
// mana saja. Nama karyawan, nama lokasi kerja, dan alamatnya sudah cukup
// untuk mengenali siapa absen di mana; koordinat tetap tersimpan di presensi.
//
// Pengiriman berjalan DI LUAR siklus request: presensi sudah tercatat dan
// dijawab 201 lebih dulu. WhatsApp yang lambat atau putus tidak boleh
// membuat karyawan gagal absen; hasilnya dicatat di Attendance.stampStatus.
import sharp from 'sharp';
import { DateTime } from 'luxon';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { sendImageToGroup, GalatSesiWhatsApp } from './session';

export interface DataStempel {
  jenis: 'masuk' | 'pulang';
  nama: string;
  waktu: Date;
  /** Nama lokasi kerja. */
  lokasi: string | null;
  /** Alamat lokasi kerja (diisi HR di halaman Lokasi Kerja), bukan posisi GPS ponsel. */
  alamat?: string | null;
  metode: string;
  wajahTerverifikasi: boolean;
  status: string;
  menitTerlambat?: number;
  menitKerja?: number;
  /** Presensi offline: kapan server menerimanya (waktu di atas = saat diambil). */
  diterimaServer?: Date;
}

const LABEL_METODE: Record<string, string> = { gps: 'GPS', qr: 'QR', face: 'Wajah' };
const LABEL_STATUS: Record<string, string> = { present: 'Hadir', late: 'Terlambat', absent: 'Absen', no_checkout: 'Lupa check-out' };

export const formatWaktuStempel = (waktu: Date) => {
  const t = DateTime.fromJSDate(waktu).setZone(env.APP_TIMEZONE).setLocale('id');
  return `${t.toFormat('ccc, d LLL yyyy HH:mm')} ${t.toFormat('ZZZZ')}`;
};

const durasi = (menit: number) => {
  const jam = Math.floor(menit / 60);
  const sisa = menit % 60;
  return jam === 0 ? `${sisa} mnt` : sisa === 0 ? `${jam} jam` : `${jam} jam ${sisa} mnt`;
};

/**
 * Lebar satu baris alamat di pita, dalam karakter. Pita selebar 1080 px dengan
 * huruf 30 px memuat sekitar 56 karakter; diberi sisa supaya huruf lebar
 * (M, W, angka) tidak terpotong di tepi gambar.
 */
export const LEBAR_BARIS_ALAMAT = 52;
const BARIS_ALAMAT_MAKS = 2;

/**
 * Memecah alamat per kata menjadi paling banyak dua baris. Teks SVG tidak
 * membungkus sendiri, jadi alamat panjang tanpa ini terpotong di luar gambar;
 * sisanya diganti elipsis (alamat lengkap tetap ada di keterangan pesan).
 */
export const pecahAlamat = (alamat: string): string[] => {
  const baris: string[] = [];
  let kini = '';
  for (const kata of alamat.trim().split(/\s+/).filter(Boolean)) {
    const calon = kini ? `${kini} ${kata}` : kata;
    if (calon.length <= LEBAR_BARIS_ALAMAT) {
      kini = calon;
      continue;
    }
    if (kini) baris.push(kini);
    kini = kata.slice(0, LEBAR_BARIS_ALAMAT);
  }
  if (kini) baris.push(kini);
  if (baris.length <= BARIS_ALAMAT_MAKS) return baris;

  const terpotong = baris.slice(0, BARIS_ALAMAT_MAKS);
  terpotong[BARIS_ALAMAT_MAKS - 1] = `${terpotong[BARIS_ALAMAT_MAKS - 1].slice(0, LEBAR_BARIS_ALAMAT - 1).trimEnd()}…`;
  return terpotong;
};

const barisMetode = (d: DataStempel) =>
  `${LABEL_METODE[d.metode] ?? d.metode}${d.wajahTerverifikasi ? ' · wajah terverifikasi' : ''} · ${LABEL_STATUS[d.status] ?? d.status}${
    d.menitTerlambat ? ` ${d.menitTerlambat} mnt` : ''
  }${d.menitKerja !== undefined ? ` · kerja ${durasi(d.menitKerja)}` : ''}`;

const alamatDari = (d: DataStempel) => d.alamat?.trim() || null;

/** Baris teks pada pita stempel (urutan = urutan tampil). */
export const barisStempel = (d: DataStempel): string[] => {
  const alamat = alamatDari(d);
  return [
    `${d.jenis === 'masuk' ? 'CHECK-IN' : 'CHECK-OUT'} · ${d.nama}`,
    `${formatWaktuStempel(d.waktu)}${d.diterimaServer ? ' · offline' : ''}`,
    d.lokasi ?? 'Lokasi tidak tercatat',
    ...(alamat ? pecahAlamat(alamat) : []),
    barisMetode(d),
  ];
};

/** Keterangan pesan WhatsApp (caption) — isinya sama dengan pita, plus penanda aplikasi. */
export const teksKeterangan = (d: DataStempel): string =>
  [
    `${d.jenis === 'masuk' ? '✅ CHECK-IN' : '🏁 CHECK-OUT'} — ${d.nama}`,
    `🕒 ${formatWaktuStempel(d.waktu)}`,
    `📍 ${d.lokasi ?? 'Lokasi tidak tercatat'}`,
    ...(alamatDari(d) ? [`🏢 ${alamatDari(d)}`] : []),
    `📱 ${barisMetode(d)}`,
    ...(d.diterimaServer ? [`📶 Diambil offline, terkirim ${formatWaktuStempel(d.diterimaServer)}`] : []),
    'Dikirim otomatis oleh HRD Nusantara',
  ].join('\n');

const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);

export const LEBAR_STEMPEL = 1080;

/**
 * Menyusun gambar: foto (diputar sesuai EXIF, diperkecil ke lebar 1080) dengan
 * pita gelap semi-transparan berisi teks di bagian bawah. Tanpa foto, dibuat
 * latar polos supaya pesan tetap berupa stempel yang bisa dibaca.
 */
export const buatGambarStempel = async (foto: Buffer | null, d: DataStempel): Promise<Buffer> => {
  const dasar = foto
    ? await sharp(foto).rotate().resize({ width: LEBAR_STEMPEL }).jpeg().toBuffer()
    : await sharp({ create: { width: LEBAR_STEMPEL, height: 720, channels: 3, background: '#1f2937' } }).jpeg().toBuffer();
  const tinggi = (await sharp(dasar).metadata()).height ?? 720;

  const baris = barisStempel(d);
  const tinggiPita = 36 + baris.length * 46;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${LEBAR_STEMPEL}" height="${tinggiPita}">
  <rect width="100%" height="100%" fill="rgba(0,0,0,0.62)"/>
  ${baris
    .map(
      (t, i) =>
        `<text x="32" y="${54 + i * 46}" font-family="DejaVu Sans, Helvetica, Arial, sans-serif" font-size="${i === 0 ? 38 : 30}" font-weight="${i === 0 ? 'bold' : 'normal'}" fill="#ffffff">${escapeXml(t)}</text>`
    )
    .join('')}
</svg>`;

  return sharp(dasar)
    .composite([{ input: Buffer.from(svg), top: Math.max(0, tinggi - tinggiPita), left: 0 }])
    .jpeg({ quality: 82 })
    .toBuffer();
};

const tertunda = new Set<Promise<void>>();

/** Menunggu semua pengiriman stempel yang sedang berjalan (untuk test dan shutdown). */
export const tungguStempelSelesai = async () => {
  while (tertunda.size > 0) await Promise.all([...tertunda]);
};

export interface PermintaanStempel {
  attendanceId: string;
  employeeId: string;
  foto: Buffer | null;
  data: DataStempel;
}

const catatHasil = (attendanceId: string, status: 'sent' | 'failed' | 'skipped', note?: string) =>
  prisma.attendance.update({
    where: { id: attendanceId },
    data: { stampStatus: status, stampSentAt: status === 'sent' ? new Date() : null, stampNote: note?.slice(0, 300) ?? null },
  });

/** Mengirim stempel sekarang; hasilnya dicatat di baris presensi. */
export const kirimStempelAbsensi = async (p: PermintaanStempel): Promise<'sent' | 'failed' | 'skipped'> => {
  const akun = await prisma.whatsAppAccount.findFirst({
    where: { kind: 'personal', assignedEmployeeId: p.employeeId, isActive: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true, attendanceGroupJid: true, attendanceGroupName: true },
  });
  if (!akun?.attendanceGroupJid) {
    await catatHasil(p.attendanceId, 'skipped', akun ? 'Grup tujuan belum dipilih' : 'WhatsApp belum ditautkan');
    return 'skipped';
  }

  try {
    const gambar = await buatGambarStempel(p.foto, p.data);
    await sendImageToGroup(akun.id, akun.attendanceGroupJid, gambar, teksKeterangan(p.data));
    await catatHasil(p.attendanceId, 'sent', `Ke grup ${akun.attendanceGroupName ?? akun.attendanceGroupJid}`);
    return 'sent';
  } catch (error) {
    const pesan = error instanceof GalatSesiWhatsApp ? error.message : `Gagal mengirim: ${(error as Error).message}`;
    await catatHasil(p.attendanceId, 'failed', pesan);
    if (env.NODE_ENV !== 'test') console.warn('[whatsapp] stempel absensi gagal:', pesan);
    return 'failed';
  }
};

/** Menjadwalkan pengiriman di latar; tidak pernah melempar ke pemanggil. */
export const jadwalkanStempel = (p: PermintaanStempel) => {
  const kerja = kirimStempelAbsensi(p)
    .then(() => undefined)
    .catch((error) => {
      if (env.NODE_ENV !== 'test') console.warn('[whatsapp] stempel absensi:', error);
    })
    .finally(() => {
      tertunda.delete(kerja);
    });
  tertunda.add(kerja);
};
