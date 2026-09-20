// src/services/whatsapp/ingest.ts
//
// Satu-satunya jalan masuk pesan WhatsApp ke arsip.
//
// Sebelumnya logika ini tinggal di dalam handler webhook, jadi sumber pesan
// dan aturan penyimpanan menyatu. Begitu Baileys ikut memasukkan pesan —
// lewat WebSocket, bukan HTTP — kedua sumber harus melewati aturan yang
// PERSIS sama: ruang lingkup nomor perusahaan, enkripsi isi, dan penolakan
// pesan ganda. Menduplikasi aturan itu di dua tempat berarti cepat atau
// lambat yang satu berubah tanpa yang lain, dan pengecualian ruang lingkup
// adalah hal terakhir yang boleh diam-diam melenceng.
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { generateULID } from '../../utils/generateULID';
import { normalizePhoneNumber, resolveScope } from '../../utils/whatsappRules';
import { encryptField, buildSearchTokens } from '../../utils/fieldCrypto';
import { beriTahuKejadianSesi } from '../notification/sessionPush';
import { env } from '../../config/env';
import type { SESSION_EVENT_TYPES } from '../../utils/whatsappRules';

export type TipePesan = 'text' | 'image' | 'document' | 'audio' | 'video';

/** Bentuk baku pesan, apa pun sumbernya. */
export interface PesanMasuk {
  externalMessageId: string;
  from: string;
  to: string;
  body: string;
  type: TipePesan;
  timestamp: Date;
}

export type HasilIngest =
  | { status: 'tersimpan'; conversationId: string; direction: string }
  | { status: 'duplikat'; conversationId: string | null }
  | { status: 'ditolak'; alasan: string };

export interface OpsiIngest {
  /**
   * Akun pemilik sesi yang menerima pesan ini (jalur Baileys). Dengan ini
   * pesan dikaitkan ke akun yang benar walau kedua pihak sama-sama nomor
   * terdaftar — dua karyawan yang saling berkirim pesan masing-masing
   * mendapat salinan di arsipnya sendiri. Jalur webhook tidak tahu akun
   * mana yang menerima, jadi memakai penentuan lingkup lewat nomor.
   */
  accountId?: string;
}

type Lingkup = { contactNumber: string; direction: 'incoming' | 'outgoing' };

export const ingestMessage = async (pesan: PesanMasuk, opsi: OpsiIngest = {}): Promise<HasilIngest> => {
  // Nomor pribadi yang belum selesai dipindai belum punya nomor; tidak ada
  // pesan yang bisa dikaitkan padanya.
  const akunAktif = await prisma.whatsAppAccount.findMany({
    where: { isActive: true, phoneNumber: { not: null } },
    select: { id: true, phoneNumber: true, assignedEmployeeId: true },
  });

  let akun: (typeof akunAktif)[number];
  let lingkup: Lingkup;

  if (opsi.accountId) {
    const milik = akunAktif.find((a) => a.id === opsi.accountId);
    if (!milik?.phoneNumber) return { status: 'ditolak', alasan: 'akun_tidak_aktif' };
    const from = normalizePhoneNumber(pesan.from);
    const to = normalizePhoneNumber(pesan.to);
    if (!from || !to) return { status: 'ditolak', alasan: 'invalid_number' };
    if (from !== milik.phoneNumber && to !== milik.phoneNumber) {
      return { status: 'ditolak', alasan: 'not_company_number' };
    }
    akun = milik;
    lingkup =
      from === milik.phoneNumber
        ? { contactNumber: to, direction: 'outgoing' }
        : { contactNumber: from, direction: 'incoming' };
  } else {
    const hasil = resolveScope({
      from: pesan.from,
      to: pesan.to,
      companyNumbers: new Set(akunAktif.map((a) => a.phoneNumber!)),
    });
    if (!hasil.allowed) return { status: 'ditolak', alasan: hasil.rejection! };
    akun = akunAktif.find((a) => a.phoneNumber === hasil.companyNumber)!;
    lingkup = { contactNumber: hasil.contactNumber!, direction: hasil.direction! };
  }

  try {
    const percakapan = await prisma.whatsAppConversation.create({
      data: {
        id: generateULID(),
        accountId: akun.id,
        externalMessageId: pesan.externalMessageId,
        senderWhatsappNumber: normalizePhoneNumber(pesan.from)!,
        receiverWhatsappNumber: normalizePhoneNumber(pesan.to)!,
        contactNumber: lingkup.contactNumber,
        // Isi pesan tidak pernah menyentuh database dalam bentuk terbuka.
        // Token pencarian dihitung dari teks asli SEBELUM dienkripsi —
        // sesudahnya sudah tidak ada kata yang bisa diambil.
        messageBody: encryptField(pesan.body),
        searchTokens: buildSearchTokens(pesan.body),
        messageType: pesan.type,
        timestamp: pesan.timestamp,
        direction: lingkup.direction,
        // Disalin saat pesan masuk: nomor bisa berpindah tangan, dan arsip
        // lama harus tetap menunjuk pemegang yang benar saat itu.
        employeeId: akun.assignedEmployeeId,
      },
      select: { id: true, direction: true },
    });

    return { status: 'tersimpan', conversationId: percakapan.id, direction: percakapan.direction };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const ada = await prisma.whatsAppConversation.findUnique({
        where: { accountId_externalMessageId: { accountId: akun.id, externalMessageId: pesan.externalMessageId } },
        select: { id: true },
      });
      return { status: 'duplikat', conversationId: ada?.id ?? null };
    }
    throw error;
  }
};

// --- Kejadian sesi ---

export type TipeKejadianSesi = (typeof SESSION_EVENT_TYPES)[number];

export interface KejadianSesi {
  /** Jalur Baileys menyebut akunnya langsung: nomor pribadi belum tentu sudah diketahui. */
  accountId?: string;
  /** Jalur webhook hanya tahu nomornya. */
  phoneNumber?: string;
  status: TipeKejadianSesi;
  occurredAt?: Date;
  note?: string;
}

export type HasilKejadianSesi =
  | { status: 'tercatat' }
  | { status: 'nomor_tidak_valid' }
  | { status: 'nomor_tidak_terdaftar' };

const statusSesiDari = (kejadian: TipeKejadianSesi) =>
  kejadian === 'connected' ? 'connected' : kejadian === 'disconnected' ? 'disconnected' : 'pending_scan';

export const applySessionEvent = async (kejadian: KejadianSesi): Promise<HasilKejadianSesi> => {
  let akun: { id: string } | null = null;
  if (kejadian.accountId) {
    akun = await prisma.whatsAppAccount.findUnique({ where: { id: kejadian.accountId }, select: { id: true } });
  } else {
    const nomor = normalizePhoneNumber(kejadian.phoneNumber ?? '');
    if (!nomor) return { status: 'nomor_tidak_valid' };
    akun = await prisma.whatsAppAccount.findUnique({ where: { phoneNumber: nomor }, select: { id: true } });
  }
  if (!akun) return { status: 'nomor_tidak_terdaftar' };

  const waktu = kejadian.occurredAt ?? new Date();
  const idKejadian = generateULID();

  await prisma.$transaction([
    prisma.whatsAppSessionEvent.create({
      data: {
        id: idKejadian,
        accountId: akun.id,
        eventType: kejadian.status,
        occurredAt: waktu,
        note: kejadian.note,
      },
    }),
    prisma.whatsAppAccount.update({
      where: { id: akun.id },
      data: {
        sessionStatus: statusSesiDari(kejadian.status),
        ...(kejadian.status === 'connected' ? { lastConnectedAt: waktu } : {}),
        ...(kejadian.status === 'disconnected' ? { lastDisconnectedAt: waktu } : {}),
      },
    }),
  ]);

  // Pemberitahuan ke ponsel pemegang nomor. Sengaja DI LUAR transaksi:
  // kegagalan mengirim notifikasi tidak boleh membatalkan pencatatan
  // kejadiannya, dan kejadian yang gagal diberitahukan tetap terambil lewat
  // GET /whatsapp/session-events?unnotifiedOnly=true.
  try {
    await beriTahuKejadianSesi(idKejadian);
  } catch (error) {
    if (env.NODE_ENV !== 'test') console.warn('[push] gagal memberi tahu kejadian sesi:', error);
  }

  return { status: 'tercatat' };
};

// --- Nomor yang dipelajari saat QR tertaut ---

export type HasilKlaimNomor =
  | { status: 'terpasang' | 'tetap' }
  | { status: 'konflik'; label: string }
  | { status: 'salah_nomor'; diharapkan: string };

/**
 * Mencatat nomor yang benar-benar tertaut, seperti dilaporkan WhatsApp saat
 * sesi terbuka.
 *
 * Nomor pribadi: nomornya memang baru diketahui di titik ini, jadi dipasang
 * (atau diperbarui bila karyawan ganti nomor). Nomor perusahaan: nomornya
 * sudah ditetapkan HR, jadi ponsel lain yang memindai QR-nya ditolak —
 * kalau tidak, "CS Outlet Kemang" diam-diam bisa berisi arsip nomor pribadi
 * siapa pun. Nomor yang sudah dipakai akun lain juga ditolak: satu nomor
 * hanya boleh punya satu arsip.
 */
export const claimPhoneNumber = async (accountId: string, nomorMentah: string): Promise<HasilKlaimNomor> => {
  const nomor = normalizePhoneNumber(nomorMentah);
  if (!nomor) return { status: 'tetap' };

  const akun = await prisma.whatsAppAccount.findUnique({
    where: { id: accountId },
    select: { phoneNumber: true, kind: true },
  });
  if (!akun) return { status: 'tetap' };
  if (akun.phoneNumber === nomor) return { status: 'tetap' };
  if (akun.kind === 'company' && akun.phoneNumber) return { status: 'salah_nomor', diharapkan: akun.phoneNumber };

  const lain = await prisma.whatsAppAccount.findUnique({
    where: { phoneNumber: nomor },
    select: { id: true, label: true },
  });
  if (lain && lain.id !== accountId) return { status: 'konflik', label: lain.label };

  await prisma.whatsAppAccount.update({ where: { id: accountId }, data: { phoneNumber: nomor } });
  return { status: 'terpasang' };
};
