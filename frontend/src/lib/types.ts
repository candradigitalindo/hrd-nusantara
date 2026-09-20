export type Role = "SUPER_ADMIN" | "HR_ADMIN" | "MANAGER" | "EMPLOYEE";

export interface PenggunaSesi {
  id: string;
  nik: string;
  name: string;
  email: string;
  role: Role;
  status: string;
  departmentId: string | null;
  positionId: string | null;
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
  phoneNumber: string;
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

export interface Dashboard {
  period: { startDate: string; endDate: string };
  headcount: {
    start: number;
    end: number;
    byDepartment: Record<string, number>;
    byStatus: Record<string, number>;
  };
  movement: { hires: number; exits: number; turnoverRate: number | null };
  tenure: {
    averageDays: number | null;
    distribution: Record<string, number>;
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
