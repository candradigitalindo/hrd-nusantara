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

/** Berkas yang menyertai pesan, sesudah diunduh pemegang soket. */
export interface BerkasMedia {
  /** Relatif terhadap UPLOAD_DIR; null bila berkasnya tidak jadi tersimpan. */
  path: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  fileName: string | null;
  status: 'tersimpan' | 'terlalu_besar' | 'gagal' | 'tidak_didukung';
}

/** Keterangan grup asal pesan. */
export interface AsalGrup {
  /** JID penuh, mis. "12036301234567890@g.us". */
  jid: string;
  /** Angka dari JID; dipakai sebagai contactNumber supaya satu grup satu utas. */
  kunci: string;
  /**
   * Peserta yang mengirim; null bila WhatsApp tidak menyebutkannya. Berisi
   * digit LID bila nomor aslinya belum diketahui (sama dengan participantLid).
   */
  participantNumber: string | null;
  /** Digit LID peserta, bila WhatsApp menyebutnya lewat LID. */
  participantLid?: string | null;
  nama?: string | null;
}

/** Bentuk baku pesan, apa pun sumbernya. */
export interface PesanMasuk {
  externalMessageId: string;
  from: string;
  to: string;
  body: string;
  type: TipePesan;
  timestamp: Date;
  /** Keterangan berkas dari pesannya; berkas fisiknya menyusul lewat `media`. */
  media?: { mimeType: string | null; fileName: string | null };
  grup?: AsalGrup;
  /**
   * Digit LID lawan bicara chat pribadi yang dialamatkan lewat LID. Bila
   * nomor aslinya belum diketahui, from/to berisi digit yang sama.
   */
  contactLid?: string | null;
  /** Nama profil WhatsApp pengirim (pesan masuk saja). */
  senderName?: string | null;
}

export type HasilIngest =
  | { status: 'tersimpan'; conversationId: string; direction: string }
  | { status: 'duplikat'; conversationId: string | null; ditambal?: boolean }
  | { status: 'ditolak'; alasan: string };

export interface OpsiIngest {
  /** Berkas media yang sudah diunduh, siap dicatat bersama pesannya. */
  berkas?: BerkasMedia;
  /**
   * Akun pemilik sesi yang menerima pesan ini (jalur Baileys). Dengan ini
   * pesan dikaitkan ke akun yang benar walau kedua pihak sama-sama nomor
   * terdaftar — dua karyawan yang saling berkirim pesan masing-masing
   * mendapat salinan di arsipnya sendiri. Jalur webhook tidak tahu akun
   * mana yang menerima, jadi memakai penentuan lingkup lewat nomor.
   */
  accountId?: string;
  /**
   * Pesan ini sudah diketahui ada di arsip akun ini (riwayat yang ditarik
   * ulang): langsung ditambal, tanpa mencoba menyimpannya lagi.
   */
  sudahAda?: boolean;
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

    if (pesan.grup) {
      // Ruang lingkup pesan grup ditentukan oleh keanggotaan, bukan oleh
      // nomor lawan bicara: yang menerimanya adalah nomor perusahaan yang
      // sesinya sedang terhubung, dan itu sudah pasti dari accountId.
      akun = milik;
      lingkup = {
        contactNumber: pesan.grup.kunci,
        direction: from === milik.phoneNumber ? 'outgoing' : 'incoming',
      };
    } else {
      if (from !== milik.phoneNumber && to !== milik.phoneNumber) {
        return { status: 'ditolak', alasan: 'not_company_number' };
      }
      akun = milik;
      lingkup =
        from === milik.phoneNumber
          ? { contactNumber: to, direction: 'outgoing' }
          : { contactNumber: from, direction: 'incoming' };
    }
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

  if (opsi.sudahAda) return tambalDuplikat(akun.id, pesan, lingkup);

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
        groupJid: pesan.grup?.jid ?? null,
        groupName: pesan.grup?.nama ?? null,
        participantNumber: pesan.grup?.participantNumber ?? null,
        participantLid: pesan.grup?.participantLid ?? null,
        contactLid: pesan.grup ? null : (pesan.contactLid ?? null),
        senderName: pesan.senderName ?? null,
        mediaPath: opsi.berkas?.path ?? null,
        mediaMimeType: opsi.berkas?.mimeType ?? pesan.media?.mimeType ?? null,
        mediaSizeBytes: opsi.berkas?.sizeBytes ?? null,
        mediaFileName: opsi.berkas?.fileName ?? pesan.media?.fileName ?? null,
        mediaStatus: opsi.berkas?.status ?? null,
        // Disalin saat pesan masuk: nomor bisa berpindah tangan, dan arsip
        // lama harus tetap menunjuk pemegang yang benar saat itu.
        employeeId: akun.assignedEmployeeId,
      },
      select: { id: true, direction: true },
    });

    return { status: 'tersimpan', conversationId: percakapan.id, direction: percakapan.direction };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return tambalDuplikat(akun.id, pesan, lingkup);
    }
    throw error;
  }
};

/**
 * Pesan yang sudah ada di arsip: yang masih kosong atau masih LID ditambal
 * dari salinan yang baru datang.
 *
 * Pesan riwayat yang ditarik ulang membawa pengirim grup yang dulu tidak
 * tercatat, dan pesan yang dulu hanya dikenal lewat LID kini bisa membawa
 * nomor aslinya. Tanpa ini, "Tarik riwayat" tidak pernah memperbaiki
 * apa pun: semua yang datang dianggap duplikat lalu dibuang. Yang sudah
 * terisi nomor asli tidak pernah ditimpa.
 */
const tambalDuplikat = async (accountId: string, pesan: PesanMasuk, lingkup: Lingkup): Promise<HasilIngest> => {
  const ada = await prisma.whatsAppConversation.findUnique({
    where: { accountId_externalMessageId: { accountId, externalMessageId: pesan.externalMessageId } },
    select: {
      id: true,
      contactNumber: true,
      contactLid: true,
      groupJid: true,
      groupName: true,
      participantNumber: true,
      participantLid: true,
      senderName: true,
      senderWhatsappNumber: true,
      receiverWhatsappNumber: true,
      direction: true,
    },
  });
  if (!ada) return { status: 'duplikat', conversationId: null };

  const data: Prisma.WhatsAppConversationUpdateInput = {};

  if (pesan.grup) {
    if (ada.groupJid === pesan.grup.jid) {
      const nomor = pesan.grup.participantNumber;
      const lid = pesan.grup.participantLid ?? null;
      const nomorAsli = nomor && nomor !== lid ? nomor : null;
      const lamaMasihLid = !!ada.participantNumber && ada.participantNumber === (ada.participantLid ?? lid);
      if (nomor && (ada.participantNumber === null || (nomorAsli && lamaMasihLid && ada.participantNumber !== nomorAsli))) {
        data.participantNumber = nomor;
        // Pesan masuk tanpa peserta dulu dicatat atas nama grupnya.
        if (
          ada.direction === 'incoming' &&
          (ada.senderWhatsappNumber === ada.contactNumber || ada.senderWhatsappNumber === ada.participantNumber)
        ) {
          data.senderWhatsappNumber = nomor;
        }
      }
      if (lid && !ada.participantLid) data.participantLid = lid;
    }
    if (!ada.groupName && pesan.grup.nama) data.groupName = pesan.grup.nama;
  } else if (!ada.groupJid) {
    const lid = pesan.contactLid ?? null;
    const nomorAsli = lid && lingkup.contactNumber !== lid ? lingkup.contactNumber : null;
    if (lid && nomorAsli && ada.contactNumber === lid) {
      data.contactNumber = nomorAsli;
      if (ada.senderWhatsappNumber === lid) data.senderWhatsappNumber = nomorAsli;
      if (ada.receiverWhatsappNumber === lid) data.receiverWhatsappNumber = nomorAsli;
    }
    if (lid && !ada.contactLid && (ada.contactNumber === lid || ada.contactNumber === nomorAsli)) data.contactLid = lid;
  }

  if (!ada.senderName && pesan.senderName) data.senderName = pesan.senderName;

  if (Object.keys(data).length === 0) return { status: 'duplikat', conversationId: ada.id };
  await prisma.whatsAppConversation.update({ where: { id: ada.id }, data });
  return { status: 'duplikat', conversationId: ada.id, ditambal: true };
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
  /**
   * Jangan langsung memberi tahu pemegang nomor. Dipakai untuk putus yang
   * sedang disambung ulang sendiri: pemberitahuannya baru layak dikirim bila
   * beberapa menit kemudian masih belum tersambung (lihat session.ts).
   */
  tundaPemberitahuan?: boolean;
}

export type HasilKejadianSesi =
  | { status: 'tercatat'; eventId: string }
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
  if (!kejadian.tundaPemberitahuan) {
    try {
      await beriTahuKejadianSesi(idKejadian);
    } catch (error) {
      if (env.NODE_ENV !== 'test') console.warn('[push] gagal memberi tahu kejadian sesi:', error);
    }
  }

  return { status: 'tercatat', eventId: idKejadian };
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

  // Nomor WhatsApp adalah username login. Karyawan yang nomornya belum
  // diisi HR otomatis terisi dari nomor yang benar-benar dipindainya —
  // asal nomor itu belum dipakai karyawan lain.
  if (akun.kind === 'personal') {
    const pemegang = await prisma.whatsAppAccount.findUnique({ where: { id: accountId }, select: { assignedEmployeeId: true } });
    if (pemegang?.assignedEmployeeId) {
      const karyawan = await prisma.employee.findUnique({ where: { id: pemegang.assignedEmployeeId }, select: { phoneNumber: true } });
      const dipakaiLain = await prisma.employee.findUnique({ where: { phoneNumber: nomor }, select: { id: true } });
      if (karyawan && !karyawan.phoneNumber && !dipakaiLain) {
        await prisma.employee.update({ where: { id: pemegang.assignedEmployeeId }, data: { phoneNumber: nomor } });
      }
    }
  }
  return { status: 'terpasang' };
};
