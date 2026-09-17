// src/routes/communicationRoutes.ts
import express from 'express';
import { Role } from '@prisma/client';
import {
  createAnnouncement,
  updateAnnouncement,
  changeAnnouncementStatus,
  getAllAnnouncements,
  markAnnouncementRead,
  getAnnouncementReadReport,
  createSurvey,
  changeSurveyStatus,
  getAllSurveys,
  submitSurvey,
  getSurveyResults,
  createRoom,
  getMyRooms,
  addRoomMember,
  sendMessage,
  getMessages,
  deleteMessage,
} from '../controllers/communicationController';
import { authenticateToken, requireRole, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { idParamSchema } from '../schemas/common';
import {
  createAnnouncementSchema,
  updateAnnouncementSchema,
  changeAnnouncementStatusSchema,
  listAnnouncementQuerySchema,
  markReadSchema,
  createSurveySchema,
  changeSurveyStatusSchema,
  submitSurveySchema,
  listSurveyQuerySchema,
  createRoomSchema,
  addMemberSchema,
  sendMessageSchema,
  listMessageQuerySchema,
} from '../schemas/communicationSchema';

const router = express.Router();

router.use(authenticateToken);

const HR = [Role.SUPER_ADMIN, Role.HR_ADMIN] as const;

// --- Pengumuman ---
// Semua karyawan melihat papan informasi; penyaringan sasaran di controller.
router.get(
  '/announcements',
  validate(listAnnouncementQuerySchema, 'query'),
  asyncHandler(getAllAnnouncements)
);
router.post(
  '/announcements',
  requireRole(...HR),
  validate(createAnnouncementSchema),
  asyncHandler(createAnnouncement)
);
router.put(
  '/announcements/:id',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(updateAnnouncementSchema),
  asyncHandler(updateAnnouncement)
);
router.patch(
  '/announcements/:id/status',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(changeAnnouncementStatusSchema),
  asyncHandler(changeAnnouncementStatus)
);
router.post(
  '/announcements/:id/read',
  validate(idParamSchema, 'params'),
  validate(markReadSchema),
  asyncHandler(markAnnouncementRead)
);
router.get(
  '/announcements/:id/reads',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  asyncHandler(getAnnouncementReadReport)
);

// --- Survei ---
router.get('/surveys', validate(listSurveyQuerySchema, 'query'), asyncHandler(getAllSurveys));
router.post('/surveys', requireRole(...HR), validate(createSurveySchema), asyncHandler(createSurvey));
router.patch(
  '/surveys/:id/status',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  validate(changeSurveyStatusSchema),
  asyncHandler(changeSurveyStatus)
);
router.post(
  '/surveys/:id/submit',
  validate(idParamSchema, 'params'),
  validate(submitSurveySchema),
  asyncHandler(submitSurvey)
);
router.get(
  '/surveys/:id/results',
  requireRole(...HR),
  validate(idParamSchema, 'params'),
  asyncHandler(getSurveyResults)
);

// --- Ruang obrolan ---
router.get('/chat/rooms', asyncHandler(getMyRooms));
router.post('/chat/rooms', validate(createRoomSchema), asyncHandler(createRoom));
router.post(
  '/chat/rooms/:id/members',
  validate(idParamSchema, 'params'),
  validate(addMemberSchema),
  asyncHandler(addRoomMember)
);
router.get(
  '/chat/rooms/:id/messages',
  validate(idParamSchema, 'params'),
  validate(listMessageQuerySchema, 'query'),
  asyncHandler(getMessages)
);
router.post(
  '/chat/rooms/:id/messages',
  validate(idParamSchema, 'params'),
  validate(sendMessageSchema),
  asyncHandler(sendMessage)
);
router.delete(
  '/chat/messages/:id',
  validate(idParamSchema, 'params'),
  asyncHandler(deleteMessage)
);

export default router;
