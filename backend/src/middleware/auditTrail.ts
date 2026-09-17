// src/middleware/auditTrail.ts
//
// Mencatat setiap permintaan yang MENGUBAH sesuatu, tanpa menuntut tiap
// controller mengingat untuk memanggil apa pun. Controller yang butuh
// rincian lebih tinggal mengisi res.locals.audit.
import { Request, Response, NextFunction } from 'express';
import { catatAuditDiLatar, type RincianAudit } from '../services/audit/record';

/// Webhook Belly's/Baileys ditembak setiap pesan masuk. Mencatatnya di sini
/// akan menenggelamkan jejak perbuatan manusia di bawah lalu lintas mesin,
/// padahal pesannya sendiri sudah terekam di tabel percakapan.
const JALUR_DILEWATI = [/^\/api\/webhook(\/|$)/];

const METODE_MENGUBAH = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Pola rute yang cocok, misalnya "/api/whatsapp/accounts/:id/connect".
 *
 * Dipakai polanya, bukan path mentah, supaya aksi yang sama bisa
 * dikelompokkan walau id-nya berbeda-beda. Path sebenarnya tetap disimpan
 * di kolom tersendiri.
 */
const polaRute = (req: Request): string => {
  const rute = (req as Request & { route?: { path?: string } }).route;
  if (rute?.path) return `${req.method} ${req.baseUrl}${rute.path}`;
  // Tidak ada rute yang cocok — 404, atau ditolak middleware sebelum dispatch.
  return `${req.method} ${req.path}`;
};

export const auditTrail = (req: Request, res: Response, next: NextFunction) => {
  res.on('finish', () => {
    if (JALUR_DILEWATI.some((p) => p.test(req.path))) return;

    const rincian = res.locals.audit as RincianAudit | undefined;

    // GET hanya dicatat kalau controller meminta secara eksplisit — mencatat
    // semua pembacaan akan membuat tabelnya tumbuh jauh lebih cepat daripada
    // data yang diauditnya, dan menenggelamkan yang penting.
    if (!METODE_MENGUBAH.has(req.method) && !rincian) return;

    const aktor = req.user;

    catatAuditDiLatar({
      action: rincian?.action ?? polaRute(req),
      entity: rincian?.entity,
      // Id dari parameter rute dipakai sebagai bawaan: hampir semua aksi di
      // sini menyasar satu record, dan tanpa ini jejaknya tidak menunjuk
      // record mana yang tersentuh.
      entityId: rincian?.entityId ?? (typeof req.params?.id === 'string' ? req.params.id : undefined),
      summary: rincian?.summary,
      metadata: rincian?.metadata,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      statusCode: res.statusCode,
      // Identitas disalin sebagai cuplikan: peran bisa berubah dan karyawan
      // bisa dihapus, sedangkan jejaknya harus tetap terbaca bertahun-tahun.
      actorId: aktor?.id ?? null,
      actorEmail: aktor?.email ?? null,
      actorRole: aktor?.role ?? null,
      ipAddress: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
  });

  next();
};
