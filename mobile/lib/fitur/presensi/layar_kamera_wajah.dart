import 'dart:convert';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';

/// Mengambil selfie dengan kamera depan dan mengembalikan data URI base64
/// (JPEG) untuk dikirim ke backend. Pengenalan wajah dikerjakan server.
class LayarKameraWajah extends StatefulWidget {
  const LayarKameraWajah({super.key});

  static Future<String?> buka(BuildContext context) =>
      Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const LayarKameraWajah(), fullscreenDialog: true));

  @override
  State<LayarKameraWajah> createState() => _LayarKameraWajahState();
}

class _LayarKameraWajahState extends State<LayarKameraWajah> with WidgetsBindingObserver {
  CameraController? _kamera;
  String? _galat;
  bool _memotret = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _siapkan();
  }

  Future<void> _siapkan() async {
    try {
      final daftar = await availableCameras();
      if (daftar.isEmpty) throw Exception('Tidak ada kamera di perangkat ini');
      final depan = daftar.firstWhere((c) => c.lensDirection == CameraLensDirection.front, orElse: () => daftar.first);
      final c = CameraController(depan, ResolutionPreset.medium, enableAudio: false, imageFormatGroup: ImageFormatGroup.jpeg);
      await c.initialize();
      if (!mounted) {
        await c.dispose();
        return;
      }
      setState(() => _kamera = c);
    } catch (e) {
      if (mounted) setState(() => _galat = 'Kamera tidak bisa dibuka: $e');
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final c = _kamera;
    if (c == null || !c.value.isInitialized) return;
    if (state == AppLifecycleState.inactive) {
      c.dispose();
      _kamera = null;
    } else if (state == AppLifecycleState.resumed) {
      _siapkan();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _kamera?.dispose();
    super.dispose();
  }

  Future<void> _potret() async {
    final c = _kamera;
    if (c == null || _memotret) return;
    setState(() => _memotret = true);
    try {
      final berkas = await c.takePicture();
      final bytes = await berkas.readAsBytes();
      if (!mounted) return;
      Navigator.of(context).pop('data:image/jpeg;base64,${base64Encode(bytes)}');
    } catch (e) {
      if (mounted) {
        setState(() {
          _galat = 'Foto gagal diambil: $e';
          _memotret = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = _kamera;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: const Text('Verifikasi Wajah')),
      body: _galat != null
          ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(_galat!, style: const TextStyle(color: Colors.white), textAlign: TextAlign.center)))
          : c == null
              ? const Center(child: CircularProgressIndicator(color: Colors.white))
              : Column(
                  children: [
                    Expanded(
                      child: Stack(
                        fit: StackFit.expand,
                        children: [
                          Center(child: AspectRatio(aspectRatio: 1 / c.value.aspectRatio, child: CameraPreview(c))),
                          // Bingkai oval: bantu pengguna menempatkan wajah di tengah.
                          IgnorePointer(
                            child: Center(
                              child: Container(
                                width: 240,
                                height: 320,
                                decoration: BoxDecoration(border: Border.all(color: Colors.white70, width: 3), borderRadius: BorderRadius.circular(160)),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(24, 16, 24, 32),
                      child: Column(
                        children: [
                          const Text('Posisikan wajah di dalam bingkai, lepas masker dan kacamata hitam.', style: TextStyle(color: Colors.white70), textAlign: TextAlign.center),
                          const SizedBox(height: 16),
                          GestureDetector(
                            onTap: _memotret ? null : _potret,
                            child: Container(
                              width: 72,
                              height: 72,
                              decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white, border: Border.all(color: Colors.white38, width: 6)),
                              child: _memotret ? const Padding(padding: EdgeInsets.all(20), child: CircularProgressIndicator(strokeWidth: 3)) : null,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
    );
  }
}
