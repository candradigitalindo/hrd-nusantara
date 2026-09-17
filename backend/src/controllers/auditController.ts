// src/controllers/auditController.ts
import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import type { ListAuditQuery } from '../schemas/auditSchema';

/**
 * Membaca jejak audit.
 *
 * Tidak ada endpoint untuk mengubah atau menghapus, dan itu disengaja:
 * tabelnya append-only, ditegakkan trigger database. Menyediakan jalur
 * penghapusan di sini sama dengan membatalkan gunanya.
 */
export const getAuditLogs = async (req: Request, res: Response) => {
  const query = req.query as unknown as ListAuditQuery;

  const where: Prisma.AuditLogWhereInput = {
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.action ? { action: { contains: query.action, mode: 'insensitive' } } : {}),
    ...(query.entity ? { entity: query.entity } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.onlyFailed ? { statusCode: { gte: 400 } } : {}),
  };

  if (query.startDate || query.endDate) {
    where.createdAt = {
      ...(query.startDate ? { gte: query.startDate } : {}),
      ...(query.endDate ? { lt: new Date(query.endDate.getTime() + 24 * 60 * 60 * 1000) } : {}),
    };
  }

  const [total, data] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);

  res.json({
    data,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit) || 1,
    },
  });
};
