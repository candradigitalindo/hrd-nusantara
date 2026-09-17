// src/app.ts
// Aplikasi Express tanpa app.listen(), supaya test bisa memakainya lewat
// supertest tanpa benar-benar membuka port.
import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { auditTrail } from './middleware/auditTrail';
import { prisma } from './lib/prisma';
import authRoutes from './routes/authRoutes';
import employeeRoutes from './routes/employeeRoutes';
import workLocationRoutes from './routes/workLocationRoutes';
import shiftRoutes from './routes/shiftRoutes';
import attendanceRoutes from './routes/attendanceRoutes';
import faceEnrollmentRoutes from './routes/faceEnrollmentRoutes';
import leaveRoutes from './routes/leaveRoutes';
import payrollRoutes from './routes/payrollRoutes';
import recruitmentRoutes from './routes/recruitmentRoutes';
import performanceRoutes from './routes/performanceRoutes';
import trainingRoutes from './routes/trainingRoutes';
import competencyRoutes from './routes/competencyRoutes';
import communicationRoutes from './routes/communicationRoutes';
import whatsappRoutes from './routes/whatsappRoutes';
import deviceRoutes from './routes/deviceRoutes';
import auditRoutes from './routes/auditRoutes';
import reportRoutes from './routes/reportRoutes';
import webhookRoutes from './routes/webhookRoutes';

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());

  app.use(
    cors({
      origin(origin, callback) {
        // Tanpa Origin = aplikasi mobile Flutter, Postman, atau server-to-server.
        // Browser selalu mengirim Origin, jadi allowlist tetap berlaku untuk web.
        if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} tidak diizinkan oleh kebijakan CORS`));
      },
      credentials: true,
    })
  );

  if (env.NODE_ENV !== 'test') {
    app.use(morgan(env.isProduction ? 'combined' : 'dev'));
  }

  app.use(
    express.json({
      limit: '10mb',
      // Body mentah disimpan untuk verifikasi tanda tangan webhook: HMAC
      // dihitung atas byte yang benar-benar dikirim, bukan atas hasil parse
      // lalu serialisasi ulang yang bisa berbeda susunannya.
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      // Test menembak banyak request berturut-turut; rate limit akan
      // membuatnya gagal karena alasan yang tidak sedang diuji.
      skip: () => env.NODE_ENV === 'test',
      message: { error: 'Terlalu banyak permintaan. Coba lagi nanti.' },
    })
  );

  app.get('/health', async (_req: Request, res: Response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', database: 'connected' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'disconnected' });
    }
  });

  // Webhook dipasang sebelum router lain: router-router di bawah memanggil
  // router.use(authenticateToken) dan sama-sama dipasang di '/api', sehingga
  // permintaan mesin akan tertolak sebagai "token tidak ada" bila lewat sana.
  // Sebelum semua rute: pencatatannya berjalan saat respons selesai, jadi
  // harus sudah terpasang sebelum rute mana pun menangani permintaan.
  app.use('/api', auditTrail);

  app.use('/api/webhook', webhookRoutes);

  app.use('/api/auth', authRoutes);
  app.use('/api/employees', employeeRoutes);
  app.use('/api/work-locations', workLocationRoutes);
  app.use('/api/shifts', shiftRoutes);
  app.use('/api/attendance', attendanceRoutes);
  // Rute pendaftaran wajah memakai dua prefiks (/employees/:id/... dan
  // /face-enrollments/:id), jadi dipasang di akar /api.
  app.use('/api', faceEnrollmentRoutes);
  // Modul cuti memakai beberapa prefiks (/leaves, /leave-types, /holidays,
  // /leave-balances), jadi dipasang di akar /api.
  app.use('/api', leaveRoutes);
  // Modul penggajian juga memakai beberapa prefiks (/payrolls, /payroll-runs,
  // /salary-components), jadi dipasang di akar /api.
  app.use('/api', payrollRoutes);
  app.use('/api', recruitmentRoutes);
  app.use('/api', performanceRoutes);
  app.use('/api', trainingRoutes);
  app.use('/api', competencyRoutes);
  app.use('/api', communicationRoutes);
  app.use('/api', whatsappRoutes);
  app.use('/api', deviceRoutes);
  app.use('/api', auditRoutes);
  app.use('/api', reportRoutes);

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Endpoint tidak ditemukan' });
  });

  // Error handler harus punya 4 parameter agar dikenali Express.
  app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);

    if (env.NODE_ENV !== 'test') console.error(err);

    // Di produksi pesan error asli tidak dikirim ke klien — isinya bisa
    // membocorkan struktur database atau path internal.
    res.status(500).json({
      error: env.isProduction ? 'Terjadi kesalahan pada server' : err.message,
    });
  });

  return app;
};
