import { Request, RequestHandler, Response } from 'express';
import { Prisma } from '@prisma/client';

export type CbtScope = 'recruitment' | 'development';
export const canAccessRecruitment = (req: Request) =>
  ['rekrutmen.lihat', 'rekrutmen.buat', 'rekrutmen.ubah', 'rekrutmen.hapus'].some((p) => req.user?.permissions.includes(p));

/** Scope is a server-side boundary, including requests made directly by ID. */
export const scopeCbt = (fallback: CbtScope = 'development'): RequestHandler => (req, res, next) => {
  const query = req.query.scope;
  const body = req.body?.scope;
  if ((query !== undefined && query !== 'recruitment' && query !== 'development') ||
      (body !== undefined && body !== 'recruitment' && body !== 'development') ||
      (query !== undefined && body !== undefined && query !== body)) {
    return res.status(400).json({ error: 'Lingkup tes tidak sah atau tidak konsisten' });
  }
  const scope = query ?? body ?? fallback;
  if (scope === 'recruitment' && !canAccessRecruitment(req)) {
    return res.status(403).json({ error: 'Akses rekrutmen diperlukan untuk tes seleksi pelamar' });
  }
  res.locals.cbtScope = scope;
  next();
};

export const currentScope = (res: Response): CbtScope => res.locals.cbtScope ?? 'development';
export const scopeAudience = (res: Response) => currentScope(res) === 'recruitment' ? 'pelamar' : 'karyawan';
export const audienceScope = (audience: string) => audience === 'pelamar' ? 'recruitment' : audience === 'karyawan' ? 'development' : 'shared';
export const packageWhere = (res: Response): Prisma.CbtTestWhereInput => ({ audience: { in: [scopeAudience(res), 'keduanya'] } });
export const questionWhere = (res: Response): Prisma.CbtQuestionWhereInput => ({ scope: { in: [currentScope(res), 'shared'] } });
export const assignmentWhere = (res: Response): Prisma.CbtAssignmentWhereInput =>
  currentScope(res) === 'recruitment' ? { candidateId: { not: null } } : { employeeId: { not: null } };

export const allowResource = (req: Request, res: Response, scope: string, mutation = false): boolean => {
  if (scope !== 'shared' && scope !== currentScope(res)) {
    res.status(404).json({ error: 'Data tes tidak ditemukan dalam lingkup ini' });
    return false;
  }
  // Legacy shared questions/packages may already be used by applicants.
  if ((scope === 'recruitment' || (scope === 'shared' && mutation)) && !canAccessRecruitment(req)) {
    res.status(403).json({ error: 'Akses rekrutmen diperlukan untuk mengubah materi tes bersama' });
    return false;
  }
  return true;
};
