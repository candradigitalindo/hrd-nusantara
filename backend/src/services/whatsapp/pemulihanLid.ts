// src/services/whatsapp/pemulihanLid.ts
//
// Memperbaiki arsip lama yang menyimpan LID seolah nomor telepon.
//
// Sebelum LID dikenali, digit "2147…@lid" tersimpan di contactNumber,
// participantNumber, dan sender/receiverWhatsappNumber. Akibatnya satu orang
// terpecah menjadi dua utas (nomor dan LID-nya), dan LID tampil sebagai
// "+2147…". Langkah-langkahnya:
//
//   a. salin pemetaan yang sudah ada di store Baileys (semua akun) ke
//      WhatsAppLidMap, sebelum logout berikutnya menghapusnya;
//   b. ganti LID yang kini diketahui nomornya dengan nomor asli, LID-nya
//      disimpan di contactLid / participantLid;
//   c. tandai LID yang belum diketahui nomornya (contactLid = contactNumber),
//      supaya tidak pernah ditampilkan sebagai nomor;
//   d. gabungkan kontak LID-saja yang kini diketahui nomornya.
//
// Semua langkah aman diulang: baris yang sudah benar tidak tersentuh lagi.
// Dijalankan di latar saat boot dan tiap jam (pemetaan baru terus
// dipelajari dari pesan live), dan bisa dijalankan manual:
// npm run whatsapp:pulihkan-lid
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { salinPemetaanTersimpan, type HasilSalinPemetaan } from './authStore';
import { gabungkanBaris } from './kontak';

/** Baris per perintah UPDATE: kunci baris dan WAL tetap kecil walau arsipnya ratusan ribu. */
const UKURAN_BATCH = 5000;

export interface HasilPemulihanLid {
  pemetaan: HasilSalinPemetaan;
  /** Pesan pribadi yang LID-nya diganti nomor asli. */
  pribadiDiselesaikan: number;
  /** Pesan grup yang pengirim ber-LID-nya diganti nomor asli. */
  grupDiselesaikan: number;
  /** Pesan pribadi yang ditandai masih LID (nomor belum diketahui). */
  pribadiDitandai: number;
  /** Pesan grup yang pengirimnya ditandai masih LID. */
  grupDitandai: number;
  /** Kontak LID-saja yang digabung ke kontak bernomor. */
  kontakDigabung: number;
  /** Kontak LID-saja yang kini diberi nomornya. */
  kontakDiberiNomor: number;
}

const ulangSampaiHabis = async (satuPutaran: () => Promise<number>): Promise<number> => {
  let total = 0;
  for (;;) {
    const n = await satuPutaran();
    total += n;
    if (n < UKURAN_BATCH) return total;
  }
};

/** b. Chat pribadi: contactNumber yang ternyata LID yang sudah dikenal. */
export const selesaikanPribadi = () =>
  ulangSampaiHabis(
    () => prisma.$executeRaw`
      UPDATE "WhatsAppConversation" AS c
      SET "contactLid" = m."lid",
          "contactNumber" = m."pn",
          "senderWhatsappNumber" = CASE WHEN c."senderWhatsappNumber" = m."lid" THEN m."pn" ELSE c."senderWhatsappNumber" END,
          "receiverWhatsappNumber" = CASE WHEN c."receiverWhatsappNumber" = m."lid" THEN m."pn" ELSE c."receiverWhatsappNumber" END
      FROM "WhatsAppLidMap" AS m
      WHERE m."lid" = c."contactNumber"
        AND c."id" IN (
          SELECT c2."id"
          FROM "WhatsAppConversation" AS c2
          JOIN "WhatsAppLidMap" AS m2 ON m2."lid" = c2."contactNumber"
          WHERE c2."groupJid" IS NULL
            AND (c2."contactLid" IS NULL OR c2."contactLid" = c2."contactNumber")
          LIMIT ${UKURAN_BATCH}::int
        )
    `
  );

/** b. Grup: pengirim yang ternyata LID yang sudah dikenal. */
export const selesaikanGrup = () =>
  ulangSampaiHabis(
    () => prisma.$executeRaw`
      UPDATE "WhatsAppConversation" AS c
      SET "participantLid" = m."lid",
          "participantNumber" = m."pn",
          "senderWhatsappNumber" = CASE WHEN c."senderWhatsappNumber" = m."lid" THEN m."pn" ELSE c."senderWhatsappNumber" END
      FROM "WhatsAppLidMap" AS m
      WHERE m."lid" = c."participantNumber"
        AND c."id" IN (
          SELECT c2."id"
          FROM "WhatsAppConversation" AS c2
          JOIN "WhatsAppLidMap" AS m2 ON m2."lid" = c2."participantNumber"
          WHERE c2."groupJid" IS NOT NULL
            AND (c2."participantLid" IS NULL OR c2."participantLid" = c2."participantNumber")
          LIMIT ${UKURAN_BATCH}::int
        )
    `
  );

// Sama dengan tampakLid() di baileysMessage.ts: 15 digit atau lebih, atau
// 14 digit yang tidak diawali 62. Nomor Indonesia paling panjang 14 digit.

/** c. Chat pribadi yang lawannya masih LID tak dikenal. */
export const tandaiPribadi = () =>
  ulangSampaiHabis(
    () => prisma.$executeRaw`
      UPDATE "WhatsAppConversation"
      SET "contactLid" = "contactNumber"
      WHERE "id" IN (
        SELECT "id" FROM "WhatsAppConversation"
        WHERE "groupJid" IS NULL
          AND "contactLid" IS NULL
          AND "contactNumber" ~ '^[0-9]+$'
          AND (length("contactNumber") >= 15 OR (length("contactNumber") = 14 AND "contactNumber" NOT LIKE '62%'))
        LIMIT ${UKURAN_BATCH}::int
      )
    `
  );

/** c. Pengirim grup yang masih LID tak dikenal. */
export const tandaiGrup = () =>
  ulangSampaiHabis(
    () => prisma.$executeRaw`
      UPDATE "WhatsAppConversation"
      SET "participantLid" = "participantNumber"
      WHERE "id" IN (
        SELECT "id" FROM "WhatsAppConversation"
        WHERE "groupJid" IS NOT NULL
          AND "participantLid" IS NULL
          AND "participantNumber" ~ '^[0-9]+$'
          AND (length("participantNumber") >= 15 OR (length("participantNumber") = 14 AND "participantNumber" NOT LIKE '62%'))
        LIMIT ${UKURAN_BATCH}::int
      )
    `
  );

const pilihKontak = { id: true, number: true, lid: true, savedName: true, pushName: true, verifiedName: true, updatedAt: true } as const;

/** d. Kontak LID-saja yang kini diketahui nomornya. */
export const gabungkanKontakLid = async (): Promise<{ digabung: number; diberiNomor: number }> => {
  const kandidat = await prisma.$queryRaw<{ id: string; accountId: string; pn: string }[]>`
    SELECT k."id", k."accountId", m."pn"
    FROM "WhatsAppContact" AS k
    JOIN "WhatsAppLidMap" AS m ON m."lid" = k."lid"
    WHERE k."number" IS NULL
  `;

  let digabung = 0;
  let diberiNomor = 0;
  for (const k of kandidat) {
    await prisma.$transaction(async (tx) => {
      const lidSaja = await tx.whatsAppContact.findUnique({ where: { id: k.id }, select: pilihKontak });
      if (!lidSaja || lidSaja.number) return;
      const bernomor = await tx.whatsAppContact.findUnique({
        where: { accountId_number: { accountId: k.accountId, number: k.pn } },
        select: pilihKontak,
      });
      if (bernomor) {
        await gabungkanBaris(tx, bernomor, lidSaja);
        digabung += 1;
      } else {
        await tx.whatsAppContact.update({ where: { id: k.id }, data: { number: k.pn } });
        diberiNomor += 1;
      }
    });
  }
  return { digabung, diberiNomor };
};

/** Waktu salinan pemetaan terakhir yang berhasil; salinan berikutnya hanya membaca yang berubah sejak itu. */
let salinTerakhir: Date | null = null;
/** Selisih jam aplikasi dan database: updatedAt store ditulis dengan NOW() milik database. */
const TOLERANSI_JAM_MS = 5 * 60 * 1000;

/**
 * Menjalankan seluruh pemulihan. Mengembalikan jumlah baris per langkah.
 *
 * @param opsi.penuh salin SELURUH pemetaan store, bukan hanya yang berubah
 *   sejak salinan terakhir di proses ini.
 */
export const pulihkanLid = async (opsi: { penuh?: boolean } = {}): Promise<HasilPemulihanLid> => {
  const mulai = new Date();
  const sejak = !opsi.penuh && salinTerakhir ? new Date(salinTerakhir.getTime() - TOLERANSI_JAM_MS) : undefined;
  const pemetaan = await salinPemetaanTersimpan({ sejak });
  salinTerakhir = mulai;

  // Diselesaikan dulu, baru ditandai: yang ditandai hanya LID yang benar-benar
  // belum dikenal. Yang ditandai pun akan diselesaikan langkah b begitu
  // pemetaannya muncul (contactLid = contactNumber).
  const pribadiDiselesaikan = await selesaikanPribadi();
  const grupDiselesaikan = await selesaikanGrup();
  const pribadiDitandai = await tandaiPribadi();
  const grupDitandai = await tandaiGrup();
  const kontak = await gabungkanKontakLid();

  return {
    pemetaan,
    pribadiDiselesaikan,
    grupDiselesaikan,
    pribadiDitandai,
    grupDitandai,
    kontakDigabung: kontak.digabung,
    kontakDiberiNomor: kontak.diberiNomor,
  };
};

export const ringkasPemulihan = (h: HasilPemulihanLid) =>
  `pemetaan: ${h.pemetaan.dibaca} baris store dibaca, ${h.pemetaan.tersimpan} disimpan, ` +
  `${h.pemetaan.konflik} konflik, ${h.pemetaan.dilewati} dilewati; ` +
  `pesan pribadi diselesaikan ${h.pribadiDiselesaikan}, ditandai LID ${h.pribadiDitandai}; ` +
  `pesan grup diselesaikan ${h.grupDiselesaikan}, ditandai LID ${h.grupDitandai}; ` +
  `kontak digabung ${h.kontakDigabung}, diberi nomor ${h.kontakDiberiNomor}`;

// --- Penjadwal ---

const JEDA_AWAL_MS = 15 * 1000;
const SELANG_MS = 60 * 60 * 1000;

let timerAwal: NodeJS.Timeout | null = null;
let timerBerkala: NodeJS.Timeout | null = null;
let sedangBerjalan = false;

const jalankanDiLatar = async (penuh: boolean) => {
  // Putaran yang masih berjalan tidak ditumpuk.
  if (sedangBerjalan) return;
  sedangBerjalan = true;
  try {
    const hasil = await pulihkanLid({ penuh });
    console.log(`[whatsapp-lid] pemulihan selesai — ${ringkasPemulihan(hasil)}`);
  } catch (error) {
    console.warn('[whatsapp-lid] pemulihan gagal:', error);
  } finally {
    sedangBerjalan = false;
  }
};

/**
 * Menjalankan pemulihan di latar: sekali sesaat setelah server siap (tidak
 * menahan health check), lalu tiap jam. Tidak berjalan di test.
 */
export const mulaiPemulihanLid = () => {
  if (env.NODE_ENV === 'test' || timerBerkala) return;
  timerAwal = setTimeout(() => {
    timerAwal = null;
    void jalankanDiLatar(true);
  }, JEDA_AWAL_MS);
  timerAwal.unref();
  timerBerkala = setInterval(() => void jalankanDiLatar(false), SELANG_MS);
  timerBerkala.unref();
};

export const hentikanPemulihanLid = () => {
  if (timerAwal) clearTimeout(timerAwal);
  if (timerBerkala) clearInterval(timerBerkala);
  timerAwal = null;
  timerBerkala = null;
};
