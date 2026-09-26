// src/services/whatsapp/bootstrap.ts
//
// Menyalakan driver Baileys saat backend mulai, dan menyambungkan kembali
// nomor yang sebelumnya sudah terpasang.
//
// Tanpa penyambungan ulang otomatis, setiap deploy akan membuat semua nomor
// perusahaan diam-diam berhenti terpantau sampai ada yang sadar dan menekan
// tombol sambungkan satu per satu. Kredensialnya masih tersimpan di database,
// jadi tidak perlu scan QR ulang — hanya perlu dibuka lagi.
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { buatPembuatSoketBaileys } from './baileysDriver';
import { akunDenganTautanTersimpan } from './authStore';
import { connectAccount, setPembuatSoket, shutdownSessions } from './session';

/**
 * Nomor yang dibuka ulang saat backend mulai: yang benar-benar pernah
 * tertaut dan kredensialnya masih tersimpan.
 *
 * Status saja tidak cukup. Nomor yang QR-nya pernah kedaluwarsa tercatat
 * "terputus" walau belum pernah tertaut. Membukanya memunculkan QR yang tidak
 * dilihat siapa pun, di setiap deploy.
 */
export const akunUntukDibukaUlang = async () => {
  const kandidat = await prisma.whatsAppAccount.findMany({
    where: {
      isActive: true,
      sessionStatus: { in: ['connected', 'disconnected'] },
      authKeys: { some: { category: 'creds' } },
    },
    select: { id: true, phoneNumber: true, label: true },
    orderBy: { createdAt: 'asc' },
  });
  const tertaut = await akunDenganTautanTersimpan(kandidat.map((a) => a.id));
  return kandidat.filter((a) => tertaut.has(a.id));
};

export const mulaiDriverWhatsApp = async () => {
  if (!env.WHATSAPP_BAILEYS_ENABLED) return;

  if (!env.WHATSAPP_MONITORING_ENABLED) {
    // Menyalakan koneksi sementara pemantauannya mati berarti pesan masuk
    // tapi tidak ada yang boleh disimpan — membuka akses ke WhatsApp orang
    // tanpa tujuan yang sah.
    console.warn(
      '[whatsapp] WHATSAPP_BAILEYS_ENABLED=true tapi WHATSAPP_MONITORING_ENABLED=false. ' +
        'Driver tidak dinyalakan.'
    );
    return;
  }

  setPembuatSoket(buatPembuatSoketBaileys());

  const akun = await akunUntukDibukaUlang();

  for (const a of akun) {
    try {
      await connectAccount(a.id, a.phoneNumber);
      console.log(`[whatsapp] menyambungkan kembali ${a.label} (${a.phoneNumber})`);
    } catch (error) {
      // Satu nomor yang gagal tidak boleh menghalangi nomor lain, apalagi
      // menggagalkan boot backend.
      console.warn(`[whatsapp] gagal menyambungkan ${a.phoneNumber}:`, error);
    }
  }
};

export const hentikanDriverWhatsApp = async () => {
  await shutdownSessions();
  setPembuatSoket(null);
};
