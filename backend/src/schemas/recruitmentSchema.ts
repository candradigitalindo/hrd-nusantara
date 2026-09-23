// src/schemas/recruitmentSchema.ts
import { z } from 'zod';
import { ulidField, dateField, dateOnlyField, paginationFields } from './common';
import { CANDIDATE_STAGES } from '../utils/recruitmentStages';

export const JOB_POSTING_STATUSES = ['draft', 'open', 'closed', 'filled', 'cancelled'] as const;
export const EMPLOYMENT_TYPES = ['fulltime', 'contract', 'parttime', 'internship', 'daily'] as const;
export const INTERVIEW_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;
export const INTERVIEW_RESULTS = ['pass', 'fail', 'hold'] as const;

const uang = z.coerce.number().min(0).max(1_000_000_000_000);

// --- Lowongan ---

export const createJobPostingSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    /// Boleh datang sebagai teks polos atau sebagai *Html dari editor;
    /// controller menolak bila keduanya kosong.
    description: z.string().trim().min(1).max(5000).optional(),
    /// HTML dari editor berformat; teks polosnya diturunkan server dari sini.
    descriptionHtml: z.string().max(200_000).nullable().optional(),
    requirements: z.string().trim().min(1).max(5000).optional(),
    requirementsHtml: z.string().max(200_000).nullable().optional(),
    positionId: ulidField,
    openings: z.coerce.number().int().min(1).max(500).default(1),
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    salaryRangeMin: uang.nullable().optional(),
    salaryRangeMax: uang.nullable().optional(),
    location: z.string().trim().max(200).optional(),
    recruitmentCost: uang.nullable().optional(),
    deadline: dateOnlyField.nullable().optional(),
  })
  .strict()
  .refine(
    (d) =>
      d.salaryRangeMin == null || d.salaryRangeMax == null || d.salaryRangeMax >= d.salaryRangeMin,
    { message: 'salaryRangeMax tidak boleh lebih kecil dari salaryRangeMin', path: ['salaryRangeMax'] }
  );

export const updateJobPostingSchema = z
  .object({
    title: z.string().trim().min(1).max(150).optional(),
    description: z.string().trim().min(1).max(5000).optional(),
    descriptionHtml: z.string().max(200_000).nullable().optional(),
    requirements: z.string().trim().min(1).max(5000).optional(),
    requirementsHtml: z.string().max(200_000).nullable().optional(),
    openings: z.coerce.number().int().min(1).max(500).optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).nullable().optional(),
    salaryRangeMin: uang.nullable().optional(),
    salaryRangeMax: uang.nullable().optional(),
    location: z.string().trim().max(200).nullable().optional(),
    deadline: dateOnlyField.nullable().optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, { message: 'Tidak ada field yang diubah' });

export const changeJobPostingStatusSchema = z
  .object({
    status: z.enum(['open', 'closed', 'filled', 'cancelled']),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const listJobPostingQuerySchema = z.object({
  ...paginationFields,
  status: z.enum(JOB_POSTING_STATUSES).optional(),
  positionId: ulidField.optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

// --- Pelamar ---

export const createCandidateSchema = z
  .object({
    jobPostingId: ulidField,
    name: z.string().trim().min(1).max(150),
    email: z.email('Format email tidak valid').toLowerCase(),
    phoneNumber: z.string().trim().max(32).optional(),
    cvUrl: z.url('cvUrl harus berupa URL').max(500).optional(),
    coverLetterUrl: z.url('coverLetterUrl harus berupa URL').max(500).optional(),
    source: z.string().trim().max(60).optional(),
    expectedSalary: uang.nullable().optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

export const changeCandidateStageSchema = z
  .object({
    stage: z.enum(CANDIDATE_STAGES),
    note: z.string().trim().max(1000).optional(),
    /// Wajib diisi saat menolak, supaya penolakan selalu punya alasan tercatat.
    rejectionReason: z.string().trim().max(1000).optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    if (d.stage === 'rejected' && !d.rejectionReason) {
      ctx.addIssue({
        code: 'custom',
        path: ['rejectionReason'],
        message: 'Penolakan harus disertai alasan',
      });
    }
  });

export const hireCandidateSchema = z
  .object({
    nik: z.string().trim().min(1).max(32),
    joinDate: dateOnlyField,
    departmentId: ulidField.optional(),
    positionId: ulidField.optional(),
    /// Status kepegawaian awal, umumnya masa percobaan.
    employeeStatus: z
      .enum(['active', 'probation', 'contract', 'internship'])
      .default('probation'),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

export const listCandidateQuerySchema = z.object({
  ...paginationFields,
  jobPostingId: ulidField.optional(),
  stage: z.enum(CANDIDATE_STAGES).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  source: z.string().trim().max(60).optional(),
});

// --- Wawancara ---

export const scheduleInterviewSchema = z
  .object({
    candidateId: ulidField,
    interviewerId: ulidField,
    stage: z.string().trim().min(1).max(40).default('hr'),
    round: z.coerce.number().int().min(1).max(20).default(1),
    scheduledDateTime: dateField,
    durationMinutes: z.coerce.number().int().min(10).max(480).default(60),
    location: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .strict();

export const submitInterviewFeedbackSchema = z
  .object({
    status: z.enum(INTERVIEW_STATUSES).default('completed'),
    result: z.enum(INTERVIEW_RESULTS).optional(),
    score: z.coerce.number().min(0).max(100).optional(),
    notes: z.string().trim().max(5000).optional(),
    feedback: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((d, ctx) => {
    // Wawancara yang dinyatakan selesai tanpa kesimpulan tidak berguna bagi
    // tahap berikutnya.
    if (d.status === 'completed' && !d.result) {
      ctx.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Wawancara yang selesai harus punya hasil: pass, fail, atau hold',
      });
    }
  });

export const listInterviewQuerySchema = z.object({
  ...paginationFields,
  candidateId: ulidField.optional(),
  interviewerId: ulidField.optional(),
  status: z.enum(INTERVIEW_STATUSES).optional(),
});

export const recruitmentReportQuerySchema = z.object({
  startDate: dateOnlyField,
  endDate: dateOnlyField,
  jobPostingId: ulidField.optional(),
});

export type CreateJobPostingInput = z.infer<typeof createJobPostingSchema>;
export type UpdateJobPostingInput = z.infer<typeof updateJobPostingSchema>;
export type ChangeJobPostingStatusInput = z.infer<typeof changeJobPostingStatusSchema>;
export type ListJobPostingQuery = z.infer<typeof listJobPostingQuerySchema>;
export type CreateCandidateInput = z.infer<typeof createCandidateSchema>;
export type ChangeCandidateStageInput = z.infer<typeof changeCandidateStageSchema>;
export type HireCandidateInput = z.infer<typeof hireCandidateSchema>;
export type ListCandidateQuery = z.infer<typeof listCandidateQuerySchema>;
export type ScheduleInterviewInput = z.infer<typeof scheduleInterviewSchema>;
export type SubmitInterviewFeedbackInput = z.infer<typeof submitInterviewFeedbackSchema>;
export type ListInterviewQuery = z.infer<typeof listInterviewQuerySchema>;
export type RecruitmentReportQuery = z.infer<typeof recruitmentReportQuerySchema>;
