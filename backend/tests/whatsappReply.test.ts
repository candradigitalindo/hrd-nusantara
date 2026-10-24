import { createHmac } from 'crypto';
import request from 'supertest';
import { Role } from '@prisma/client';
import { prisma, resetDatabase, makeEmployee } from './helpers/db';
import { bikinApp } from './helpers/app';
import { auth, login, expectStatus } from './helpers/api';
import { generateULID } from '../src/utils/generateULID';
import { decryptField } from '../src/utils/fieldCrypto';
import { env } from '../src/config/env';
import { ingestMessage } from '../src/services/whatsapp/ingest';
import { normalizeBaileysMessage, type KunciBaileys } from '../src/services/whatsapp/baileysMessage';

const app = bikinApp();
const SENDIRI = '628111111111';
const KONTAK = '628222222222';
let accountId: string;
let token: string;

beforeEach(async () => {
  await resetDatabase();
  await makeEmployee({ email: 'hr@resto.id', role: Role.HR_ADMIN });
  token = await login(app, 'hr@resto.id');
  const budi = await makeEmployee({ name: 'Budi Kasir' });
  const akun = await prisma.whatsAppAccount.create({ data: {
    id: generateULID(), phoneNumber: SENDIRI, label: 'CS Kemang', assignedEmployeeId: budi.id,
  } });
  accountId = akun.id;
});

const normalisasi = (id: string, message: Record<string, unknown>, key: KunciBaileys = {}) => {
  const hasil = normalizeBaileysMessage({
    key: { id, remoteJid: `${KONTAK}@s.whatsapp.net`, fromMe: false, ...key },
    message,
    pushName: 'Sari',
    messageTimestamp: id === 'asal' ? 1789000000 : 1789000060,
  }, SENDIRI);
  if (hasil.status !== 'ok') throw new Error('Pesan harus dapat dibaca');
  return hasil.pesan;
};

const balasan = (contextInfo: Record<string, unknown>) => normalisasi('balasan', {
  extendedTextMessage: { text: 'Ya, untuk empat orang', contextInfo },
});

const bacaArsip = (query: Record<string, string> = {}) => request(app)
  .get('/api/whatsapp/conversations').set(auth(token))
  .query({ accountId, contactNumber: KONTAK, ...query });

it('menyimpan kutipan terenkripsi dan menampilkan pengirim walau pesan asal belum diarsipkan', async () => {
  await ingestMessage(balasan({
    stanzaId: 'asal', participant: `${SENDIRI}@s.whatsapp.net`,
    quotedMessage: { conversation: 'Reservasi untuk empat orang?' },
  }), { accountId });
  const tersimpan = await prisma.whatsAppConversation.findFirstOrThrow();
  expect(tersimpan.quotedMessageBody).toMatch(/^v1\./);
  expect(tersimpan.quotedMessageBody).not.toContain('Reservasi');
  expect(decryptField(tersimpan.quotedMessageBody!)).toBe('Reservasi untuk empat orang?');

  const res = await bacaArsip();
  expectStatus(res, 200);
  expect(res.body.data[0]).toMatchObject({
    messageBody: 'Ya, untuk empat orang',
    quotedMessage: {
      externalMessageId: 'asal', messageBody: 'Reservasi untuk empat orang?', messageType: 'text',
      pengirim: { nama: 'Budi Kasir', nomor: SENDIRI },
    },
  });
  expect(res.body.data[0]).not.toHaveProperty('quotedMessageBody');
});

it('mengambil pesan asal pada halaman lain ketika WhatsApp hanya menyertakan ID balasan', async () => {
  await ingestMessage(normalisasi('asal', { conversation: 'Tolong siapkan meja dekat jendela' }), { accountId });
  await ingestMessage(balasan({ stanzaId: 'asal' }), { accountId });
  const res = await bacaArsip({ limit: '1' });
  expectStatus(res, 200);
  expect(res.body.pagination.total).toBe(2);
  expect(res.body.data).toHaveLength(1);
  expect(res.body.data[0].quotedMessage).toMatchObject({
    messageBody: 'Tolong siapkan meja dekat jendela', messageType: 'text',
    pengirim: { nama: 'Sari', nomor: KONTAK },
  });
});

it('tidak mengambil isi pesan dari chat atau akun lain yang memakai ID pesan asal yang sama', async () => {
  const lain = normalisasi('asal', { conversation: 'Isi rahasia chat lain' }, { remoteJid: '628333333333@s.whatsapp.net' });
  await ingestMessage(lain, { accountId });
  const akunLain = await prisma.whatsAppAccount.create({ data: {
    id: generateULID(), phoneNumber: '628444444444', label: 'Nomor lain',
  } });
  await ingestMessage({
    ...normalisasi('asal', { conversation: 'Isi rahasia akun lain' }), to: '628444444444',
  }, { accountId: akunLain.id });
  await ingestMessage(balasan({ stanzaId: 'asal' }), { accountId });
  const res = await bacaArsip();
  expectStatus(res, 200);
  expect(res.body.data[0].quotedMessage).toEqual({
    externalMessageId: 'asal', messageBody: null, messageType: null, pengirim: null,
  });
  expect(JSON.stringify(res.body)).not.toContain('rahasia');
});

it.each([false, true])('melengkapi kutipan pada sinkronisasi ulang, penanda lama ada: %s', async (adaPenanda) => {
  await ingestMessage(adaPenanda ? balasan({ stanzaId: 'asal' }) : normalisasi('balasan', {
    conversation: 'Ya, untuk empat orang',
  }), { accountId });
  const lengkap = balasan({ stanzaId: 'asal', participant: `${KONTAK}@s.whatsapp.net`,
    quotedMessage: { imageMessage: { caption: 'Denah meja' } },
  });
  expect(await ingestMessage(lengkap, { accountId, sudahAda: true })).toMatchObject({
    status: 'duplikat', ditambal: true,
  });
  expect(await prisma.whatsAppConversation.count()).toBe(1);
  const res = await bacaArsip();
  expect(res.body.data[0].quotedMessage).toMatchObject({ messageBody: 'Denah meja', messageType: 'image' });

  await ingestMessage({ ...lengkap, quotedMessage: { ...lengkap.quotedMessage!, body: 'Isi berubah' } }, { accountId });
  const sesudah = await bacaArsip();
  expect(sesudah.body.data[0].quotedMessage.messageBody).toBe('Denah meja');
});

it('menerima kutipan melalui webhook dan membakukan nomor pengirim', async () => {
  const body = JSON.stringify({
    event: 'message', messageId: 'webhook-reply', from: KONTAK, to: SENDIRI,
    body: 'Baik', timestamp: '2026-09-15T10:00:00.000Z',
    quotedMessage: { externalMessageId: 'asal', body: 'invoice.pdf', type: 'document', senderNumber: '08111111111' },
  });
  const res = await request(app).post('/api/webhook/bellys').set('Content-Type', 'application/json')
    .set('x-bellys-signature', createHmac('sha256', env.BELLYS_WEBHOOK_SECRET!).update(body).digest('hex')).send(body);
  expectStatus(res, 201);
  const arsip = await bacaArsip();
  expect(arsip.body.data[0].quotedMessage).toMatchObject({
    messageBody: 'invoice.pdf', messageType: 'document', pengirim: { nomor: SENDIRI },
  });
});

it('kutipan grup mengikuti pembatasan grup dan tidak menampilkan LID sebagai nomor telepon', async () => {
  const groupJid = '12036301234567890@g.us';
  const pesan = normalisasi('balasan', { extendedTextMessage: { text: 'Baik', contextInfo: {
    stanzaId: 'asal', participant: '214751418265748@lid', quotedMessage: { audioMessage: {} },
  } } }, { remoteJid: groupJid, participant: `${KONTAK}@s.whatsapp.net` });
  await ingestMessage(pesan, { accountId });
  const hr = await bacaArsip({ contactNumber: '12036301234567890', groupJid });
  expectStatus(hr, 200);
  expect(hr.body.data).toEqual([]);

  await makeEmployee({ email: 'admin@resto.id', role: Role.SUPER_ADMIN });
  token = await login(app, 'admin@resto.id');
  const admin = await bacaArsip({ contactNumber: '12036301234567890', groupJid });
  expectStatus(admin, 200);
  expect(admin.body.data[0].quotedMessage).toMatchObject({
    messageBody: '', messageType: 'audio', pengirim: { nomor: null, lid: '214751418265748' },
  });
});

it('pesan biasa tidak memiliki kutipan', async () => {
  await ingestMessage(normalisasi('biasa', { conversation: 'Halo' }), { accountId });
  const res = await bacaArsip();
  expectStatus(res, 200);
  expect(res.body.data[0].quotedMessage).toBeNull();
});
