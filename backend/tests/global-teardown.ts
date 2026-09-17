// Memutus koneksi database sekali setelah seluruh berkas test selesai.
//
// Dulu tiap berkas memanggil prisma.$disconnect() sendiri di afterAll. Karena
// client-nya kini dipakai bersama seluruh berkas, pemutusan per berkas justru
// mencabut koneksi yang masih dibutuhkan berkas berikutnya.
import { prisma } from '../src/lib/prisma';

export default async () => {
  await prisma.$disconnect();
};
