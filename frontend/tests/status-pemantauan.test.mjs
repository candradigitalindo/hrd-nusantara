import assert from "node:assert/strict";
import test from "node:test";
import { keadaanPemantauan } from "../src/lib/status-pemantauan.ts";

// Run with Node 22+: node --experimental-strip-types --test tests/status-pemantauan.test.mjs
const sekarang = Date.parse("2026-10-13T05:00:00.000Z");
const lalu = (menit) => new Date(sekarang - menit * 60_000).toISOString();
const pengaturan = (ubah = {}) => ({ enabled: true, mode: "always", intervalMinutes: 15, retentionDays: 30, updatedAt: lalu(1440), ...ubah });
const titik = (menit, ubah = {}) => ({ latitude: 0, longitude: 0, accuracyMeters: 10, isMocked: false, recordedAt: lalu(menit), receivedAt: lalu(menit), ...ubah });
const status = (ubah = {}) => ({ consentAt: lalu(1440), permission: "granted_always", platform: "android", appVersion: "1.0", updatedAt: lalu(1), ...ubah });
const karyawan = (ubah = {}) => ({
  employee: { id: "K1", nik: "EMP-1", name: "Karyawan uji", department: null },
  last: titik(5),
  currentAttendance: null,
  status: status(),
  ...ubah,
});
const nilai = (p = karyawan(), s = pengaturan()) => keadaanPemantauan(p, s, sekarang);

test("pemantauan nonaktif didahulukan daripada status ponsel yang belum ada", () => {
  assert.equal(nilai(karyawan({ status: null }), pengaturan({ enabled: false })).label, "Nonaktif");
});

test("pengaturan belum dimuat tidak menghasilkan status Aktif", () => {
  assert.equal(keadaanPemantauan(karyawan(), undefined, sekarang).label, "Pengaturan belum tersedia");
});

test("status belum dilaporkan berbeda dari persetujuan yang belum diberikan", () => {
  assert.equal(nilai(karyawan({ status: null })).label, "Belum melaporkan status");
  assert.equal(nilai(karyawan({ status: status({ consentAt: null }) })).label, "Belum menyetujui");
});

test("blokir yang benar-benar dilaporkan tetap terlihat walau titik lokasi masih baru", () => {
  const label = {
    service_off: "Layanan lokasi mati",
    denied: "Izin lokasi ditolak",
    denied_forever: "Izin lokasi diblokir",
    notifications_denied: "Notifikasi pemantauan diblokir",
    unavailable: "Status izin belum tersedia",
  };
  for (const [permission, harapan] of Object.entries(label)) {
    assert.equal(nilai(karyawan({ status: status({ permission }) })).label, harapan);
  }
});

test("izin kosong atau kode versi lain tidak pernah dianggap Aktif", () => {
  for (const permission of [null, "", "unknown_permission"]) {
    assert.equal(nilai(karyawan({ status: status({ permission }) })).label, "Status izin belum diketahui");
  }
});

test("mode selama bekerja di luar presensi tidak dianggap Tidak melapor", () => {
  assert.equal(nilai(karyawan({ last: titik(300) }), pengaturan({ mode: "while_working" })).label, "Di luar presensi");
});

test("respons lama tanpa keadaan presensi dan waktu check-in rusak tetap belum diketahui", () => {
  const s = pengaturan({ mode: "while_working" });
  assert.equal(nilai(karyawan({ currentAttendance: undefined }), s).label, "Status presensi belum tersedia");
  assert.equal(nilai(karyawan({ currentAttendance: { checkIn: "invalid" } }), s).label, "Status presensi belum tersedia");
});

test("check-in baru mendapat waktu mengirim; titik sebelum check-in bukan bukti Aktif", () => {
  const s = pengaturan({ mode: "while_working" });
  assert.equal(nilai(karyawan({ currentAttendance: { checkIn: lalu(2) }, last: titik(10) }), s).label, "Menunggu lokasi");
  assert.equal(nilai(karyawan({ currentAttendance: { checkIn: lalu(2) }, last: titik(1) }), s).label, "Aktif");
});

test("presensi terbuka yang melewati ambang tetap bisa Tidak melapor", () => {
  const p = karyawan({ currentAttendance: { checkIn: lalu(120) }, last: titik(46) });
  assert.equal(nilai(p, pengaturan({ mode: "while_working" })).label, "Tidak melapor");
});

test("ambang mempunyai lantai 30 menit dan hanya terlampaui setelah batas", () => {
  const s = pengaturan({ intervalMinutes: 1 });
  assert.equal(nilai(karyawan({ last: titik(29) }), s).label, "Aktif");
  assert.equal(nilai(karyawan({ last: titik(30) }), s).label, "Aktif");
  assert.equal(nilai(karyawan({ last: titik(30.01) }), s).label, "Tidak melapor");
});

test("interval lebih panjang memakai tiga interval: 15 menjadi 45, 60 menjadi 180 menit", () => {
  for (const [intervalMinutes, ambang] of [[15, 45], [60, 180]]) {
    const s = pengaturan({ intervalMinutes });
    assert.equal(nilai(karyawan({ last: titik(ambang) }), s).label, "Aktif");
    assert.equal(nilai(karyawan({ last: titik(ambang + 1) }), s).label, "Tidak melapor");
  }
});

test("antrean lokasi lama yang baru diterima dan pembaruan status tidak memulihkan kesegaran", () => {
  const p = karyawan({ last: titik(120, { receivedAt: lalu(0) }), status: status({ updatedAt: lalu(0) }) });
  assert.equal(nilai(p).label, "Tidak melapor");
});

test("tanggal riwayat tidak mengubah keadaan titik terbaru seluruh waktu", () => {
  assert.equal(nilai(karyawan({ last: titik(5), lastOnDate: titik(1440) })).label, "Aktif");
  assert.equal(nilai(karyawan({ last: titik(120), lastOnDate: titik(1440) })).label, "Tidak melapor");
});

test("pengaturan yang baru diaktifkan memberi jeda tanpa menganggap titik lama Aktif", () => {
  const p = karyawan({ last: titik(240) });
  assert.equal(nilai(p, pengaturan({ updatedAt: lalu(5) })).label, "Menunggu lokasi");
  assert.equal(nilai(p, pengaturan({ updatedAt: lalu(46) })).label, "Tidak melapor");
});

test("persetujuan pertama mendapat jeda; setelahnya ketiadaan titik dijelaskan tersendiri", () => {
  assert.equal(nilai(karyawan({ last: null, status: status({ consentAt: lalu(1) }) })).label, "Menunggu lokasi");
  assert.equal(nilai(karyawan({ last: null })).label, "Belum pernah mengirim");
});

test("waktu titik tak valid tidak dianggap Aktif", () => {
  for (const recordedAt of ["invalid", lalu(-60)]) {
    assert.equal(nilai(karyawan({ last: titik(5, { recordedAt }) })).label, "Waktu lokasi belum dapat dinilai");
  }
});

test("titik lama dengan izin saat digunakan memberi langkah pemeriksaan tanpa menebak penyebab", () => {
  const hasil = nilai(karyawan({ last: titik(120), status: status({ permission: "granted_while_in_use" }) }));
  assert.equal(hasil.label, "Tidak melapor");
  assert.match(hasil.rincian, /^Lokasi terbaru belum diterima; periksa koneksi dan pengaturan ponsel\./);
  assert.match(hasil.rincian, /sepanjang waktu/);
  assert.match(hasil.rincian, /pembatasan baterai/);
});
