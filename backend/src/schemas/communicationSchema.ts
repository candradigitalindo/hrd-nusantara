// src/schemas/communicationSchema.ts
import { z } from 'zod';
import { ulidField, dateField, paginationFields } from './common';
import { ANNOUNCEMENT_PRIORITIES, QUESTION_TYPES } from '../utils/communicationRules';

export const ANNOUNCEMENT_STATUSES = ['draft', 'published', 'archived'] as const;
export const SURVEY_STATUSES = ['draft', 'published', 'closed'] as const;
export const ROOM_TYPES = ['general', 'department', 'team'] as const;

// --- Pengumuman ---

export const createAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(20_000),
    priority: z.enum(ANNOUNCEMENT_PRIORITIES).default('normal'),
    targetDepartmentId: ulidField.nullable().optional(),
    requiresAcknowledgment: z.boolean().default(false),
    expiresAt: dateField.nullable().optional(),
  })
  .strict();

export const updateAnnouncementSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).max(20_000).optional(),
    priority: z.enum(ANNOUNCEMENT_PRIORITIES).optional(),
    targetDepartmentId: ulidField.nullable().optional(),
    requiresAcknowledgment: z.boolean().optional(),
    expiresAt: dateField.nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Tidak ada field yang diubah' });

export const changeAnnouncementStatusSchema = z
  .object({ status: z.enum(['published', 'archived']) })
  .strict();

export const listAnnouncementQuerySchema = z.object({
  ...paginationFields,
  status: z.enum(ANNOUNCEMENT_STATUSES).optional(),
  priority: z.enum(ANNOUNCEMENT_PRIORITIES).optional(),
  unreadOnly: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
});

export const markReadSchema = z
  .object({ acknowledge: z.boolean().default(false) })
  .strict();

// --- Survei ---

const questionFields = {
  code: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Z0-9_]+$/, 'Kode hanya boleh huruf kapital, angka, dan garis bawah'),
  text: z.string().trim().min(1).max(500),
  type: z.enum(QUESTION_TYPES),
  options: z.array(z.string().trim().min(1).max(150)).min(2).max(20).optional(),
  minScale: z.coerce.number().int().min(0).max(10).optional(),
  maxScale: z.coerce.number().int().min(1).max(10).optional(),
  isRequired: z.boolean().default(true),
};

export const createSurveySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    isAnonymous: z.boolean().default(true),
    targetDepartmentId: ulidField.nullable().optional(),
    startDate: dateField,
    endDate: dateField,
    questions: z.array(z.object(questionFields).strict()).min(1).max(50),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.endDate.getTime() <= d.startDate.getTime()) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Tanggal selesai harus setelah tanggal mulai',
      });
    }

    const kode = d.questions.map((q) => q.code);
    if (new Set(kode).size !== kode.length) {
      ctx.addIssue({ code: 'custom', path: ['questions'], message: 'Ada kode pertanyaan ganda' });
    }

    d.questions.forEach((q, i) => {
      if (q.type === 'choice' && (!q.options || q.options.length < 2)) {
        ctx.addIssue({
          code: 'custom',
          path: ['questions', i, 'options'],
          message: 'Pertanyaan pilihan membutuhkan minimal dua opsi',
        });
      }
      if (q.type === 'scale' && q.minScale !== undefined && q.maxScale !== undefined) {
        if (q.maxScale <= q.minScale) {
          ctx.addIssue({
            code: 'custom',
            path: ['questions', i, 'maxScale'],
            message: 'maxScale harus lebih besar dari minScale',
          });
        }
      }
    });
  });

export const changeSurveyStatusSchema = z
  .object({ status: z.enum(['published', 'closed']) })
  .strict();

export const submitSurveySchema = z
  .object({
    answers: z
      .array(
        z
          .object({
            questionId: ulidField,
            scaleValue: z.coerce.number().int().min(0).max(100).nullable().optional(),
            textValue: z.string().trim().max(5000).nullable().optional(),
            choiceValue: z.string().trim().max(150).nullable().optional(),
          })
          .strict()
      )
      .min(1)
      .max(50),
  })
  .strict();

export const listSurveyQuerySchema = z.object({
  ...paginationFields,
  status: z.enum(SURVEY_STATUSES).optional(),
});

// --- Ruang obrolan ---

export const createRoomSchema = z
  .object({
    name: z.string().trim().min(1).max(150),
    description: z.string().trim().max(500).optional(),
    type: z.enum(ROOM_TYPES).default('general'),
    isPrivate: z.boolean().default(false),
    memberIds: z.array(ulidField).max(500).optional(),
  })
  .strict();

export const addMemberSchema = z
  .object({
    employeeId: ulidField,
    role: z.enum(['member', 'moderator']).default('member'),
  })
  .strict();

export const sendMessageSchema = z
  .object({ message: z.string().trim().min(1).max(5000) })
  .strict();

export const listMessageQuerySchema = z.object({
  ...paginationFields,
});

export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;
export type ChangeAnnouncementStatusInput = z.infer<typeof changeAnnouncementStatusSchema>;
export type ListAnnouncementQuery = z.infer<typeof listAnnouncementQuerySchema>;
export type MarkReadInput = z.infer<typeof markReadSchema>;
export type CreateSurveyInput = z.infer<typeof createSurveySchema>;
export type ChangeSurveyStatusInput = z.infer<typeof changeSurveyStatusSchema>;
export type SubmitSurveyInput = z.infer<typeof submitSurveySchema>;
export type ListSurveyQuery = z.infer<typeof listSurveyQuerySchema>;
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ListMessageQuery = z.infer<typeof listMessageQuerySchema>;
