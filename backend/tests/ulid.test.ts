import { prisma, resetDatabase } from './helpers/db';

const POLA_ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

beforeEach(resetDatabase);

describe('Primary key ULID', () => {
  it('diisi otomatis oleh extension saat create tidak menyertakan id', async () => {
    // `as never` melewati pengecekan TypeScript dengan sengaja: yang diuji
    // justru apa yang terjadi kalau sebuah controller lupa mengisi id.
    const dept = await prisma.department.create({ data: { name: 'Kitchen' } as never });

    expect(dept.id).toMatch(POLA_ULID);
  });

  it('diisi otomatis pada createMany', async () => {
    await prisma.department.createMany({
      data: [{ name: 'Housekeeping' }, { name: 'Security' }] as never,
    });

    const semua = await prisma.department.findMany();
    expect(semua).toHaveLength(2);
    for (const dept of semua) {
      expect(dept.id).toMatch(POLA_ULID);
    }
  });

  it('tidak menimpa id yang sudah diberikan', async () => {
    const id = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const dept = await prisma.department.create({ data: { id, name: 'Kitchen' } });

    expect(dept.id).toBe(id);
  });

  it('menghasilkan id yang urut menaik terhadap waktu', async () => {
    const pertama = await prisma.department.create({ data: { name: 'A' } as never });
    const kedua = await prisma.department.create({ data: { name: 'B' } as never });

    // Sifat inilah alasan memilih ULID ketimbang UUID v4:
    // urutan pembuatan terbaca langsung dari primary key.
    expect(kedua.id > pertama.id).toBe(true);
  });
});
