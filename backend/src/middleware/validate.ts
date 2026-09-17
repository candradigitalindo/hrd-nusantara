// src/middleware/validate.ts
import { RequestHandler } from 'express';
import { ZodType } from 'zod';

type Source = 'body' | 'query' | 'params';

/**
 * Memvalidasi request dan MENGGANTI req[source] dengan hasil parse skema.
 *
 * Ini yang menutup celah mass assignment: controller tidak lagi menerima
 * req.body mentah, hanya field yang memang dideklarasikan di skema. Tanpa ini
 * klien bisa menyelipkan field seperti `status` atau `role` ke Prisma.
 */
export const validate =
  <T>(schema: ZodType<T>, source: Source = 'body'): RequestHandler =>
  (req, res, next) => {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      return res.status(400).json({
        error: 'Validasi gagal',
        details: result.error.issues.map((issue) => ({
          field: issue.path.join('.') || source,
          message: issue.message,
        })),
      });
    }

    (req as unknown as Record<Source, unknown>)[source] = result.data;
    next();
  };
