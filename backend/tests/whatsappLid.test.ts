import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee } from './helpers/db';
import { bikinApp } from './helpers/app';
import { login, auth, expectStatus } from './helpers/api';
import { env } from '../src/config/env';
import { encryptField } from '../src/utils/fieldCrypto';
import { generateULID } from '../src/utils/generateULID';
import {
  setPembuatSoket,
  shutdownSessions,
  tungguEventSelesai,
  type SesiDibuat,
  type KunciPesanWhatsApp,
  type MetadataGrup,
} from '../src/services/whatsapp/session';
import { pulihkanLid } from '../src/services/whatsapp/pemulihanLid';

const app = bikinApp();

const NOMOR_PERUSAHAAN = '628111111111';
const LID_SARI = '214751418265748';
const NOMOR_SARI = '628222222222';
const LID_ANDI = '88014471852141';
const NOMOR_ANDI = '628333333333';
const GRUP = '12036301234567890@g.us';

/**
 * Soket palsu dengan store LID Baileys tiruan: getPNsForLIDs hanya menjawab
 * dari pemetaan yang "sudah dipelajari" sesi ini, persis seperti aslinya
 * (Baileys tidak bisa menanyakan nomor sebuah LID ke server).
 */
class SoketPalsu {
  penangan = new Map<string, ((data: unknown) => void)[]>();
  user: { id?: string } | null = null;
  petaLid = new Map<string, string>();
  lidDitanyakan: string[][] = [];
  grup: Record<string, MetadataGrup> = {};
  grupDiminta = 0;
  mediaDiminta = 0;
  permintaanRiwayat: { jumlah: number; kunci: KunciPesanWhatsApp; waktu: number }[] = [];

  ev = {
    on: (nama: string, penangan: (data: unknown) => void) => {
      const daftar = this.penangan.get(nama) ?? [];
      daftar.push(penangan);
      this.penangan.set(nama, daftar);
    },
  };

  signalRepository = {
    lidMapping: {
      getPNsForLIDs: async (lids: string[]) => {
        this.lidDitanyakan.push(lids);
        const hasil = lids.flatMap((jid) => {
          const pn = this.petaLid.get(jid.split('@')[0].split(':')[0]);
          return pn ? [{ lid: jid, pn: `${pn}:0@s.whatsapp.net` }] : [];
        });
        return hasil.length > 0 ? hasil : null;
      },
    },
  };

  logout = async () => {};
  end = () => {};
  groupMetadata = async (jid: string) => ({ id: jid, subject: 'Tim Dapur' });
  groupFetchAllParticipating = async () => {
    this.grupDiminta += 1;
    return this.grup;
  };
  unduhMedia = async () => {
    this.mediaDiminta += 1;
    return Buffer.from('isi-berkas');
  };
  fetchMessageHistory = async (jumlah: number, kunci: KunciPesanWhatsApp, waktu: number) => {
    this.permintaanRiwayat.push({ jumlah, kunci, waktu });
    return 'permintaan-1';
  };

  pancarkan(nama: string, data: unknown) {
    for (const p of this.penangan.get(nama) ?? []) p(data);
  }
}

let soket: SoketPalsu;
let hrToken: string;
let accountId: string;

const pesan = (key: Record<string, unknown>, ubah: Record<string, unknown> = {}) => ({
  key: { fromMe: false, ...key },
  message: { conversation: 'Halo kak, pesanan saya sudah dikirim?' },
  messageTimestamp: 1789000000,
  ...ubah,
});

const terima = async (messages: unknown[], type = 'notify') => {
  soket.pancarkan('messages.upsert', { type, messages });
  await tungguEventSelesai();
};

const tersambung = async (siapkan?: (s: SoketPalsu) => void) => {
  const res = await request(app).post(`/api/whatsapp/accounts/${accountId}/connect`).set(auth(hrToken)).send({});
  expectStatus(res, 202);
  siapkan?.(soket);
  soket.user = { id: `${NOMOR_PERUSAHAAN}:5@s.whatsapp.net` };
  soket.pancarkan('connection.update', { connection: 'open' });
  await tungguEventSelesai();
};

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', nik: 'HR-1', role: Role.HR_ADMIN });
  hrToken = await login(app, 'hr@resto.id');
  const budi = await makeEmployee({ email: 'budi@resto.id', nik: 'EMP-1', name: 'Budi Kasir' });

  const akun = await request(app)
    .post('/api/whatsapp/accounts')
    .set(auth(hrToken))
    .send({ phoneNumber: '08111111111', label: 'CS Outlet Kemang', assignedEmployeeId: budi.id });
  expectStatus(akun, 201);
  accountId = akun.body.id;

  setPembuatSoket(async (): Promise<SesiDibuat> => {
    soket = new SoketPalsu();
    return { sock: soket, simpanKredensial: async () => {} };
  });
  (env as { WHATSAPP_BAILEYS_ENABLED: boolean }).WHATSAPP_BAILEYS_ENABLED = true;
});

afterEach(async () => {
  await shutdownSessions();
  setPembuatSoket(null);
  (env as { WHATSAPP_BAILEYS_ENABLED: boolean }).WHATSAPP_BAILEYS_ENABLED = false;
});

const baris = (externalMessageId: string) => prisma.whatsAppConversation.findFirstOrThrow({ where: { externalMessageId } });
const kontak = () =>
  prisma.whatsAppContact.findMany({
    where: { accountId },
    select: { number: true, lid: true, savedName: true, pushName: true, verifiedName: true },
    orderBy: { createdAt: 'asc' },
  });

describe('Arsip Baileys mengenali LID', () => {
  it('pesan ber-LID dengan nomor asli di sebelahnya tersimpan dengan nomor asli', async () => {
    await tersambung();

    await terima([
      pesan({ remoteJid: `${LID_SARI}@lid`, remoteJidAlt: `${NOMOR_SARI}@s.whatsapp.net`, id: 'A1' }, { pushName: 'Sari' }),
    ]);

    const b = await baris('A1');
    expect(b).toMatchObject({
      contactNumber: NOMOR_SARI,
      contactLid: LID_SARI,
      senderWhatsappNumber: NOMOR_SARI,
      receiverWhatsappNumber: NOMOR_PERUSAHAAN,
      senderName: 'Sari',
      direction: 'incoming',
    });
    // Pemetaannya dipelajari untuk semua nomor yang dipantau.
    expect(await prisma.whatsAppLidMap.findMany({ select: { lid: true, pn: true, source: true } })).toEqual([
      { lid: LID_SARI, pn: NOMOR_SARI, source: 'alt' },
    ]);
    expect(await kontak()).toEqual([
      { number: NOMOR_SARI, lid: LID_SARI, savedName: null, pushName: 'Sari', verifiedName: null },
    ]);
  });

  it('LID tanpa nomor diselesaikan dari store Baileys sesi, lalu disimpan permanen', async () => {
    await tersambung((s) => s.petaLid.set(LID_SARI, NOMOR_SARI));

    await terima([pesan({ remoteJid: `${LID_SARI}@lid`, id: 'A2' })]);

    expect(await baris('A2')).toMatchObject({ contactNumber: NOMOR_SARI, contactLid: LID_SARI });
    expect(await prisma.whatsAppLidMap.findUniqueOrThrow({ where: { lid: LID_SARI } })).toMatchObject({
      pn: NOMOR_SARI,
      source: 'authkey',
    });
    expect(soket.lidDitanyakan).toEqual([[`${LID_SARI}@lid`]]);
  });

  it('pemetaan yang sudah permanen dipakai tanpa bertanya ke store', async () => {
    await prisma.whatsAppLidMap.create({ data: { lid: LID_SARI, pn: NOMOR_SARI, source: 'grup' } });
    await tersambung();

    await terima([pesan({ remoteJid: `${LID_SARI}:12@lid`, id: 'A3' })]);

    expect(await baris('A3')).toMatchObject({ contactNumber: NOMOR_SARI, contactLid: LID_SARI });
    expect(soket.lidDitanyakan).toEqual([]);
  });

  it('LID yang belum dikenal tetap diarsipkan dan ditandai, namanya tetap tercatat', async () => {
    await tersambung();

    await terima([pesan({ remoteJid: `${LID_SARI}@lid`, id: 'A4' }, { pushName: 'Sari' })]);

    expect(await baris('A4')).toMatchObject({ contactNumber: LID_SARI, contactLid: LID_SARI, senderName: 'Sari' });
    expect(await kontak()).toEqual([{ number: null, lid: LID_SARI, savedName: null, pushName: 'Sari', verifiedName: null }]);

    // Begitu nomornya terlihat, baris LID-saja itu mendapat nomornya — bukan
    // baris kontak kedua untuk orang yang sama.
    await terima([
      pesan({ remoteJid: `${LID_SARI}@lid`, remoteJidAlt: `${NOMOR_SARI}@s.whatsapp.net`, id: 'A5' }, { pushName: 'Sari W.' }),
    ]);
    expect(await kontak()).toEqual([
      { number: NOMOR_SARI, lid: LID_SARI, savedName: null, pushName: 'Sari W.', verifiedName: null },
    ]);
  });

  it('pesan grup: pengirim ber-LID diganti nomor aslinya, namanya tercatat', async () => {
    await tersambung();

    await terima([
      pesan(
        { remoteJid: GRUP, participant: `${LID_ANDI}@lid`, participantAlt: `${NOMOR_ANDI}@s.whatsapp.net`, id: 'G1' },
        { pushName: 'Andi' }
      ),
    ]);

    expect(await baris('G1')).toMatchObject({
      contactNumber: '12036301234567890',
      participantNumber: NOMOR_ANDI,
      participantLid: LID_ANDI,
      senderWhatsappNumber: NOMOR_ANDI,
      senderName: 'Andi',
      groupName: 'Tim Dapur',
    });
    expect(await kontak()).toEqual([{ number: NOMOR_ANDI, lid: LID_ANDI, savedName: null, pushName: 'Andi', verifiedName: null }]);
  });

  it('riwayat: pengirim grup di field participant dan kontak dari ponsel ikut terbaca', async () => {
    await tersambung();

    soket.pancarkan('messaging-history.set', {
      contacts: [
        { id: `${LID_ANDI}@lid`, phoneNumber: `${NOMOR_ANDI}@s.whatsapp.net`, name: 'Andi Dapur' },
        { id: GRUP, name: 'Tim Dapur' },
      ],
      messages: [
        pesan({ remoteJid: GRUP, id: 'H1' }, { participant: `${LID_ANDI}@lid`, pushName: 'Andi' }),
        pesan({ remoteJid: '120363111111111111@newsletter', id: 'N1' }),
      ],
    });
    await tungguEventSelesai();

    expect(await baris('H1')).toMatchObject({ participantNumber: NOMOR_ANDI, participantLid: LID_ANDI });
    expect(await prisma.whatsAppConversation.count({ where: { externalMessageId: 'N1' } })).toBe(0);
    expect(await prisma.whatsAppLidMap.findUniqueOrThrow({ where: { lid: LID_ANDI } })).toMatchObject({
      pn: NOMOR_ANDI,
      source: 'riwayat',
    });
    expect(await kontak()).toEqual([
      { number: NOMOR_ANDI, lid: LID_ANDI, savedName: 'Andi Dapur', pushName: 'Andi', verifiedName: null },
    ]);
  });

  it('nama dari riwayat tidak menimpa nama terbaru, nama dari pesan baru menimpa', async () => {
    await tersambung();
    await terima([pesan({ remoteJid: `${NOMOR_SARI}@s.whatsapp.net`, id: 'B1' }, { pushName: 'Sari Baru' })]);

    soket.pancarkan('messaging-history.set', {
      messages: [pesan({ remoteJid: `${NOMOR_SARI}@s.whatsapp.net`, id: 'B0' }, { pushName: 'Sari Lama', messageTimestamp: 1700000000 })],
    });
    await tungguEventSelesai();
    expect((await kontak())[0].pushName).toBe('Sari Baru');

    await terima([pesan({ remoteJid: `${NOMOR_SARI}@s.whatsapp.net`, id: 'B2' }, { pushName: 'Sari Terbaru' })]);
    expect((await kontak())[0].pushName).toBe('Sari Terbaru');
  });

  it('contacts.upsert dan contacts.update menyatu ke satu baris per orang', async () => {
    await tersambung();
    soket.petaLid.clear();
    await terima([pesan({ remoteJid: `${NOMOR_SARI}@s.whatsapp.net`, id: 'C0' })]);
    await terima([pesan({ remoteJid: `${LID_SARI}@lid`, id: 'C1' }, { pushName: 'Sari' })]);
    soket.pancarkan('contacts.upsert', [{ id: `${NOMOR_SARI}@s.whatsapp.net`, name: 'Bu Sari Catering' }]);
    await tungguEventSelesai();
    // Dua orang menurut arsip: LID-saja dan bernomor.
    expect(await prisma.whatsAppContact.count()).toBe(2);

    // Kontak yang menyebut keduanya menggabungkan barisnya.
    soket.pancarkan('contacts.update', [{ id: `${LID_SARI}@lid`, phoneNumber: `${NOMOR_SARI}@s.whatsapp.net`, notify: 'Sari' }]);
    await tungguEventSelesai();

    expect(await kontak()).toEqual([
      { number: NOMOR_SARI, lid: LID_SARI, savedName: 'Bu Sari Catering', pushName: 'Sari', verifiedName: null },
    ]);
    expect(await prisma.whatsAppLidMap.findUniqueOrThrow({ where: { lid: LID_SARI } })).toMatchObject({ source: 'kontak' });
  });

  it('nama dari buku kontak hanya disimpan untuk orang yang ada di arsip', async () => {
    // Buku kontak ponsel pribadi berisi banyak orang yang tidak pernah muncul
    // di percakapan yang dipantau; nama mereka tidak ikut dikumpulkan.
    await tersambung();
    await terima([pesan({ remoteJid: `${NOMOR_SARI}@s.whatsapp.net`, id: 'K1' })]);
    soket.pancarkan('contacts.upsert', [
      { id: `${NOMOR_SARI}@s.whatsapp.net`, name: 'Bu Sari Catering' },
      { id: '628777777777@s.whatsapp.net', name: 'Tante Rina' },
      { id: '219999999999999@lid', phoneNumber: '628666666666@s.whatsapp.net', name: 'Dokter Gigi' },
    ]);
    await tungguEventSelesai();

    expect(await kontak()).toEqual([{ number: NOMOR_SARI, lid: null, savedName: 'Bu Sari Catering', pushName: null, verifiedName: null }]);
    // Pasangan nomor<->LID tetap dipelajari (untuk mengenali pengirim pesan berikutnya), tanpa nama.
    expect(await prisma.whatsAppLidMap.findUnique({ where: { lid: '219999999999999' } })).toMatchObject({ pn: '628666666666' });
  });

  it('baris bernomor lain yang memegang LID itu tidak ikut digabung atau dihapus', async () => {
    // Pengguna ganti nomor: LID-nya masih melekat pada baris nomor lamanya.
    await tersambung();
    await terima([pesan({ remoteJid: `${NOMOR_SARI}@s.whatsapp.net`, id: 'G0' })]);
    await prisma.whatsAppContact.createMany({
      data: [
        { id: generateULID(), accountId, number: '628999999999', lid: LID_SARI, pushName: 'Sari lama' },
        { id: generateULID(), accountId, number: NOMOR_SARI, savedName: 'Bu Sari' },
      ],
    });

    soket.pancarkan('contacts.update', [{ id: `${LID_SARI}@lid`, phoneNumber: `${NOMOR_SARI}@s.whatsapp.net`, notify: 'Sari' }]);
    await tungguEventSelesai();

    expect(await prisma.whatsAppContact.count()).toBe(2);
    expect(await kontak()).toEqual(
      expect.arrayContaining([
        { number: '628999999999', lid: LID_SARI, savedName: null, pushName: 'Sari lama', verifiedName: null },
        { number: NOMOR_SARI, lid: null, savedName: 'Bu Sari', pushName: 'Sari', verifiedName: null },
      ])
    );
  });

  it('nama nomor yang dipantau sendiri tidak dicatat sebagai kontak', async () => {
    await tersambung();
    soket.pancarkan('contacts.upsert', [{ id: `${NOMOR_PERUSAHAAN}@s.whatsapp.net`, name: 'Saya' }]);
    await tungguEventSelesai();
    expect(await prisma.whatsAppContact.count()).toBe(0);
  });

  it('pesan yang datang lagi menambal pengirim yang dulu kosong dan LID yang kini dikenal', async () => {
    await tersambung();
    soket.petaLid.clear();
    // Dulu: pengirim grup tidak tercatat, dan chat pribadi hanya dikenal LID-nya.
    await terima([
      pesan({ remoteJid: GRUP, id: 'D1' }, { message: { imageMessage: { mimetype: 'image/jpeg' } } }),
      pesan({ remoteJid: `${LID_SARI}@lid`, id: 'D2' }),
    ]);
    expect(await baris('D1')).toMatchObject({ participantNumber: null, senderWhatsappNumber: '12036301234567890' });
    expect(await baris('D2')).toMatchObject({ contactNumber: LID_SARI, contactLid: LID_SARI });
    const mediaAwal = soket.mediaDiminta;

    // Ditarik ulang lewat riwayat: kini pengirim dan nomornya diketahui.
    soket.pancarkan('messaging-history.set', {
      messages: [
        pesan(
          { remoteJid: GRUP, id: 'D1' },
          { participant: `${NOMOR_ANDI}@s.whatsapp.net`, pushName: 'Andi', message: { imageMessage: { mimetype: 'image/jpeg' } } }
        ),
      ],
    });
    await tungguEventSelesai();
    await terima([pesan({ remoteJid: `${LID_SARI}@lid`, remoteJidAlt: `${NOMOR_SARI}@s.whatsapp.net`, id: 'D2' }, { pushName: 'Sari' })], 'append');

    expect(await prisma.whatsAppConversation.count()).toBe(2);
    expect(await baris('D1')).toMatchObject({
      participantNumber: NOMOR_ANDI,
      senderWhatsappNumber: NOMOR_ANDI,
      senderName: 'Andi',
    });
    expect(await baris('D2')).toMatchObject({
      contactNumber: NOMOR_SARI,
      contactLid: LID_SARI,
      senderWhatsappNumber: NOMOR_SARI,
      senderName: 'Sari',
    });
    // Berkas pesan yang sudah diarsipkan tidak diunduh ulang.
    expect(soket.mediaDiminta).toBe(mediaAwal);
  });

  it('daftar grup dibaca saat tersambung untuk mempelajari LID peserta, paling sering sekali per 6 jam', async () => {
    await tersambung((s) => {
      s.grup = {
        [GRUP]: {
          id: GRUP,
          subject: 'Tim Dapur Kemang',
          participants: [
            { id: `${LID_ANDI}@lid`, phoneNumber: `${NOMOR_ANDI}@s.whatsapp.net` },
            { id: `${NOMOR_SARI}@s.whatsapp.net`, lid: `${LID_SARI}@lid` },
            { id: '99999999999999@lid' },
          ],
        },
      };
    });

    expect(soket.grupDiminta).toBe(1);
    expect(
      await prisma.whatsAppLidMap.findMany({ select: { lid: true, pn: true, source: true }, orderBy: { lid: 'asc' } })
    ).toEqual([
      { lid: LID_SARI, pn: NOMOR_SARI, source: 'grup' },
      { lid: LID_ANDI, pn: NOMOR_ANDI, source: 'grup' },
    ]);

    // Nama grupnya sekalian dipakai untuk pesan berikutnya.
    await terima([pesan({ remoteJid: GRUP, participant: `${LID_ANDI}@lid`, id: 'G9' })]);
    expect(await baris('G9')).toMatchObject({ groupName: 'Tim Dapur Kemang', participantNumber: NOMOR_ANDI });

    // Sambung ulang tak lama kemudian tidak meminta daftar grup lagi.
    soket.pancarkan('connection.update', { connection: 'open' });
    await tungguEventSelesai();
    expect(soket.grupDiminta).toBe(1);
  });

  it('grup ganti nama dan peserta baru ikut dipelajari dari event grup', async () => {
    await tersambung();
    await terima([pesan({ remoteJid: GRUP, participant: `${NOMOR_ANDI}@s.whatsapp.net`, id: 'E1' })]);
    expect((await baris('E1')).groupName).toBe('Tim Dapur');

    soket.pancarkan('groups.update', [{ id: GRUP, subject: 'Dapur Pusat' }]);
    soket.pancarkan('group-participants.update', {
      id: GRUP,
      author: `${NOMOR_ANDI}@s.whatsapp.net`,
      participants: [{ id: `${LID_SARI}@lid`, phoneNumber: `${NOMOR_SARI}@s.whatsapp.net` }],
      action: 'add',
    });
    await tungguEventSelesai();

    await terima([pesan({ remoteJid: GRUP, participant: `${LID_SARI}@lid`, id: 'E2' })]);
    expect(await baris('E2')).toMatchObject({ groupName: 'Dapur Pusat', participantNumber: NOMOR_SARI, participantLid: LID_SARI });
  });
});

describe('Pemulihan arsip lama yang menyimpan LID sebagai nomor', () => {
  const LID_ASING = '123456789012345';
  const LID_ASING_GRUP = '55555555555555';

  const simpan = (data: Record<string, unknown>) =>
    prisma.whatsAppConversation.create({
      data: {
        id: generateULID(),
        accountId,
        externalMessageId: `x-${generateULID()}`,
        senderWhatsappNumber: NOMOR_SARI,
        receiverWhatsappNumber: NOMOR_PERUSAHAAN,
        contactNumber: NOMOR_SARI,
        messageBody: encryptField('pesan lama'),
        searchTokens: [],
        messageType: 'text',
        timestamp: new Date('2026-09-20T10:00:00.000Z'),
        direction: 'incoming',
        ...data,
      },
    });

  const lama = async () => {
    // Pemetaan yang sudah ada di store Baileys sebelum pencerminan dipasang.
    await prisma.whatsAppAuthKey.create({
      data: {
        id: generateULID(),
        accountId,
        category: 'lid-mapping',
        keyId: `${LID_SARI}_reverse`,
        value: encryptField(JSON.stringify(NOMOR_SARI)),
      },
    });
    await prisma.whatsAppAuthKey.create({
      data: { id: generateULID(), accountId, category: 'lid-mapping', keyId: NOMOR_ANDI, value: encryptField(JSON.stringify(LID_ANDI)) },
    });

    // Chat pribadi Sari, dua-duanya tercatat dengan LID.
    await simpan({ externalMessageId: 'P1', contactNumber: LID_SARI, senderWhatsappNumber: LID_SARI });
    await simpan({
      externalMessageId: 'P2',
      contactNumber: LID_SARI,
      senderWhatsappNumber: NOMOR_PERUSAHAAN,
      receiverWhatsappNumber: LID_SARI,
      direction: 'outgoing',
    });
    // Chat dengan LID yang tidak dikenal siapa pun.
    await simpan({ externalMessageId: 'P3', contactNumber: LID_ASING, senderWhatsappNumber: LID_ASING });
    // Chat bernomor biasa: tidak boleh tersentuh.
    await simpan({ externalMessageId: 'P4' });

    const grup = { groupJid: GRUP, contactNumber: '12036301234567890', receiverWhatsappNumber: '12036301234567890' };
    await simpan({ ...grup, externalMessageId: 'G1', participantNumber: LID_ANDI, senderWhatsappNumber: LID_ANDI });
    await simpan({ ...grup, externalMessageId: 'G2', participantNumber: LID_ASING_GRUP, senderWhatsappNumber: LID_ASING_GRUP });
    await simpan({ ...grup, externalMessageId: 'G3', participantNumber: null, senderWhatsappNumber: '12036301234567890' });

    // Kontak: Sari tercatat dua kali (LID-saja dan bernomor), Andi LID-saja.
    await prisma.whatsAppContact.create({ data: { id: generateULID(), accountId, lid: LID_SARI, pushName: 'Sari' } });
    await prisma.whatsAppContact.create({ data: { id: generateULID(), accountId, number: NOMOR_SARI, savedName: 'Bu Sari' } });
    await prisma.whatsAppContact.create({ data: { id: generateULID(), accountId, lid: LID_ANDI, pushName: 'Andi' } });
  };

  it('mengganti LID yang dikenal dengan nomor asli dan menandai sisanya', async () => {
    await lama();

    const hasil = await pulihkanLid({ penuh: true });

    expect(hasil).toMatchObject({
      pemetaan: { dibaca: 2, tersimpan: 2, konflik: 0, dilewati: 0 },
      pribadiDiselesaikan: 2,
      grupDiselesaikan: 1,
      pribadiDitandai: 1,
      grupDitandai: 1,
      kontakDigabung: 1,
      kontakDiberiNomor: 1,
    });

    expect(await baris('P1')).toMatchObject({ contactNumber: NOMOR_SARI, contactLid: LID_SARI, senderWhatsappNumber: NOMOR_SARI });
    expect(await baris('P2')).toMatchObject({
      contactNumber: NOMOR_SARI,
      contactLid: LID_SARI,
      senderWhatsappNumber: NOMOR_PERUSAHAAN,
      receiverWhatsappNumber: NOMOR_SARI,
    });
    expect(await baris('P3')).toMatchObject({ contactNumber: LID_ASING, contactLid: LID_ASING });
    expect(await baris('P4')).toMatchObject({ contactNumber: NOMOR_SARI, contactLid: null });
    expect(await baris('G1')).toMatchObject({ participantNumber: NOMOR_ANDI, participantLid: LID_ANDI, senderWhatsappNumber: NOMOR_ANDI });
    expect(await baris('G2')).toMatchObject({ participantNumber: LID_ASING_GRUP, participantLid: LID_ASING_GRUP });
    expect(await baris('G3')).toMatchObject({ participantNumber: null, participantLid: null });

    expect(await kontak()).toEqual(
      expect.arrayContaining([
        { number: NOMOR_SARI, lid: LID_SARI, savedName: 'Bu Sari', pushName: 'Sari', verifiedName: null },
        { number: NOMOR_ANDI, lid: LID_ANDI, savedName: null, pushName: 'Andi', verifiedName: null },
      ])
    );
    expect(await prisma.whatsAppContact.count()).toBe(2);
  });

  it('aman dijalankan dua kali, dan LID yang ditandai diselesaikan begitu pemetaannya muncul', async () => {
    await lama();
    await pulihkanLid({ penuh: true });

    const kedua = await pulihkanLid({ penuh: true });
    expect(kedua).toMatchObject({
      pemetaan: { tersimpan: 0 },
      pribadiDiselesaikan: 0,
      grupDiselesaikan: 0,
      pribadiDitandai: 0,
      grupDitandai: 0,
      kontakDigabung: 0,
      kontakDiberiNomor: 0,
    });

    // Pemetaan baru dipelajari belakangan (mis. dari daftar peserta grup).
    await prisma.whatsAppLidMap.create({ data: { lid: LID_ASING, pn: '628777777777', source: 'grup' } });
    const ketiga = await pulihkanLid({ penuh: true });
    expect(ketiga.pribadiDiselesaikan).toBe(1);
    expect(await baris('P3')).toMatchObject({ contactNumber: '628777777777', contactLid: LID_ASING, senderWhatsappNumber: '628777777777' });
  });
});
