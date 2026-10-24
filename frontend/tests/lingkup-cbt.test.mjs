import test from 'node:test';
import assert from 'node:assert/strict';
import { halamanTesCbt, tautanHasilCbt, kandidatBisaDites, statusTinjauanSeleksi, versiHasilBisaDitinjau, konflikVersiHasilCbt } from '../src/lib/lingkup-cbt.ts';

test('hasil kembali ke katalog sesuai proses, termasuk ID yang harus di-encode', () => {
  assert.equal(halamanTesCbt('development'), '/cbt');
  assert.equal(tautanHasilCbt('recruitment', 'hasil/a'), '/rekrutmen/tes/hasil/hasil%2Fa');
  assert.equal(tautanHasilCbt('development', 'hasil-a'), '/cbt/hasil/hasil-a');
});

test('penugasan pelamar hanya untuk tahap aktif, termasuk tahap baru yang tidak dikenal', () => {
  for (const tahap of ['applied', 'screening', 'interview', 'offer']) assert.equal(kandidatBisaDites(tahap), true);
  for (const tahap of ['hired', 'rejected', 'withdrawn', 'unknown']) assert.equal(kandidatBisaDites(tahap), false);
});

const dikirim = '2026-10-13T01:00:00.000Z';
const dinilai = '2026-10-13T01:10:00.000Z';
for (const { nama, status, submittedAt, reviewedAt, label, dapatDitinjau } of [
  { nama: 'baru ditugaskan', status: 'assigned', submittedAt: null, gradedAt: null, reviewedAt: null, label: 'Belum selesai', dapatDitinjau: false },
  { nama: 'sedang dikerjakan', status: 'in_progress', submittedAt: null, gradedAt: null, reviewedAt: null, label: 'Belum selesai', dapatDitinjau: false },
  { nama: 'esai dikirim belum dinilai', status: 'submitted', submittedAt: dikirim, gradedAt: null, reviewedAt: null, label: 'Menunggu penilaian', dapatDitinjau: false },
  { nama: 'objektif atau Big Five dinilai otomatis tanpa gradedAt', status: 'graded', submittedAt: dikirim, gradedAt: null, reviewedAt: null, label: 'Menunggu tinjauan HR', dapatDitinjau: true },
  { nama: 'sudah dinilai belum direview', status: 'graded', submittedAt: dikirim, gradedAt: dinilai, reviewedAt: null, label: 'Menunggu tinjauan HR', dapatDitinjau: true },
  { nama: 'tinjauan lengkap', status: 'graded', submittedAt: dikirim, gradedAt: dinilai, reviewedAt: dinilai, label: 'Sudah ditinjau HR', dapatDitinjau: false },
  { nama: 'tinjauan lama tidak menutupi status belum dinilai', status: 'submitted', submittedAt: dikirim, gradedAt: null, reviewedAt: dinilai, label: 'Menunggu penilaian', dapatDitinjau: false },
]) {
  test(`tinjauan: ${nama}`, () => {
    const hasil = statusTinjauanSeleksi({ status, reviewedAt }, submittedAt);
    assert.equal(hasil.label, label);
    assert.equal(hasil.dapatDitinjau, dapatDitinjau);
  });
}

test('profil kepribadian dan nilai akademik tidak menentukan kelayakan tinjauan HR', () => {
  const hasil = statusTinjauanSeleksi({ status: 'graded', reviewedAt: null, percent: null, passed: null }, dikirim);
  assert.equal(hasil.dapatDitinjau, true);
  const tidakLulus = statusTinjauanSeleksi({ status: 'graded', reviewedAt: null, percent: 20, passed: false }, dikirim);
  assert.equal(tidakLulus.dapatDitinjau, true);
});


test('tinjauan versi lama tetap diblokir sampai hasil terbaru selesai dimuat', () => {
  const lama = '2026-10-13T01:00:00.000Z';
  const baru = '2026-10-13T01:05:00.000Z';
  assert.equal(versiHasilBisaDitinjau(lama, null, false), true);
  // Server menolak versi yang dibaca; pemuatan ulang gagal atau masih berjalan.
  assert.equal(versiHasilBisaDitinjau(lama, lama, false), false);
  assert.equal(versiHasilBisaDitinjau(lama, lama, true), false);
  assert.equal(versiHasilBisaDitinjau(baru, lama, true), false);
  // Versi baru sudah ditampilkan; HR harus mengklik tinjau lagi secara eksplisit.
  assert.equal(versiHasilBisaDitinjau(baru, lama, false), true);
  assert.equal(versiHasilBisaDitinjau(undefined, null, false), false);
});


test('hanya konflik versi memicu muat ulang, bukan konflik kelengkapan atau tahap pelamar', () => {
  assert.equal(konflikVersiHasilCbt(409, 'CBT_RESULT_CHANGED'), true);
  assert.equal(konflikVersiHasilCbt(409, undefined), false);
  assert.equal(konflikVersiHasilCbt(409, 'INCOMPLETE_TEST'), false);
  assert.equal(konflikVersiHasilCbt(409, 'TERMINAL_CANDIDATE'), false);
  assert.equal(konflikVersiHasilCbt(500, 'CBT_RESULT_CHANGED'), false);
  assert.equal(konflikVersiHasilCbt(undefined, undefined), false);
});
