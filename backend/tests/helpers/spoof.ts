import sharp from 'sharp';

/**
 * Membuat tiruan "seseorang mengacungkan ponsel berisi foto ke kamera".
 *
 * Ini TIRUAN, bukan tangkapan serangan sungguhan: tidak ada moire nyata,
 * pantulan layar, maupun karakteristik sensor kamera. Yang ditiru adalah
 * petunjuk yang memang dipelajari model — bingkai gelap di sekeliling wajah,
 * kehilangan ketajaman, dan artefak kompresi berlapis.
 *
 * Batasan ini penting saat membaca hasil test: lulus di sini bukan jaminan
 * tahan terhadap serangan sungguhan.
 */
export const simulateScreenReplay = async (
  source: Buffer,
  options: { bezel?: number; blur?: number; quality?: number } = {}
): Promise<Buffer> => {
  const { bezel = 30, blur = 0.7, quality = 50 } = options;

  const isiLayar = await sharp(source)
    .resize(300, null, { fit: 'inside' })
    .blur(blur)
    .jpeg({ quality })
    .toBuffer();

  const berbingkai = await sharp(isiLayar)
    .extend({
      top: bezel,
      bottom: bezel,
      left: bezel,
      right: bezel,
      background: { r: 16, g: 16, b: 20 },
    })
    .toBuffer();

  return sharp({
    create: { width: 640, height: 640, channels: 3, background: { r: 95, g: 92, b: 88 } },
  })
    .composite([{ input: berbingkai, gravity: 'center' }])
    .jpeg({ quality: 78 })
    .toBuffer();
};
