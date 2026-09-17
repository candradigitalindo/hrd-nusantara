// src/utils/generateULID.ts
import { monotonicFactory } from 'ulid';

/**
 * Memakai monotonicFactory, bukan ulid() biasa.
 *
 * ulid() biasa mengacak ulang bagian random setiap panggilan, sehingga dua ID
 * yang dibuat dalam milidetik yang sama bisa tersortir terbalik — pada pengujian
 * sekitar separuh pasangan terbalik. Padahal sortabilitas menurut waktu justru
 * alasan dokumen arsitektur memilih ULID ketimbang UUID v4.
 *
 * monotonicFactory menaikkan bagian random saat milidetiknya sama, jadi urutan
 * pembuatan selalu terbaca dari primary key. Jaminan ini berlaku per proses;
 * antar instance backend, urutan dalam milidetik yang sama tetap tak terjamin.
 */
const nextULID = monotonicFactory();

export const generateULID = (): string => nextULID();
