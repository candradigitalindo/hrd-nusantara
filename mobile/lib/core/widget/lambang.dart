import 'package:flutter/material.dart';

import '../tema.dart';

/// Lambang aplikasi: kalender dengan centang — bentuk yang sama dengan ikon
/// peluncur, favicon, dan komponen Logo di web.
///
/// Digambar langsung dari koordinat 64×64 di `merek/buat-ikon.mjs` supaya
/// tetap tajam di ukuran berapa pun tanpa berkas gambar. Kalau bentuk di sana
/// diubah, sesuaikan juga di sini. Warnanya dipatok, tidak mengikuti tema.
class LambangAplikasi extends StatelessWidget {
  const LambangAplikasi({super.key, this.ukuran = 64});

  final double ukuran;

  @override
  Widget build(BuildContext context) => SizedBox.square(dimension: ukuran, child: const CustomPaint(painter: _PelukisLambang()));
}

class _PelukisLambang extends CustomPainter {
  const _PelukisLambang();

  @override
  void paint(Canvas canvas, Size size) {
    canvas.scale(size.shortestSide / 64);
    canvas.drawRRect(RRect.fromLTRBR(0, 0, 64, 64, const Radius.circular(14)), Paint()..color = warnaUtama);

    final garis = Paint()
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..color = Colors.white
      ..strokeWidth = 3.6;
    canvas.drawRRect(RRect.fromLTRBR(13, 17, 51, 51, const Radius.circular(5)), garis);
    canvas.drawLine(const Offset(23, 11.5), const Offset(23, 18.5), garis);
    canvas.drawLine(const Offset(41, 11.5), const Offset(41, 18.5), garis);
    canvas.drawLine(const Offset(13, 28), const Offset(51, 28), garis);

    final centang = Path()
      ..moveTo(23.5, 39)
      ..lineTo(29.5, 45)
      ..lineTo(41, 33);
    canvas.drawPath(
      centang,
      garis
        ..color = warnaSekunder
        ..strokeWidth = 4.8,
    );
  }

  @override
  bool shouldRepaint(_PelukisLambang oldDelegate) => false;
}
