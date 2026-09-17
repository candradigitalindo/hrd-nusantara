// src/utils/whatsappRetention.ts
//
// UU PDP 27/2022 menuntut data pribadi tidak disimpan lebih lama dari yang
// diperlukan. Berapa lama "diperlukan" itu bukan keputusan teknis — bergantung
// pada kewajiban audit dan kebijakan perusahaan — jadi di sini hanya
// disediakan mekanismenya, angkanya diisi lewat WHATSAPP_RETENTION_DAYS.
//
// Batas dihitung sebagai N x 24 jam mundur dari sekarang, bukan per batas
// hari kalender Asia/Jakarta. Untuk retensi berskala bulan sampai tahun,
// selisih beberapa jam di ujungnya tidak berarti apa-apa, dan aturan yang
// sederhana lebih mudah dijelaskan saat diaudit.

const MS_PER_HARI = 24 * 60 * 60 * 1000;

/**
 * Pesan yang lebih tua dari waktu ini sudah lewat masa simpan.
 *
 * Mengembalikan null kalau retensi tidak diatur (0), dan null itu berarti
 * "jangan hapus apa pun" — bukan "hapus semua". Perbedaan ini sengaja
 * ditegaskan karena salah menafsirkannya berarti menghapus seluruh arsip.
 */
export const retentionCutoff = (sekarang: Date, retensiHari: number): Date | null => {
  if (!Number.isFinite(retensiHari) || retensiHari <= 0) return null;
  return new Date(sekarang.getTime() - retensiHari * MS_PER_HARI);
};
