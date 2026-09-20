// src/services/notification/sessionPush.ts
//
// Memberi tahu pemegang nomor bahwa sesi WhatsApp-nya perlu ditangani.
//
// Ini bagian dari alur yang diminta dokumen fitur: sesi terputus -> karyawan
// diberi tahu -> karyawan scan ulang. Tanpa pemberitahuan, nomor perusahaan
// bisa berhenti terpantau berhari-hari tanpa ada yang sadar.
import { prisma } from '../../lib/prisma';
import { kirimKeKaryawan } from './push';

/// 'connected' sengaja tidak diberitahukan. Sesi yang berhasil tersambung
/// tidak menuntut tindakan apa pun, dan notifikasi yang tidak bisa
/// ditindaklanjuti melatih orang untuk mengabaikan notifikasi berikutnya.
const PERLU_DIBERITAHU = new Set(['disconnected', 'scan_required']);

const judulUntuk = (eventType: string) =>
  eventType === 'scan_required' ? 'WhatsApp perlu discan ulang' : 'Sesi WhatsApp terputus';

const isiUntuk = (eventType: string, label: string, kind: string) => {
  if (kind === 'personal') {
    return eventType === 'scan_required'
      ? 'WhatsApp Anda perlu dipindai ulang di aplikasi agar pesan kembali tersinkron ke sistem.'
      : 'Sesi WhatsApp Anda terputus. Sistem sedang mencoba menyambungkan kembali.';
  }
  return eventType === 'scan_required'
    ? `Nomor ${label} perlu Anda scan ulang agar pesan kembali tersinkron.`
    : `Sesi nomor ${label} terputus. Sistem sedang mencoba menyambungkan kembali.`;
};

/**
 * @returns true bila kejadian benar-benar terkirim ke setidaknya satu perangkat.
 */
export const beriTahuKejadianSesi = async (eventId: string): Promise<boolean> => {
  const kejadian = await prisma.whatsAppSessionEvent.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      eventType: true,
      notifiedAt: true,
      account: { select: { label: true, kind: true, phoneNumber: true, assignedEmployeeId: true } },
    },
  });

  if (!kejadian || kejadian.notifiedAt) return false;
  if (!PERLU_DIBERITAHU.has(kejadian.eventType)) return false;

  // Nomor yang belum dipegang siapa pun tidak punya tujuan notifikasi.
  // Kejadiannya tetap tercatat dan tetap terlihat HR lewat API.
  const employeeId = kejadian.account.assignedEmployeeId;
  if (!employeeId) return false;

  const hasil = await kirimKeKaryawan(employeeId, {
    title: judulUntuk(kejadian.eventType),
    // Isi percakapan TIDAK pernah masuk ke notifikasi: muatan push melewati
    // server Google dan tampil di layar terkunci.
    body: isiUntuk(kejadian.eventType, kejadian.account.label, kejadian.account.kind),
    data: { jenis: 'whatsapp_session', eventType: kejadian.eventType, eventId: kejadian.id },
  });

  if (hasil.terkirim === 0) return false;

  // Ditandai hanya setelah benar-benar terkirim, supaya aplikasi mobile yang
  // menarik daftar "belum diberitahu" tetap menemukannya kalau push gagal.
  await prisma.whatsAppSessionEvent.update({
    where: { id: eventId },
    data: { notifiedAt: new Date() },
  });

  return true;
};
