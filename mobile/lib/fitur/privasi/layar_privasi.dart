import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/sesi_provider.dart';
import '../pemantauan/layanan_pemantauan.dart';
import '../pemantauan/layar_pemantauan.dart';

class LayarPrivasi extends ConsumerStatefulWidget {
  const LayarPrivasi({super.key});

  @override
  ConsumerState<LayarPrivasi> createState() => _LayarPrivasiState();
}

class _LayarPrivasiState extends ConsumerState<LayarPrivasi> {
  late final Future<Map<String, dynamic>> _kebijakan = rootBundle
      .loadString('play/privacy-policy-id.json')
      .then((isi) => jsonDecode(isi) as Map<String, dynamic>);
  bool _mengubah = false;

  Future<void> _ubahPemantauan(bool setuju) async {
    setState(() => _mengubah = true);
    try {
      if (setuju) {
        await tampilkanPemberitahuanPemantauan(context, ref);
      } else {
        await ref.read(pemantauLokasiProvider.notifier).cabutPersetujuan();
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Pilihan belum tersimpan. Silakan coba lagi.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _mengubah = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pengguna = ref.watch(penggunaProvider);
    final pantau = pengguna == null ? null : ref.watch(pemantauLokasiProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Kebijakan privasi')),
      body: FutureBuilder<Map<String, dynamic>>(
        future: _kebijakan,
        builder: (context, hasil) {
          if (hasil.hasError) {
            return const Center(
              child: Text(
                'Kebijakan belum dapat dibuka. Hubungi hrd@nbp.co.id.',
              ),
            );
          }
          final data = hasil.data;
          if (data == null) {
            return const Center(child: CircularProgressIndicator());
          }
          return ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text(
                data['appName'] as String,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 6),
              Text('Diperbarui ${data['updatedAt']}'),
              const SizedBox(height: 16),
              if (pantau != null) ...[
                Card(
                  child: SwitchListTile(
                    title: const Text('Persetujuan pemantauan lokasi'),
                    subtitle: Text(
                      pantau.setuju == true
                          ? 'Matikan untuk menghentikan pengambilan lokasi berikutnya.'
                          : pantau.aktif
                          ? 'Pemantauan belum Anda setujui.'
                          : 'Pemantauan belum diaktifkan perusahaan.',
                    ),
                    value: pantau.setuju == true,
                    onChanged:
                        _mengubah || (!pantau.aktif && pantau.setuju != true)
                        ? null
                        : _ubahPemantauan,
                  ),
                ),
                const SizedBox(height: 12),
              ],
              for (final bagian in data['sections'] as List) ...[
                Padding(
                  padding: const EdgeInsets.only(top: 16, bottom: 8),
                  child: Text(
                    bagian['title'] as String,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                for (final paragraf in bagian['paragraphs'] as List)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: SelectableText(paragraf as String),
                  ),
              ],
              const SizedBox(height: 12),
              SelectableText(data['publicUrl'] as String),
              TextButton.icon(
                icon: const Icon(Icons.copy_outlined),
                label: const Text('Salin tautan kebijakan'),
                onPressed: () async {
                  await Clipboard.setData(
                    ClipboardData(text: data['publicUrl'] as String),
                  );
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('Tautan kebijakan disalin.'),
                      ),
                    );
                  }
                },
              ),
            ],
          );
        },
      ),
    );
  }
}
