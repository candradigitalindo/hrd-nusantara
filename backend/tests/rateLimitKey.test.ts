import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { env } from '../src/config/env';
import { kunciPembatas } from '../src/middleware/rateLimitKey';

const buatReq = (authorization?: string, ip = '203.0.113.7') =>
  ({ headers: authorization ? { authorization } : {}, ip }) as unknown as Request;

describe('kunciPembatas', () => {
  it('token sah → jatah per pengguna, bukan per IP', () => {
    const token = jwt.sign({ sub: '01HZZZUSER0000000000000001', role: 'HR_ADMIN' }, env.JWT_SECRET, { expiresIn: '1h' });
    const hasil = kunciPembatas(buatReq(`Bearer ${token}`));
    expect(hasil).toEqual({ kunci: 'user:01HZZZUSER0000000000000001', jenis: 'karyawan', berSesi: true });
  });

  it('dua perangkat dengan pengguna sama memakai kunci yang sama walau IP berbeda', () => {
    const token = jwt.sign({ sub: '01HZZZUSER0000000000000002', role: 'MANAGER' }, env.JWT_SECRET, { expiresIn: '1h' });
    const a = kunciPembatas(buatReq(`Bearer ${token}`, '203.0.113.7'));
    const b = kunciPembatas(buatReq(`Bearer ${token}`, '198.51.100.9'));
    expect(a.kunci).toBe(b.kunci);
  });

  it('tanpa token → jatah per IP', () => {
    expect(kunciPembatas(buatReq())).toEqual({ kunci: 'ip:203.0.113.7', jenis: 'ip', berSesi: false });
  });

  it('token palsu (kunci lain) tidak bisa menghindari jatah IP', () => {
    const palsu = jwt.sign({ sub: 'penyusup', role: 'SUPER_ADMIN' }, 'kunci-yang-salah-tapi-cukup-panjang-32-karakter');
    expect(kunciPembatas(buatReq(`Bearer ${palsu}`))).toEqual({ kunci: 'ip:203.0.113.7', jenis: 'ip', berSesi: false });
  });

  it('token kedaluwarsa → jatah per IP', () => {
    const basi = jwt.sign({ sub: '01HZZZUSER0000000000000003', role: 'EMPLOYEE' }, env.JWT_SECRET, { expiresIn: -60 });
    expect(kunciPembatas(buatReq(`Bearer ${basi}`)).berSesi).toBe(false);
  });

  it('header bukan Bearer atau token kosong → jatah per IP', () => {
    expect(kunciPembatas(buatReq('Basic abc')).berSesi).toBe(false);
    expect(kunciPembatas(buatReq('Bearer ')).berSesi).toBe(false);
  });

  it('IPv6 dinormalkan per /64 supaya satu pelanggan tidak punya jatah tak terbatas', () => {
    const a = kunciPembatas(buatReq(undefined, '2001:db8:abcd:1234::1'));
    const b = kunciPembatas(buatReq(undefined, '2001:db8:abcd:1234:ffff::9'));
    expect(a.kunci).toBe(b.kunci);
    expect(a.kunci.startsWith('ip:')).toBe(true);
  });

  it('token pelamar portal karier → jatah pelamar sendiri, bukan jatah karyawan', () => {
    const token = jwt.sign({ sub: '01HZZZAKUN000000000000001', tipe: 'pelamar' }, env.JWT_SECRET, { expiresIn: '1h' });
    expect(kunciPembatas(buatReq(`Bearer ${token}`))).toEqual({ kunci: 'pelamar:01HZZZAKUN000000000000001', jenis: 'pelamar', berSesi: true });
  });

  it('token dengan klaim tipe asing atau tanpa sub → jatah per IP', () => {
    const asing = jwt.sign({ sub: '01HZZZAKUN000000000000002', tipe: 'robot' }, env.JWT_SECRET, { expiresIn: '1h' });
    expect(kunciPembatas(buatReq(`Bearer ${asing}`)).jenis).toBe('ip');
    const tanpaSub = jwt.sign({ role: 'HR_ADMIN' }, env.JWT_SECRET, { expiresIn: '1h' });
    expect(kunciPembatas(buatReq(`Bearer ${tanpaSub}`)).jenis).toBe('ip');
  });

  it('sub yang terlalu panjang dipotong supaya kunci penyimpanan tetap pendek', () => {
    const panjang = jwt.sign({ sub: 'x'.repeat(500) }, env.JWT_SECRET, { expiresIn: '1h' });
    expect(kunciPembatas(buatReq(`Bearer ${panjang}`)).kunci).toBe(`user:${'x'.repeat(64)}`);
  });

  it('dua /64 IPv6 yang berbeda tidak berbagi jatah', () => {
    const a = kunciPembatas(buatReq(undefined, '2001:db8:abcd:1234::1'));
    const b = kunciPembatas(buatReq(undefined, '2001:db8:abcd:1235::1'));
    expect(a.kunci).not.toBe(b.kunci);
  });

  it('hasil disimpan di request: dipanggil dua kali memberi objek yang sama', () => {
    const req = buatReq();
    expect(kunciPembatas(req)).toBe(kunciPembatas(req));
  });
});
