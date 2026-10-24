import { Prisma } from '@prisma/client';
import type { PrismaTransactionClient } from '../../lib/prisma';
import { bacaPilihan, jenisPaket, ringkasKategori } from '../../utils/cbt';
import { GalatCbt } from './attempt';

export const selectionAssignmentSelect = {
  id: true, required: true, status: true, reviewedAt: true, reviewedById: true,
  attempt: { select: { submittedAt: true, updatedAt: true, answers: { select: { questionId: true, chosen: true, text: true, points: true } } } },
  test: { select: { questions: { select: { points: true, question: { select: { id: true, category: true, type: true, points: true, options: true } } } } } },
} satisfies Prisma.CbtAssignmentSelect;
type SelectionAssignment = Prisma.CbtAssignmentGetPayload<{ select: typeof selectionAssignmentSelect }>;

/** Completion means usable responses and final grading, never a personality score threshold. */
export const selectionCompletionProblem = (assignment: SelectionAssignment): string | null => {
  if (assignment.status !== 'graded' || !assignment.attempt?.submittedAt) return 'Tes wajib harus selesai dan seluruh jawaban selesai dinilai';
  const answers = new Map(assignment.attempt.answers.map((a) => [a.questionId, a]));
  const questions = assignment.test.questions;
  if (!questions.some(({ question }) => {
    const a = answers.get(question.id);
    return Boolean(a && (a.chosen.length > 0 || a.text?.trim()));
  })) return 'Tes tidak berisi jawaban. Tugaskan tes ulang sebelum meninjau hasil';
  if (jenisPaket(questions.map((q) => q.question.type)) === 'kepribadian') {
    const categories = ringkasKategori(questions.map(({ question: q, points }) => {
      const a = answers.get(q.id);
      return { kategori: q.category, tipe: q.type, maksimal: points ?? q.points, poin: a?.points ?? null, dipilih: a?.chosen ?? [], pilihan: bacaPilihan(q.options) };
    }));
    if (categories.some((category) => !category.cukup)) return 'Jawaban inventori belum mencukupi (minimal 80% setiap dimensi). Tugaskan tes ulang';
  }
  return null;
};

export const selectionReadiness = (assignments: SelectionAssignment[]) => {
  const required = assignments.filter((a) => a.required);
  const completed = required.filter((a) => selectionCompletionProblem(a) === null);
  const reviewed = completed.filter((a) => a.reviewedAt !== null && a.reviewedById !== null);
  const reason = required.length === 0 ? 'Tugaskan minimal satu tes seleksi wajib sebelum menerima pelamar'
    : completed.length !== required.length ? required.map(selectionCompletionProblem).find(Boolean) ?? 'Selesaikan seluruh tes wajib'
    : reviewed.length !== required.length ? 'HR harus meninjau seluruh hasil tes wajib sebelum menerima pelamar'
    : null;
  return { requiredCount: required.length, completedCount: completed.length, reviewedCount: reviewed.length, ready: reason === null, reason };
};

/** Every mutation affecting selection readiness and hiring locks this same row. */
export const lockCandidate = async (tx: PrismaTransactionClient, candidateId: string, activeOnly = false) => {
  const rows = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT "id", "status" FROM "Candidate" WHERE "id" = ${candidateId} FOR UPDATE`;
  const candidate = rows[0];
  if (!candidate) throw new GalatCbt(404, 'Pelamar tidak ditemukan');
  if (activeOnly && ['hired', 'rejected', 'withdrawn'].includes(candidate.status)) throw new GalatCbt(409, 'Proses pelamar sudah ditutup; tes seleksi tidak dapat diubah');
  return candidate;
};

export class SelectionReadinessError extends GalatCbt {
  constructor(readonly readiness: ReturnType<typeof selectionReadiness>) {
    super(409, readiness.reason ?? 'Tes seleksi belum siap');
  }
}
