import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Memindai QR yang ditempel di lokasi kerja dan mengembalikan isinya.
class LayarPindaiQr extends StatefulWidget {
  const LayarPindaiQr({super.key});

  static Future<String?> buka(BuildContext context) =>
      Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const LayarPindaiQr(), fullscreenDialog: true));

  @override
  State<LayarPindaiQr> createState() => _LayarPindaiQrState();
}

class _LayarPindaiQrState extends State<LayarPindaiQr> {
  final _kontrol = MobileScannerController(formats: const [BarcodeFormat.qrCode]);
  bool _selesai = false;

  @override
  void dispose() {
    _kontrol.dispose();
    super.dispose();
  }

  void _terdeteksi(BarcodeCapture tangkapan) {
    if (_selesai) return;
    final nilai = tangkapan.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
    if (nilai == null || nilai.isEmpty) return;
    _selesai = true;
    Navigator.of(context).pop(nilai);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: const Text('Pindai QR Lokasi'),
        actions: [IconButton(onPressed: () => _kontrol.toggleTorch(), icon: const Icon(Icons.flashlight_on_outlined), tooltip: 'Senter')],
      ),
      body: Stack(
        fit: StackFit.expand,
        children: [
          MobileScanner(controller: _kontrol, onDetect: _terdeteksi),
          IgnorePointer(
            child: Center(
              child: Container(
                width: 240,
                height: 240,
                decoration: BoxDecoration(border: Border.all(color: Colors.white, width: 3), borderRadius: BorderRadius.circular(20)),
              ),
            ),
          ),
          const Positioned(
            left: 24,
            right: 24,
            bottom: 40,
            child: Text('Arahkan kamera ke kode QR yang ditempel di titik presensi.', style: TextStyle(color: Colors.white70), textAlign: TextAlign.center),
          ),
        ],
      ),
    );
  }
}
