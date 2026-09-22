// src/routes/roleRoutes.ts
import express from 'express';
import {
  getPermissionCatalog,
  getAllRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
} from '../controllers/roleController';
import { authenticateToken, requirePermission, asyncHandler } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createRoleSchema, updateRoleSchema, roleIdParamSchema } from '../schemas/roleSchema';

const router = express.Router();

router.use(authenticateToken);

// Daftar peran dan katalog izin juga dibutuhkan oleh yang mengelola karyawan
// (memilih peran saat menambah karyawan), bukan hanya pengelola peran.
router.get('/roles/permissions', requirePermission('peran.lihat', 'karyawan.buat', 'karyawan.ubah'), asyncHandler(getPermissionCatalog));
router.get('/roles', requirePermission('peran.lihat', 'karyawan.buat', 'karyawan.ubah'), asyncHandler(getAllRoles));
router.get(
  '/roles/:id',
  requirePermission('peran.lihat', 'karyawan.buat', 'karyawan.ubah'),
  validate(roleIdParamSchema, 'params'),
  asyncHandler(getRoleById)
);

router.post('/roles', requirePermission('peran.buat'), validate(createRoleSchema), asyncHandler(createRole));
router.put(
  '/roles/:id',
  requirePermission('peran.ubah'),
  validate(roleIdParamSchema, 'params'),
  validate(updateRoleSchema),
  asyncHandler(updateRole)
);
router.delete(
  '/roles/:id',
  requirePermission('peran.hapus'),
  validate(roleIdParamSchema, 'params'),
  asyncHandler(deleteRole)
);

export default router;
