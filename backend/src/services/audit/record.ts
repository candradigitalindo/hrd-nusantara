// src/services/audit/record.ts
//
// Menulis jejak audit.
//
// Aturan penting: isi permintaan TIDAK pernah disalin ke sini apa adanya.
// Body memuat kata sandi, isi percakapan WhatsApp, dan foto wajah — menyalin
// semuanya ke tabel audit berarti membuat salinan kedua dari data yang justru
// paling dijaga, di tabel yang tidak terenkripsi dan tidak bisa dihapus.
// Controller yang ingin mencatat rincian harus memilih sendiri apa yang aman.
import { prisma } from '../../lib/prisma';
import { generateULID } from '../../utils/generateULID';
import { env } from '../../config/env';

export interface RincianAudit {
  /// Menimpa pola rute, untuk aksi yang punya nama bermakna.
  action?: string;
  entity?: string;
  entityId?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface MasukanAudit extends RincianAudit {
  action: string;
  method: string;
  path: string;
  statusCode: number;
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/// Jaring pengaman lapis kedua. Rincian audit ditulis controller, dan
/// controller ditulis manusia yang suatu saat akan menempelkan objek utuh
/// ke metadata tanpa sadar isinya apa.
const KUNCI_RAHASIA = /password|sandi|token|secret|rahasia|privatekey|private_key|messagebody|embedding|image|foto|signature/i;

export const DIRAHASIAKAN = '[dirahasiakan]';

export const redaksiMetadata = (nilai: unknown, kedalaman = 0): unknown => {
  // Metadata audit seharusnya dangkal. Batas ini mencegah objek Prisma yang
  // tak sengaja ikut terbawa menyeret seluruh grafnya ke dalam tabel audit.
  if (kedalaman > 4) return DIRAHASIAKAN;

  if (Array.isArray(nilai)) return nilai.map((v) => redaksiMetadata(v, kedalaman + 1));

  if (nilai !== null && typeof nilai === 'object') {
    const hasil: Record<string, unknown> = {};
    for (const [kunci, isi] of Object.entries(nilai as Record<string, unknown>)) {
      hasil[kunci] = KUNCI_RAHASIA.test(kunci) ? DIRAHASIAKAN : redaksiMetadata(isi, kedalaman + 1);
    }
    return hasil;
  }

  return nilai;
};

const tertunda = new Set<Promise<void>>();

/** Menunggu penulisan audit yang sedang berjalan selesai. */
export const tungguAuditSelesai = async () => {
  while (tertunda.size > 0) await Promise.all([...tertunda]);
};

export const catatAudit = async (masukan: MasukanAudit): Promise<void> => {
  await prisma.auditLog.create({
    data: {
      id: generateULID(),
      actorId: masukan.actorId ?? null,
      actorEmail: masukan.actorEmail ?? null,
      actorRole: masukan.actorRole ?? null,
      action: masukan.action,
      entity: masukan.entity ?? null,
      entityId: masukan.entityId ?? null,
      method: masukan.method,
      path: masukan.path,
      statusCode: masukan.statusCode,
      summary: masukan.summary ?? null,
      metadata:
        masukan.metadata === undefined
          ? undefined
          : (redaksiMetadata(masukan.metadata) as object),
      ipAddress: masukan.ipAddress ?? null,
      userAgent: masukan.userAgent ?? null,
    },
  });
};

/**
 * Menulis di latar, tanpa menahan respons.
 *
 * Dipanggil setelah respons terkirim, jadi kegagalannya tidak punya siapa-siapa
 * untuk dilapori kecuali log — tapi harus berisik, karena lubang di jejak audit
 * yang tidak diketahui lebih buruk daripada tidak punya jejak audit sama sekali.
 */
export const catatAuditDiLatar = (masukan: MasukanAudit): void => {
  const kerja = catatAudit(masukan)
    .catch((error) => {
      if (env.NODE_ENV !== 'test') {
        console.error('[audit] GAGAL mencatat jejak audit:', masukan.action, error);
      }
    })
    .finally(() => {
      tertunda.delete(kerja);
    });
  tertunda.add(kerja);
};
