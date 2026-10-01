import {
  nomorDariJid,
  digitJid,
  jenisJid,
  tampakLid,
  isiDariPesan,
  waktuDariTimestamp,
  normalizeBaileysMessage,
  lidDalamPesan,
  bacaKontakBaileys,
  pasanganDariPeserta,
} from '../src/services/whatsapp/baileysMessage';
import {
  putuskanReconnect,
  ALASAN_PUTUS,
  MAKS_PUTARAN_QR,
  PERCOBAAN_JEDA_LAMA,
  JEDA_MAKS_LAMA_MS,
  JEDA_MIN_SIBUK_MS,
} from '../src/services/whatsapp/reconnect';

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

  it('membuang domain, perangkat, dan agen dari LID', () => {
    expect(digitJid('214751418265748:3@lid')).toBe('214751418265748');
    expect(digitJid('214751418265748_1:3@lid')).toBe('214751418265748');
  });

  it('membedakan nomor, LID, grup, dan siaran', () => {
    // LID adalah ID samaran WhatsApp, bukan nomor telepon. Tanpa pembedaan
    // ini digitnya tersimpan seolah nomor HP dan tampil sebagai "+2147…".
    expect(jenisJid('628222222222@s.whatsapp.net')).toBe('pn');
    expect(jenisJid('628222222222@c.us')).toBe('pn');
    expect(jenisJid('628222222222:99@hosted')).toBe('pn');
    expect(jenisJid('214751418265748@lid')).toBe('lid');
    expect(jenisJid('214751418265748:99@hosted.lid')).toBe('lid');
    expect(jenisJid('12036301234567890@g.us')).toBe('grup');
    expect(jenisJid('status@broadcast')).toBe('siaran');
    expect(jenisJid('120363111111111111@newsletter')).toBe('siaran');
    expect(jenisJid('628222222222')).toBeNull();
  });

  it('mengenali digit yang tampak LID di arsip lama', () => {
    expect(tampakLid('214751418265748')).toBe(true); // 15 digit
    expect(tampakLid('88014471852141')).toBe(true); // 14 digit, bukan 62
    expect(tampakLid('62812345678901')).toBe(false); // 14 digit nomor Indonesia
    expect(tampakLid('628222222222')).toBe(false);
    expect(tampakLid(null)).toBe(false);
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

  it('membuka pesan sementara, sekali lihat, dan dokumen berketerangan', () => {
    // Chat yang menyalakan pesan sementara membungkus SEMUA pesannya; tanpa
    // dibuka, chat itu tidak pernah terarsip sama sekali.
    expect(isiDariPesan({ ephemeralMessage: { message: { conversation: 'rahasia' } } })).toEqual({
      body: 'rahasia',
      type: 'text',
    });
    expect(
      isiDariPesan({ viewOnceMessageV2: { message: { imageMessage: { caption: 'sekali', mimetype: 'image/png' } } } })
    ).toMatchObject({ body: 'sekali', type: 'image' });
    expect(isiDariPesan({ viewOnceMessage: { message: { videoMessage: { mimetype: 'video/mp4' } } } })).toMatchObject({
      type: 'video',
    });
    expect(
      isiDariPesan({ viewOnceMessageV2Extension: { message: { audioMessage: { mimetype: 'audio/ogg' } } } })
    ).toMatchObject({ type: 'audio' });
    expect(
      isiDariPesan({
        documentWithCaptionMessage: {
          message: { documentMessage: { caption: 'kontrak', fileName: 'k.pdf', mimetype: 'application/pdf' } },
        },
      })
    ).toMatchObject({ body: 'kontrak', type: 'document', media: { fileName: 'k.pdf' } });
    // Bungkus bersarang: pesan sementara yang sekali lihat.
    expect(
      isiDariPesan({ ephemeralMessage: { message: { viewOnceMessage: { message: { conversation: 'dalam' } } } } })
    ).toEqual({ body: 'dalam', type: 'text' });
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
      participantLid: null,
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

  it('melewatkan kanal WhatsApp (newsletter)', () => {
    // Kanal bukan percakapan dengan seseorang; dulu terarsip sebagai chat
    // pribadi "+120363…".
    expect(
      normalizeBaileysMessage(
        mentah({ key: { remoteJid: '120363111111111111@newsletter', fromMe: false, id: 'N1' } }),
        NOMOR_SENDIRI
      )
    ).toEqual({ status: 'dilewati', alasan: 'siaran' });
  });
});

describe('Lawan bicara yang disebut lewat LID', () => {
  const LID = '214751418265748';
  const mentah = (key: Record<string, unknown>, ubah: Record<string, unknown> = {}) => ({
    key: { fromMe: false, id: 'L1', ...key },
    message: { conversation: 'Halo kak' },
    messageTimestamp: 1789000000,
    ...ubah,
  });

  it('memakai nomor asli dari remoteJidAlt dan mencatat pasangannya', () => {
    const hasil = normalizeBaileysMessage(
      mentah({ remoteJid: `${LID}@lid`, remoteJidAlt: '628222222222@s.whatsapp.net', addressingMode: 'lid' }, { pushName: 'Sari' }),
      NOMOR_SENDIRI
    );

    expect(hasil.status).toBe('ok');
    if (hasil.status !== 'ok') return;
    expect(hasil.pesan.from).toBe('628222222222');
    expect(hasil.pesan.to).toBe(NOMOR_SENDIRI);
    expect(hasil.pesan.contactLid).toBe(LID);
    expect(hasil.pesan.senderName).toBe('Sari');
    expect(hasil.pasangan).toEqual([{ lid: LID, pn: '628222222222' }]);
    expect(hasil.pengirim).toEqual({ nomor: '628222222222', lid: LID, pushName: 'Sari', verifiedName: null });
  });

  it('memakai peta LID yang sudah dikenal bila pesannya tidak membawa nomor', () => {
    const hasil = normalizeBaileysMessage(
      mentah({ remoteJid: `${LID}:7@lid` }),
      NOMOR_SENDIRI,
      new Map([[LID, '628222222222']])
    );

    expect(hasil.status).toBe('ok');
    if (hasil.status !== 'ok') return;
    expect(hasil.pesan.from).toBe('628222222222');
    expect(hasil.pesan.contactLid).toBe(LID);
    expect(hasil.pasangan).toEqual([]);
  });

  it('LID yang belum dikenal tetap diarsipkan, ditandai sebagai LID', () => {
    const hasil = normalizeBaileysMessage(mentah({ remoteJid: `${LID}@lid` }), NOMOR_SENDIRI);

    expect(hasil.status).toBe('ok');
    if (hasil.status !== 'ok') return;
    // Digit LID menjadi kunci utas, tapi contactLid yang sama menandai bahwa
    // itu bukan nomor telepon.
    expect(hasil.pesan.from).toBe(LID);
    expect(hasil.pesan.contactLid).toBe(LID);
    expect(hasil.pengirim).toMatchObject({ nomor: null, lid: LID });
  });

  it('pesan keluar tidak salah mengambil nomor sendiri dari remoteJidAlt', () => {
    // Pada pesan yang kita kirim, alamat alternatifnya bisa sender_pn milik
    // kita sendiri. Memakainya berarti kontak itu tercatat sebagai diri kita.
    const hasil = normalizeBaileysMessage(
      mentah({ remoteJid: `${LID}@lid`, remoteJidAlt: `${NOMOR_SENDIRI}:3@s.whatsapp.net`, fromMe: true }),
      NOMOR_SENDIRI
    );

    expect(hasil.status).toBe('ok');
    if (hasil.status !== 'ok') return;
    expect(hasil.pesan.from).toBe(NOMOR_SENDIRI);
    expect(hasil.pesan.to).toBe(LID);
    expect(hasil.pasangan).toEqual([]);
    expect(hasil.pesan.senderName).toBeNull();
    expect(hasil.pengirim).toBeNull();
  });

  it('chat bernomor yang membawa LID di sebelahnya ikut mencatat LID-nya', () => {
    const hasil = normalizeBaileysMessage(
      mentah({ remoteJid: '628222222222@s.whatsapp.net', remoteJidAlt: `${LID}@lid`, addressingMode: 'pn' }),
      NOMOR_SENDIRI
    );

    expect(hasil.status).toBe('ok');
    if (hasil.status !== 'ok') return;
    expect(hasil.pesan.from).toBe('628222222222');
    expect(hasil.pesan.contactLid).toBe(LID);
    expect(hasil.pasangan).toEqual([{ lid: LID, pn: '628222222222' }]);
  });

  it('grup: pengirim LID diganti nomor asli dari participantAlt', () => {
    const hasil = normalizeBaileysMessage(
      mentah(
        { remoteJid: '12036301234567890@g.us', participant: `${LID}@lid`, participantAlt: '628333333333@s.whatsapp.net' },
        { pushName: 'Andi Dapur' }
      ),
      NOMOR_SENDIRI
    );

    expect(hasil.status).toBe('ok');
    if (hasil.status !== 'ok') return;
    expect(hasil.pesan.grup).toMatchObject({ participantNumber: '628333333333', participantLid: LID });
    expect(hasil.pesan.from).toBe('628333333333');
    expect(hasil.pesan.senderName).toBe('Andi Dapur');
    expect(hasil.pasangan).toEqual([{ lid: LID, pn: '628333333333' }]);
    expect(hasil.pengirim).toEqual({ nomor: '628333333333', lid: LID, pushName: 'Andi Dapur', verifiedName: null });
  });

  it('grup dari riwayat: pengirimnya di field participant level atas', () => {
    // Pesan history sync tidak mengisi key.participant; tanpa membaca field
    // ini pengirim grup tercatat kosong (68 ribu pesan di produksi).
    const hasil = normalizeBaileysMessage(
      mentah({ remoteJid: '12036301234567890@g.us' }, { participant: `${LID}@lid` }),
      NOMOR_SENDIRI,
      new Map([[LID, '628333333333']])
    );

    expect(hasil.status).toBe('ok');
    if (hasil.status !== 'ok') return;
    expect(hasil.pesan.grup).toMatchObject({ participantNumber: '628333333333', participantLid: LID });
    expect(lidDalamPesan(mentah({ remoteJid: '12036301234567890@g.us' }, { participant: `${LID}@lid` }))).toEqual([LID]);
  });

  it('grup: pengirim LID yang belum dikenal tetap tercatat sebagai LID', () => {
    const hasil = normalizeBaileysMessage(
      mentah({ remoteJid: '12036301234567890@g.us', participant: `${LID}@lid` }),
      NOMOR_SENDIRI
    );

    expect(hasil.status).toBe('ok');
    if (hasil.status !== 'ok') return;
    expect(hasil.pesan.grup).toMatchObject({ participantNumber: LID, participantLid: LID });
    expect(hasil.pengirim).toMatchObject({ nomor: null, lid: LID });
  });
});

describe('Membaca kontak Baileys', () => {
  it('kontak ber-LID dengan nomor aslinya', () => {
    expect(
      bacaKontakBaileys({ id: '214751418265748@lid', phoneNumber: '628222222222@s.whatsapp.net', name: ' Bu  Sari ', notify: 'Sari' })
    ).toEqual({ nomor: '628222222222', lid: '214751418265748', savedName: 'Bu Sari', pushName: 'Sari', verifiedName: null });
  });

  it('kontak bernomor dengan LID-nya', () => {
    expect(bacaKontakBaileys({ id: '628222222222@s.whatsapp.net', lid: '214751418265748@lid' })).toEqual({
      nomor: '628222222222',
      lid: '214751418265748',
      savedName: null,
      pushName: null,
      verifiedName: null,
    });
  });

  it('melewati grup, kanal, dan kontak tanpa isi apa pun', () => {
    expect(bacaKontakBaileys({ id: '12036301234567890@g.us', name: 'Tim Dapur' })).toBeNull();
    expect(bacaKontakBaileys({ id: '120363111111111111@newsletter', name: 'Promo' })).toBeNull();
    expect(bacaKontakBaileys({ id: '628222222222@s.whatsapp.net' })).toBeNull();
    expect(bacaKontakBaileys(null)).toBeNull();
  });

  it('peserta grup membawa pasangan LID dan nomor', () => {
    expect(pasanganDariPeserta({ id: '214751418265748@lid', phoneNumber: '628222222222@s.whatsapp.net' })).toEqual({
      lid: '214751418265748',
      pn: '628222222222',
    });
    expect(pasanganDariPeserta({ id: '628222222222@s.whatsapp.net', lid: '214751418265748@lid' })).toEqual({
      lid: '214751418265748',
      pn: '628222222222',
    });
    expect(pasanganDariPeserta({ id: '214751418265748@lid' })).toBeNull();
    expect(pasanganDariPeserta({})).toBeNull();
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

  it('tidak pernah menyerah pada gangguan sementara; setelah lama, mencoba tiap 5 menit', () => {
    // Dulu menyerah setelah 10 percobaan (±5 menit). Gangguan ISP atau
    // WhatsApp yang lebih lama dari itu membuat nomor mati sampai HR
    // menyambungkannya manual — berhari-hari kemudian. Sesinya sendiri
    // masih sah, jadi tidak ada alasan berhenti mencoba.
    for (const percobaan of [PERCOBAAN_JEDA_LAMA, 50, 500]) {
      const k = putuskanReconnect(ALASAN_PUTUS.connectionClosed, percobaan);
      expect(k.sambungUlang).toBe(true);
      expect(k.perluScanUlang).toBe(false);
      expect(k.jedaMs).toBe(JEDA_MAKS_LAMA_MS);
      expect(k.catatan).toContain('masih mencoba');
    }
  });

  it('server WhatsApp yang sibuk (503) tidak ditembak lagi sedetik kemudian', () => {
    expect(putuskanReconnect(ALASAN_PUTUS.unavailableService, 0).jedaMs).toBe(JEDA_MIN_SIBUK_MS);
    expect(putuskanReconnect(ALASAN_PUTUS.unavailableService, 4).jedaMs).toBe(16000);
  });

  it('tetap menyambung ulang saat kode putus tidak terbaca', () => {
    // Gangguan yang tidak dikenali lebih sering putus jaringan biasa
    // daripada sesi mati; diam berarti nomor berhenti terpantau senyap.
    expect(putuskanReconnect(undefined, 0).sambungUlang).toBe(true);
  });

  it('putus sesi yang tersambung dicatat sebagai kejadian', () => {
    expect(putuskanReconnect(ALASAN_PUTUS.timedOut, 0).tahapQr).toBe(false);
    expect(putuskanReconnect(ALASAN_PUTUS.loggedOut, 0).tahapQr).toBe(false);
  });
});

describe('Kebijakan QR yang tidak dipindai', () => {
  it('membuat QR baru segera, bukan menunggu jeda gangguan jaringan', () => {
    const k = putuskanReconnect(ALASAN_PUTUS.timedOut, 0, { menungguScan: true });

    expect(k.sambungUlang).toBe(true);
    expect(k.jedaMs).toBe(0);
    expect(k.tahapQr).toBe(true);
  });

  it('berhenti setelah beberapa putaran dan menunggu QR diminta lagi', () => {
    // QR yang dibuat terus untuk layar yang tidak dibuka siapa pun hanya
    // membebani server WhatsApp dan mengisi arsip kejadian.
    const k = putuskanReconnect(ALASAN_PUTUS.timedOut, MAKS_PUTARAN_QR - 1, { menungguScan: true });

    expect(k.sambungUlang).toBe(false);
    expect(k.perluScanUlang).toBe(true);
    expect(k.tahapQr).toBe(true);
    expect(putuskanReconnect(ALASAN_PUTUS.timedOut, MAKS_PUTARAN_QR - 2, { menungguScan: true }).sambungUlang).toBe(true);
  });

  it('restart setelah QR dipindai tetap disambung ulang seperti biasa', () => {
    const k = putuskanReconnect(ALASAN_PUTUS.restartRequired, 0, { menungguScan: true });

    expect(k.sambungUlang).toBe(true);
    expect(k.tahapQr).toBe(false);
  });
});
