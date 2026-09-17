// src/routes/deviceRoutes.ts
import express from 'express';
import { registerDevice, unregisterDevice, getMyDevices } from '../controllers/deviceController';
import { authenticateToken, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { registerDeviceSchema, unregisterDeviceSchema } from '../schemas/deviceSchema';

const router = express.Router();

router.use(authenticateToken);

// Tanpa requireRole: semua karyawan memakai aplikasi mobile, dan tiap
// perangkat hanya bisa menyentuh miliknya sendiri.
router.get('/devices', asyncHandler(getMyDevices));
router.post('/devices', validate(registerDeviceSchema), asyncHandler(registerDevice));
router.delete('/devices', validate(unregisterDeviceSchema), asyncHandler(unregisterDevice));

export default router;
