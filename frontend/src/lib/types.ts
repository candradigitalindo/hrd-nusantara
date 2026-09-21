export type Role = "SUPER_ADMIN" | "HR_ADMIN" | "MANAGER" | "EMPLOYEE";

export interface PenggunaSesi {
  id: string;
  nik: string;
  name: string;
  email: string;
  /** Lingkup data (diri sendiri / departemen / seluruh perusahaan). */
  role: Role;
  status: string;
  departmentId: string | null;
  positionId: string | null;
  /** Peran dinamis yang dipegang; null = memakai peran sistem sesuai role. */
  customRole: Ref | null;
  /** Izin efektif — hanya untuk menyembunyikan menu; penegakan tetap di server. */
  permissions: string[];
}

export interface DefinisiIzin {
  key: string;
  label: string;
  modul: string;
}

export interface KatalogIzin {
  permissions: DefinisiIzin[];
  scopes: { role: Role; label: string }[];
}

export interface PeranKustom {
  id: string;
  code: Role | null;
  name: string;
  description: string | null;
  baseRole: Role;
  permissions: string[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
  _count: { employees: number };
}

export interface Paginasi {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Halaman<T> {
  data: T[];
  pagination: Paginasi;
}

export interface Ref {
  id: string;
  name: string;
}

export interface Karyawan {
  id: string;
  nik: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  address: string | null;
  dateOfBirth: string | null;
  status: string;
  role: Role;
  customRoleId: string | null;
  customRole: (Ref & { isSystem: boolean }) | null;
  lastLoginAt: string | null;
  joinDate: string | null;
  exitDate: string | null;
  departmentId: string | null;
  positionId: string | null;
  department: Ref | null;
  position: Ref | null;
  createdAt: string;
}

export interface Departemen {
  id: string;
  name: string;
  description: string | null;
  workPatternId: string | null;
  workPattern: { id: string; name: string; type: string } | null;
  _count: { employees: number; positions: number };
}

export interface Jabatan {
  id: string;
  name: string;
  description: string | null;
  departmentId: string | null;
  department: Ref | null;
  _count: { employees: number };
}

export interface Presensi {
  id: string;
  employeeId: string;
  date: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  checkInMethod: string | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  workedMinutes: number | null;
  overtimeHours: string | number | null;
  overtimeApproved: boolean;
  faceVerified: boolean;
  /** Penanda kecurangan lokasi; kosong = wajar. Lihat LABEL_INTEGRITAS. */
  integrityFlags: string[];
  /** Pengiriman foto absensi ber-stempel ke grup WhatsApp: sent | failed | skipped. */
  stampStatus: string | null;
  stampNote: string | null;
  status: string;
  notes: string | null;
  employee: { id: string; nik: string; name: string; departmentId: string | null };
  workLocation: Ref | null;
  shiftSchedule: { id: string; date: string; startTime: string; endTime: string } | null;
}

export interface Cuti {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string | null;
  status: string;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  employee: { id: string; nik: string; name: string; departmentId: string | null };
  leaveType: { id: string; code: string; name: string; isPaid: boolean };
}

export interface AkunWhatsApp {
  id: string;
  /** null untuk nomor pribadi yang belum selesai dipindai. */
  phoneNumber: string | null;
  kind: "company" | "personal";
  label: string;
  description: string | null;
  assignedEmployeeId: string | null;
  sessionStatus: string;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  isActive: boolean;
  assignedEmployee: { id: string; nik: string; name: string } | null;
  conversationCount?: number;
}

export interface SesiWhatsApp {
  accountId: string;
  phoneNumber: string;
  label: string;
  status: string;
  qrTersedia: boolean;
  qr: string | null;
  catatan: string | null;
  percobaanSambungUlang?: number;
}

export interface Percakapan {
  id: string;
  externalMessageId: string;
  contactNumber: string;
  messageBody: string;
  messageType: string;
  timestamp: string;
  direction: "incoming" | "outgoing";
  account: { id: string; label: string; phoneNumber: string };
  relatedEmployee: { id: string; nik: string; name: string } | null;
}

export interface JejakAudit {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  action: string;
  entity: string | null;
  entityId: string | null;
  method: string;
  path: string;
  statusCode: number;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

/** Hitungan per nilai, sudah diurutkan dari yang terbanyak oleh server. */
export interface Hitungan {
  value: string;
  count: number;
}

export interface Dashboard {
  period: { startDate: string; endDate: string };
  headcount: {
    start: number;
    end: number;
    byDepartment: Hitungan[];
    byStatus: Hitungan[];
  };
  movement: { hires: number; exits: number; turnoverRate: number | null };
  tenure: {
    averageDays: number | null;
    distribution: { label: string; count: number }[];
    unknownJoinDate: number;
  };
}

export type JenisDokumen =
  | "cv" | "surat_lamaran" | "ktp" | "skck" | "ijazah" | "sertifikat"
  | "kontrak_kerja" | "npwp" | "bpjs_kesehatan" | "bpjs_ketenagakerjaan" | "lainnya";

export interface DokumenKaryawan {
  id: string;
  employeeId: string;
  type: JenisDokumen;
  title: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  issuedAt: string | null;
  expiresAt: string | null;
  notes: string | null;
  uploadedById: string | null;
  deletedAt: string | null;
  createdAt: string;
  employee?: { id: string; nik: string; name: string; department: Ref | null };
}

export type JenisKasus = "complaint" | "disciplinary_action";
export type StatusKasus = "open" | "under_review" | "resolved" | "dismissed";
export type TingkatSP = "teguran_lisan" | "sp1" | "sp2" | "sp3";

export interface Kasus {
  id: string;
  employeeId: string;
  type: JenisKasus;
  title: string;
  description: string;
  status: StatusKasus;
  severity: TingkatSP | null;
  incidentDate: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  reportedById: string | null;
  handledById: string | null;
  createdAt: string;
  employee: { id: string; nik: string; name: string; departmentId: string | null; department: Ref | null };
  reportedBy: { id: string; nik: string; name: string } | null;
  handledBy: { id: string; nik: string; name: string } | null;
  warning?: string;
}

export interface TipeCuti {
  id: string;
  code: string;
  name: string;
  description: string | null;
  defaultQuotaDays: number | null;
  isPaid: boolean;
  deductsBalance: boolean;
  requiresAttachment: boolean;
  maxConsecutiveDays: number | null;
  genderRestriction: string | null;
  isActive: boolean;
}

export interface SaldoCuti {
  id: string;
  employeeId: string;
  leaveType: { id: string; code: string; name: string };
  year: number;
  entitledDays: number;
  carriedOverDays: number;
  usedDays: number;
  collectiveLeaveDays: number;
  remainingDays: number;
  note: string | null;
}

export interface ItemSlip {
  code: string;
  name: string;
  type: "allowance" | "deduction";
  amount: number;
  calculationNote: string | null;
  isTaxable: boolean;
}

export interface SlipGaji {
  id: string;
  employeeId: string;
  payrollRunId: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  salaryType: string;
  baseAmount: number;
  basicSalary: number;
  scheduledDays: number;
  workedDays: number;
  unpaidLeaveDays: number;
  overtimeHours: number;
  overtimePay: number;
  totalAllowances: number;
  totalDeductions: number;
  grossSalary: number;
  taxableIncome: number;
  netSalary: number;
  status: string;
  note: string | null;
  createdAt: string;
  employee: { id: string; nik: string; name: string; departmentId: string | null };
  items: ItemSlip[];
}

export interface KomponenGaji {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: "allowance" | "deduction";
  calculation: "fixed" | "percentage";
  percentageBase: "basic" | "gross" | null;
  defaultAmount: number | null;
  defaultPercentage: number | null;
  capAmount: number | null;
  isTaxable: boolean;
  isStatutory: boolean;
  isActive: boolean;
}

export interface GajiPokok {
  id: string;
  employeeId: string;
  salaryType: "monthly" | "daily" | "hourly";
  baseAmount: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
}

export interface KomponenKaryawan {
  id: string;
  employeeId: string;
  componentId: string;
  amount: number | null;
  percentage: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  component: { id: string; code: string; name: string; type: "allowance" | "deduction" };
}

export type StatusBatch = "draft" | "calculated" | "approved" | "paid" | "cancelled";

export interface BatchGaji {
  id: string;
  code: string;
  name: string;
  periodStart: string;
  periodEnd: string;
  status: StatusBatch;
  note: string | null;
  calculatedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  approvedById: string | null;
  createdAt: string;
  _count?: { payrolls: number };
}

export interface HasilHitung {
  payrollRun: BatchGaji;
  calculated: number;
  skipped: { employeeId: string; nik: string; name: string; reason: string }[];
}

export type TahapKandidat = "applied" | "screening" | "interview" | "offer" | "hired" | "rejected" | "withdrawn";
export type StatusLowongan = "draft" | "open" | "closed" | "filled" | "cancelled";

export interface Lowongan {
  id: string;
  title: string;
  description: string;
  requirements: string;
  positionId: string;
  openings: number;
  employmentType: string | null;
  salaryRangeMin: number | null;
  salaryRangeMax: number | null;
  location: string | null;
  recruitmentCost: number | null;
  postedDate: string | null;
  deadline: string | null;
  publishedAt: string | null;
  closedAt: string | null;
  status: StatusLowongan;
  createdAt: string;
  position: { id: string; name: string; departmentId: string | null };
  _count?: { candidates: number };
}

export interface RiwayatTahap {
  fromStage: string | null;
  toStage: string;
  changedById: string | null;
  note: string | null;
  createdAt: string;
}

export interface WawancaraRingkas {
  id: string;
  stage: string;
  round: number;
  scheduledDateTime: string;
  status: string;
  result: string | null;
  score: number | null;
  interviewerId: string;
}

export interface Kandidat {
  id: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  status: TahapKandidat;
  appliedPositionId: string;
  applicationDate: string;
  cvUrl: string | null;
  coverLetterUrl: string | null;
  source: string | null;
  expectedSalary: number | null;
  notes: string | null;
  rejectionReason: string | null;
  hiredEmployeeId: string | null;
  createdAt: string;
  appliedPosition: { id: string; title: string; status: string };
  stageHistory: RiwayatTahap[];
  interviews: WawancaraRingkas[];
}

export interface Wawancara {
  id: string;
  candidateId: string;
  interviewerId: string;
  stage: string;
  round: number;
  scheduledDateTime: string;
  durationMinutes: number;
  location: string | null;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  result: "pass" | "fail" | "hold" | null;
  score: number | null;
  notes: string | null;
  feedback: Record<string, unknown> | null;
  createdAt: string;
  candidate: { id: string; name: string; status: string };
  interviewer: { id: string; nik: string; name: string };
}

export interface HasilPsikotes {
  id: string;
  candidateId: string;
  testName: string;
  score: number;
  maxScore: number | null;
  testDate: string | null;
  interpretation: string | null;
  reportUrl: string | null;
  status: string;
  evaluatedBy: { id: string; nik: string; name: string } | null;
  createdAt: string;
}

export interface CorongRekrutmen {
  period: { startDate: string; endDate: string };
  totalCandidates: number;
  funnel: Record<string, number> | { stage: string; count: number }[];
  rejected: number;
  withdrawn: number;
  averageDaysToHire: number | null;
  bySource: { source: string; total?: number; hired?: number; [k: string]: unknown }[];
}

export type Prioritas = "normal" | "important" | "urgent";

export interface Pengumuman {
  id: string;
  title: string;
  content: string;
  authorId: string | null;
  status: "draft" | "published" | "archived";
  priority: Prioritas;
  publishDate: string | null;
  publishedAt: string | null;
  expiresAt: string | null;
  targetDepartmentId: string | null;
  requiresAcknowledgment: boolean;
  createdAt: string;
  author: { id: string; name: string } | null;
  readCount: number;
  isRead: boolean;
  acknowledgedAt: string | null;
}

export interface PembacaPengumuman {
  employee: { id: string; nik: string; name: string };
  readAt: string;
  acknowledgedAt: string | null;
}

export type JenisPertanyaan = "scale" | "text" | "choice";

export interface PertanyaanSurvei {
  id: string;
  code: string;
  text: string;
  type: JenisPertanyaan;
  options: string[] | null;
  minScale: number | null;
  maxScale: number | null;
  isRequired: boolean;
  sortOrder: number;
}

export interface Survei {
  id: string;
  title: string;
  description: string | null;
  isAnonymous: boolean;
  targetDepartmentId: string | null;
  startDate: string;
  endDate: string;
  status: "draft" | "published" | "closed";
  createdById: string | null;
  createdAt: string;
  questions: PertanyaanSurvei[];
  participationCount: number;
  hasSubmitted: boolean;
}

export interface HasilSurvei {
  survey: { id: string; title: string; isAnonymous: boolean; status: string };
  targetCount: number;
  responseCount: number;
  responseRate: number;
  questions: { questionId: string; code: string; text: string; type: JenisPertanyaan; responseCount: number; average: number | null; distribution: Record<string, number> }[];
  textAnswers: { questionId: string; text: string; answers: (string | null)[] }[];
}

export interface ProgramPelatihan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  isMandatory: boolean;
  targetPositionId: string | null;
  targetDepartmentId: string | null;
  passingScore: number | null;
  validityMonths: number | null;
  durationHours: number | null;
  isActive: boolean;
  createdAt: string;
}

export interface SesiPelatihan {
  id: string;
  programId: string;
  title: string;
  description: string | null;
  trainer: string;
  startDateTime: string;
  endDateTime: string;
  location: string | null;
  maxParticipants: number | null;
  registrationDeadline: string | null;
  cost: number | null;
  status: "scheduled" | "ongoing" | "completed" | "cancelled";
  createdAt: string;
  program: { id: string; code: string; name: string; isMandatory: boolean; passingScore: number | null };
  registrationCount: number;
}

export type StatusPendaftaran = "registered" | "waitlisted" | "attended" | "completed" | "failed" | "no_show" | "cancelled";

export interface PendaftaranPelatihan {
  id: string;
  employeeId: string;
  trainingSessionId: string;
  registrationDate: string;
  status: StatusPendaftaran;
  attendanceStatus: string | null;
  evaluationScore: number | null;
  passed: boolean | null;
  completedAt: string | null;
  certificateUrl: string | null;
  expiresAt: string | null;
  note: string | null;
  employee: { id: string; nik: string; name: string; departmentId: string | null };
  trainingSession: { id: string; title: string; startDateTime: string; status: string; program: { id: string; code: string; name: string } };
}

export type StatusKepatuhan = "compliant" | "expiring_soon" | "expired" | "never_completed";

export interface KepatuhanPelatihan {
  warningDays: number;
  programs: {
    program: { id: string; code: string; name: string };
    requiredFor: number;
    summary: { compliant: number; expiringSoon: number; expired: number; neverCompleted: number };
    needsAction: { employee: { id: string; nik: string; name: string; departmentId: string | null }; state: StatusKepatuhan; validUntil: string | null }[];
  }[];
}

export type JenisPenilai = "self" | "manager" | "peer" | "subordinate";

export interface KriteriaKinerja {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  weight: number;
  maxScore: number;
  sortOrder: number;
}

export interface TemplatePenilaian {
  id: string;
  name: string;
  description: string | null;
  positionId: string | null;
  isActive?: boolean;
  createdAt: string;
  criteria: KriteriaKinerja[];
}

export interface SiklusPenilaian {
  id: string;
  code: string;
  name: string;
  periodType: "quarterly" | "semester" | "annual";
  periodStart: string;
  periodEnd: string;
  status: "draft" | "open" | "closed";
  note: string | null;
  createdAt: string;
  _count?: { reviews: number };
}

export interface SkorKriteria {
  criterionId: string;
  score: number;
  comment: string | null;
  criterion: { code: string; name: string; weight: number; maxScore: number };
}

export interface Penilaian {
  id: string;
  cycleId: string;
  revieweeId: string;
  reviewerId: string;
  reviewerType: JenisPenilai;
  period: string | null;
  formTemplateId: string;
  totalScore: number | null;
  rating: number | null;
  feedback: string | null;
  status: "draft" | "submitted" | "acknowledged" | "finalized";
  submittedAt: string | null;
  createdAt: string;
  reviewee: { id: string; nik: string; name: string; departmentId: string | null };
  reviewer: { id: string; nik: string; name: string };
  scores: SkorKriteria[];
  discussions: { id: string; authorId: string; note: string; createdAt: string }[];
  /** Hanya pada detail (GET /performance/reviews/:id): kriteria formulirnya, agar penilai bukan HR bisa mengisi draf. */
  criteria?: KriteriaKinerja[];
}

export interface UmpanBalik {
  id: string;
  recipientId: string;
  authorId: string | null;
  type: "praise" | "improvement" | "note";
  message: string;
  isPrivate: boolean;
  createdAt: string;
  recipient?: { id: string; nik: string; name: string };
  author?: { id: string; nik: string; name: string } | null;
}

export interface RingkasanKinerja {
  employeeId: string;
  cycleId: string;
  submittedReviews: number;
  pendingReviews: number;
  overall: number | null;
  byReviewerType: { reviewerType: JenisPenilai; count: number; averageScore: number }[];
}

// ===== Kompetensi & sertifikasi =====

export interface Kompetensi {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  maxLevel: number;
  /** Label tiap tingkat, mis. {"1":"Dasar","4":"Ahli"}. */
  levelLabels: Record<string, string> | null;
  isActive: boolean;
  createdAt: string;
}

export interface StandarKompetensi {
  id: string;
  positionId: string;
  competencyId: string;
  requiredLevel: number;
  description: string | null;
  competency: { id: string; code: string; name: string; maxLevel: number };
}

export interface ButirKesenjangan {
  competencyId: string;
  competencyCode: string;
  competencyName: string;
  requiredLevel: number;
  /** null = belum pernah dinilai. */
  currentLevel: number | null;
  gap: number;
  meets: boolean;
  notAssessed: boolean;
}

export interface AnalisisKesenjangan {
  employee: { id: string; nik: string; name: string; positionId: string | null };
  gaps: ButirKesenjangan[];
  totalRequired: number;
  totalMet: number;
  readinessPercent: number;
}

export interface BarisLaporanKesenjangan {
  employee: { id: string; nik: string; name: string; positionId: string | null };
  totalRequired: number;
  totalMet: number;
  readinessPercent: number;
  unmetCompetencies: ButirKesenjangan[];
}

export interface PenilaianKompetensi {
  id: string;
  employeeId: string;
  competencyId: string;
  currentLevel: number;
  assessedById: string;
  assessedAt: string;
  evidenceUrl: string | null;
  note: string | null;
  competency: { id: string; code: string; name: string; maxLevel: number };
}

export interface JenisSertifikasi {
  id: string;
  code: string;
  name: string;
  description: string | null;
  issuingOrganization: string | null;
  /** null = tidak kedaluwarsa. */
  validityMonths: number | null;
  isMandatory: boolean;
  targetPositionId: string | null;
  trainingProgramId: string | null;
  isActive: boolean;
  createdAt: string;
}

export type StatusSertifikat = "valid" | "expiring_soon" | "expired" | "revoked";

export interface Sertifikat {
  id: string;
  employeeId: string;
  certificationTypeId: string | null;
  certificationName: string;
  issuingOrganization: string;
  issueDate: string;
  expiryDate: string | null;
  certificateUrl: string | null;
  trainingRegistrationId: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  note: string | null;
  createdAt: string;
  employee: { id: string; nik: string; name: string; departmentId: string | null };
  /** Dihitung server dari expiryDate/revokedAt, bukan kolom tersimpan. */
  state: StatusSertifikat;
}

export interface DaftarSertifikat extends Halaman<Sertifikat> {
  summary: { valid: number; expiringSoon: number; expired: number; revoked: number };
}

// ===== Direktori, laporan, chat =====

/** Direktori ringkas untuk semua peran: nama dan unit saja, tanpa data pribadi. */
export interface KaryawanDirektori {
  id: string;
  nik: string;
  name: string;
  department: Ref | null;
  position: Ref | null;
}

export interface LaporanTurnover {
  period: { startDate: string; endDate: string };
  totalExits: number;
  byReason: Hitungan[];
  byType: Hitungan[];
  byDepartment: Hitungan[];
  byPosition: Hitungan[];
  tenureAtExit: { averageDays: number | null; distribution: { label: string; count: number }[] };
  exits: {
    id: string;
    nik: string;
    name: string;
    joinDate: string | null;
    exitDate: string | null;
    exitReason: string | null;
    exitType: string | null;
    department: Ref | null;
    position: Ref | null;
  }[];
}

export interface LaporanBiaya {
  period: { startDate: string; endDate: string };
  costs: {
    payroll: number;
    training: number;
    recruitment: number;
    total: number;
    shares: { payroll: number; training: number; recruitment: number };
  };
  detail: { payslipCount: number; overtimePay: number; allowances: number; trainingSessions: number; jobPostings: number };
  hires: number;
  costPerHire: number | null;
}

export interface LaporanProduktivitas {
  period: { startDate: string; endDate: string };
  scheduledShifts: number;
  attendanceCount: number;
  averageWorkedHours: number;
  latePercentage: number;
  absencePercentage: number;
  approvedOvertimeHours: number;
}

export type DatasetMentah = "employees" | "attendance" | "leaves" | "payrolls" | "trainings";

export interface DataMentah {
  dataset: DatasetMentah;
  data: Record<string, unknown>[];
  pagination: { page: number; limit: number; total: number };
}

export type JenisRuang = "general" | "department" | "team";

export interface RuangChat {
  id: string;
  name: string;
  description: string | null;
  type: JenisRuang;
  isPrivate: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count: { members: number; messages: number };
  myRole: "member" | "moderator";
  lastMessage: { message: string | null; timestamp: string; senderName: string; isDeleted: boolean } | null;
}

export interface PesanChat {
  id: string;
  roomId: string;
  senderId: string;
  /** null bila sudah dihapus. */
  message: string | null;
  isDeleted: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  timestamp: string;
  sender: { id: string; name: string };
}

/** Kepatuhan: setiap karyawan aktif wajib menautkan WhatsApp-nya. */
export type StatusTautanWa = "connected" | "disconnected" | "pending_scan" | "never_linked";

export interface BarisKepatuhanWa {
  employee: { id: string; nik: string; name: string; department: Ref | null };
  status: StatusTautanWa;
  accountId: string | null;
  phoneNumber: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  attendanceGroupName: string | null;
}

export interface KepatuhanWa {
  data: BarisKepatuhanWa[];
  summary: { total: number; connected: number; disconnected: number; pendingScan: number; neverLinked: number };
}

/** Tautan WhatsApp pribadi pengguna yang login (GET /whatsapp/me). */
export interface TautanWhatsApp {
  status: "never_linked" | "connecting" | "pending_scan" | "connected" | "disconnected" | "inactive";
  driverAktif: boolean;
  account: { id: string; kind: string; label: string; phoneNumber: string | null; sessionStatus: string; lastConnectedAt: string | null; lastDisconnectedAt: string | null; isActive: boolean; attendanceGroup: { jid: string; name: string | null } | null } | null;
  qr: string | null;
  catatan: string | null;
}

export interface GrupWhatsApp {
  jid: string;
  nama: string;
  jumlahAnggota: number;
}

/** Rilis aplikasi mobile (APK) yang diunggah HR. */
export interface RilisMobile {
  id: string;
  versionName: string;
  versionCode: number;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  notes: string | null;
  isActive: boolean;
  downloadCount: number;
  createdAt: string;
  uploadedBy: { id: string; name: string } | null;
  /** Hanya pada /mobile/releases/latest. */
  downloadPath?: string;
}
