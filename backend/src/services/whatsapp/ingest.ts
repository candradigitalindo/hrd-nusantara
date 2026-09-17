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

export const ingestMessage = async (pesan: PesanMasuk): Promise<HasilIngest> => {
  const akunAktif = await prisma.whatsAppAccount.findMany({
    where: { isActive: true },
    select: { id: true, phoneNumber: true, assignedEmployeeId: true },
  });

  const lingkup = resolveScope({
    from: pesan.from,
    to: pesan.to,
    companyNumbers: new Set(akunAktif.map((a) => a.phoneNumber)),
  });

  if (!lingkup.allowed) {
    return { status: 'ditolak', alasan: lingkup.rejection! };
  }

  const akun = akunAktif.find((a) => a.phoneNumber === lingkup.companyNumber)!;

  try {
    const percakapan = await prisma.whatsAppConversation.create({
      data: {
        id: generateULID(),
        accountId: akun.id,
        externalMessageId: pesan.externalMessageId,
        senderWhatsappNumber: normalizePhoneNumber(pesan.from)!,
        receiverWhatsappNumber: normalizePhoneNumber(pesan.to)!,
        contactNumber: lingkup.contactNumber!,
        // Isi pesan tidak pernah menyentuh database dalam bentuk terbuka.
        // Token pencarian dihitung dari teks asli SEBELUM dienkripsi —
        // sesudahnya sudah tidak ada kata yang bisa diambil.
        messageBody: encryptField(pesan.body),
        searchTokens: buildSearchTokens(pesan.body),
        messageType: pesan.type,
        timestamp: pesan.timestamp,
        direction: lingkup.direction!,
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
        where: { externalMessageId: pesan.externalMessageId },
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
  phoneNumber: string;
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
  const nomor = normalizePhoneNumber(kejadian.phoneNumber);
  if (!nomor) return { status: 'nomor_tidak_valid' };

  const akun = await prisma.whatsAppAccount.findUnique({ where: { phoneNumber: nomor } });
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
