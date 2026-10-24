import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import '../auth/sesi_provider.dart';
import 'layar_privasi.dart';

Future<bool> mintaPersetujuanIntegritas(
  BuildContext context,
  WidgetRef ref,
) async {
  final id = ref.read(penggunaProvider)?.id;
  if (id == null) return false;
  final simpanan = ref.read(penyimpananSesiProvider);
  if (await simpanan.bacaSetujuIntegritas(id)) {
    return context.mounted &&
        ref.context.mounted &&
        ref.read(penggunaProvider)?.id == id;
  }
  if (!context.mounted || ref.read(penggunaProvider)?.id != id) return false;
  final setuju = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: const Text('Pemeriksaan keaslian presensi'),
      content: const SingleChildScrollView(
        child: Text(
          'HRD Nusantara menggunakan lokasi presensi, penanda lokasi tiruan, status keamanan perangkat, '
          'dan keberadaan aplikasi lokasi tiruan dari daftar terbatas untuk mencegah presensi palsu. '
          'Hasil pemeriksaan, termasuk nama paket aplikasi lokasi tiruan yang ditemukan, '
          'dikirim kepada perusahaan bersama presensi. Anda dapat memilih Pindai QR jika tidak menyetujui pemeriksaan ini.',
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(
            ctx,
          ).push(MaterialPageRoute<void>(builder: (_) => const LayarPrivasi())),
          child: const Text('Kebijakan privasi'),
        ),
        TextButton(
          onPressed: () => Navigator.pop(ctx, false),
          child: const Text('Batal'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(ctx, true),
          child: const Text('Setuju dan lanjut'),
        ),
      ],
    ),
  );
  if (setuju != true ||
      !context.mounted ||
      !ref.context.mounted ||
      ref.read(penggunaProvider)?.id != id) {
    return false;
  }
  await simpanan.simpanSetujuIntegritas(id);
  return context.mounted &&
      ref.context.mounted &&
      ref.read(penggunaProvider)?.id == id;
}
