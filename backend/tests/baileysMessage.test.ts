import {
  nomorDariJid,
  isiDariPesan,
  waktuDariTimestamp,
  normalizeBaileysMessage,
} from '../src/services/whatsapp/baileysMessage';
import { putuskanReconnect, ALASAN_PUTUS, MAKS_PERCOBAAN } from '../src/services/whatsapp/reconnect';

const NOMOR_SENDIRI = '628111111111';

describe('Membaca JID WhatsApp', () => {
  it('mengambil nomor dari JID biasa', () => {
    expect(nomorDariJid('628222222222@s.whatsapp.net')).toBe('628222222222');
  });

  it('membuang nomor perangkat pada JID multi-perangkat', () => {
    // "628222222222:12@s.whatsapp.net" — angka setelah titik dua adalah
    // nomor perangkat, bukan bagian dari nomor telepon. Ikut terbawa,
    // nomornya tidak akan pernah cocok dengan daftar nomor perusahaan.
    expect(nomorDariJid('628222222222:12@s.whatsapp.net')).toBe('628222222222');
  });

  it('mengembalikan null kalau tidak ada angka sama sekali', () => {
    expect(nomorDariJid('status@broadcast')).toBeNull();
  });
});

describe('Mengambil isi pesan', () => {
  it('membaca pesan teks biasa', () => {
    expect(isiDariPesan({ conversation: 'halo' })).toEqual({ body: 'halo', type: 'text' });
  });

  it('membaca pesan teks dengan kutipan atau tautan', () => {
    expect(isiDariPesan({ extendedTextMessage: { text: 'lihat ini' } })).toEqual({
      body: 'lihat ini',
      type: 'text',
    });
  });

  it('menyertakan keterangan berkas gambar supaya bisa diunduh', () => {
    expect(isiDariPesan({ imageMessage: { caption: 'struk pembayaran', mimetype: 'image/jpeg' } })).toEqual({
      body: 'struk pembayaran',
      type: 'image',
      media: { mimeType: 'image/jpeg', fileName: null },
    });
  });

  it('memakai nama berkas kalau dokumen tanpa keterangan', () => {
    expect(
      isiDariPesan({ documentMessage: { fileName: 'invoice-9921.pdf', mimetype: 'application/pdf' } })
    ).toEqual({
      body: 'invoice-9921.pdf',
      type: 'document',
      media: { mimeType: 'application/pdf', fileName: 'invoice-9921.pdf' },
    });
  });

  it('pesan suara tidak punya teks, jadi berkasnya yang menjadi isinya', () => {
    expect(isiDariPesan({ audioMessage: { seconds: 5, mimetype: 'audio/ogg; codecs=opus' } })).toEqual({
      body: '',
      type: 'audio',
      media: { mimeType: 'audio/ogg; codecs=opus', fileName: null },
    });
    expect(isiDariPesan({ pttMessage: {} })).toEqual({
      body: '',
      type: 'audio',
      media: { mimeType: 'audio/ogg', fileName: null },
    });
  });

  it('video membawa keterangan berkasnya juga', () => {
    expect(isiDariPesan({ videoMessage: { mimetype: 'video/mp4' } })).toEqual({
      body: '',
      type: 'video',
      media: { mimeType: 'video/mp4', fileName: null },
    });
  });

  it('melewatkan yang bukan percakapan', () => {
    expect(isiDariPesan({ stickerMessage: {} })).toBeNull();
    expect(isiDariPesan({ reactionMessage: {} })).toBeNull();
    expect(isiDariPesan({ protocolMessage: {} })).toBeNull();
    expect(isiDariPesan(null)).toBeNull();
  });
});

describe('Membaca waktu pesan', () => {
  it('menerima detik sebagai angka', () => {
    expect(waktuDariTimestamp(1789000000)).toEqual(new Date(1789000000 * 1000));
  });

  it('menerima detik sebagai string', () => {
    expect(waktuDariTimestamp('1789000000')).toEqual(new Date(1789000000 * 1000));
  });

  it('menerima Long dari protobuf', () => {
    // protobufjs mengembalikan objek Long untuk angka 64-bit, bukan number.
    expect(waktuDariTimestamp({ toNumber: () => 1789000000 })).toEqual(
      new Date(1789000000 * 1000)
    );
  });
});

describe('Menerjemahkan pesan Baileys', () => {
  const mentah = (ubah: Record<string, unknown> = {}) => ({
    key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: false, id: 'ABC123' },
    message: { conversation: 'Mau pesan tempat' },
    messageTimestamp: 1789000000,
    ...ubah,
  });

  it('menandai pesan masuk dari pelanggan', () => {
    const hasil = normalizeBaileysMessage(mentah(), NOMOR_SENDIRI);

    expect(hasil.status).toBe('ok');
    if (hasil.status !== 'ok') return;
    expect(hasil.pesan.from).toBe('628222222222');
    expect(hasil.pesan.to).toBe(NOMOR_SENDIRI);
    expect(hasil.pesan.body).toBe('Mau pesan tempat');
    expect(hasil.pesan.externalMessageId).toBe('ABC123');
  });

  it('membalik pengirim dan penerima untuk pesan yang kita kirim', () => {
    // Baileys hanya menyebut lawan bicara dan penanda fromMe; arah pesan
    // harus disimpulkan. Terbalik di sini berarti seluruh arsip salah arah.
    const hasil = normalizeBaileysMessage(
      mentah({ key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: true, id: 'ABC123' } }),
      NOMOR_SENDIRI
    );

    expect(hasil.status).toBe('ok');
    if (hasil.status !== 'ok') return;
    expect(hasil.pesan.from).toBe(NOMOR_SENDIRI);
    expect(hasil.pesan.to).toBe('628222222222');
  });

  it('mengarsipkan pesan grup beserta peserta yang mengirimnya', () => {
    const hasil = normalizeBaileysMessage(
      mentah({
        key: {
          remoteJid: '12036301234567890@g.us',
          fromMe: false,
          id: 'G1',
          participant: '628333333333@s.whatsapp.net',
        },
      }),
      NOMOR_SENDIRI
    );

    expect(hasil.status).toBe('ok');
    if (hasil.status !== 'ok') return;
    // Lawan bicaranya adalah grup; yang menulis disimpan terpisah supaya
    // tetap terlihat siapa berkata apa di dalamnya.
    expect(hasil.pesan.grup).toEqual({
      jid: '12036301234567890@g.us',
      kunci: '12036301234567890',
      participantNumber: '628333333333',
    });
    expect(hasil.pesan.from).toBe('628333333333');
    expect(hasil.pesan.to).toBe('12036301234567890');
  });

  it('pesan grup yang kita kirim sendiri tercatat atas nama nomor ini', () => {
    const hasil = normalizeBaileysMessage(
      mentah({ key: { remoteJid: '12036301234567890@g.us', fromMe: true, id: 'G2' } }),
      NOMOR_SENDIRI
    );

    expect(hasil.status).toBe('ok');
    if (hasil.status !== 'ok') return;
    expect(hasil.pesan.from).toBe(NOMOR_SENDIRI);
    expect(hasil.pesan.grup?.participantNumber).toBe(NOMOR_SENDIRI);
  });

  it('melewatkan status dan siaran', () => {
    expect(
      normalizeBaileysMessage(
        mentah({ key: { remoteJid: 'status@broadcast', fromMe: false, id: 'S1' } }),
        NOMOR_SENDIRI
      )
    ).toEqual({ status: 'dilewati', alasan: 'siaran' });
  });

  it('melewatkan pesan tanpa id', () => {
    // Tanpa id tidak ada kunci untuk menolak pengiriman ganda.
    const hasil = normalizeBaileysMessage(
      mentah({ key: { remoteJid: '628222222222@s.whatsapp.net', fromMe: false, id: null } }),
      NOMOR_SENDIRI
    );

    expect(hasil).toEqual({ status: 'dilewati', alasan: 'tanpa_id' });
  });

  it('melewatkan jenis yang bukan percakapan', () => {
    const hasil = normalizeBaileysMessage(mentah({ message: { stickerMessage: {} } }), NOMOR_SENDIRI);

    expect(hasil).toEqual({ status: 'dilewati', alasan: 'jenis_tidak_didukung' });
  });
});

describe('Kebijakan sambung ulang', () => {
  it('berhenti dan meminta scan ulang saat sesi di-logout', () => {
    const k = putuskanReconnect(ALASAN_PUTUS.loggedOut, 0);

    expect(k.sambungUlang).toBe(false);
    expect(k.perluScanUlang).toBe(true);
  });

  it('tidak menyambung ulang saat sesi diambil alih perangkat lain', () => {
    // Kalau tetap disambung ulang, dua sesi akan saling menendang tanpa henti.
    const k = putuskanReconnect(ALASAN_PUTUS.connectionReplaced, 0);

    expect(k.sambungUlang).toBe(false);
    expect(k.perluScanUlang).toBe(false);
  });

  it('menyambung ulang segera saat WhatsApp meminta restart', () => {
    const k = putuskanReconnect(ALASAN_PUTUS.restartRequired, 3);

    expect(k.sambungUlang).toBe(true);
    expect(k.jedaMs).toBe(0);
  });

  it('menyambung ulang gangguan jaringan dengan jeda yang melebar', () => {
    // Menyambung ulang tanpa jeda yang melebar akan membanjiri server
    // WhatsApp saat jaringan sedang bermasalah.
    expect(putuskanReconnect(ALASAN_PUTUS.connectionClosed, 0).jedaMs).toBe(1000);
    expect(putuskanReconnect(ALASAN_PUTUS.connectionClosed, 1).jedaMs).toBe(2000);
    expect(putuskanReconnect(ALASAN_PUTUS.timedOut, 3).jedaMs).toBe(8000);
  });

  it('membatasi jeda supaya tidak tumbuh tanpa batas', () => {
    expect(putuskanReconnect(ALASAN_PUTUS.connectionClosed, 9).jedaMs).toBe(60000);
  });

  it('menyerah setelah batas percobaan', () => {
    // Mencoba selamanya membuat nomor yang benar-benar bermasalah tidak
    // pernah terlihat sebagai butuh penanganan manual.
    const k = putuskanReconnect(ALASAN_PUTUS.connectionClosed, MAKS_PERCOBAAN);

    expect(k.sambungUlang).toBe(false);
    expect(k.catatan).toContain('manual');
  });

  it('tetap menyambung ulang saat kode putus tidak terbaca', () => {
    // Gangguan yang tidak dikenali lebih sering putus jaringan biasa
    // daripada sesi mati; diam berarti nomor berhenti terpantau senyap.
    expect(putuskanReconnect(undefined, 0).sambungUlang).toBe(true);
  });
});
