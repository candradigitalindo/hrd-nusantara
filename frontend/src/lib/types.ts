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
