import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api/klien_api.dart';
import '../../core/widget/widget_umum.dart';
import '../../firebase_options.dart';
import '../auth/sesi_provider.dart';

class LayarProfil extends ConsumerWidget {
  const LayarProfil({super.key});

  Future<void> _keluar(BuildContext context, WidgetRef ref) async {
    final ya = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Keluar dari aplikasi?'),
        content: const Text('Notifikasi ke ponsel ini dihentikan sampai Anda masuk lagi.'),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Batal')), FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Keluar'))],
      ),
    );
    if (ya == true) await ref.read(sesiProvider.notifier).keluar();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(penggunaProvider);
    final skema = Theme.of(context).colorScheme;
    if (p == null) return const Scaffold(body: Pemuat());
    return Scaffold(
      appBar: AppBar(title: const Text('Profil')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(18),
              child: Row(
                children: [
                  CircleAvatar(radius: 28, backgroundColor: skema.primary, child: Text(p.nama.isNotEmpty ? p.nama[0].toUpperCase() : '?', style: TextStyle(color: skema.onPrimary, fontSize: 24, fontWeight: FontWeight.w800))),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(p.nama, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800)),
                        Text([p.jabatan, p.departemen].whereType<String>().join(' · '), style: TextStyle(color: skema.onSurfaceVariant)),
                        const SizedBox(height: 6),
                        LencanaStatus(p.status),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const JudulBagian('Data diri'),
          Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              child: Column(
                children: [
                  BarisRincian('NIK', p.nik),
                  BarisRincian('Email', p.email),
                  BarisRincian('Telepon', p.telepon ?? '—'),
                  BarisRincian('Alamat', p.alamat ?? '—'),
                  BarisRincian('Peran', labelPeran(p.peran)),
                ],
              ),
            ),
          ),
          const JudulBagian('Menu lain'),
          Card(
            child: Column(
              children: [
                ListTile(leading: const Icon(Icons.calendar_month_outlined), title: const Text('Jadwal shift'), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/jadwal')),
                const Divider(),
                ListTile(leading: const Icon(Icons.poll_outlined), title: const Text('Survei karyawan'), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/survei')),
                const Divider(),
                ListTile(leading: const Icon(Icons.forum_outlined), title: const Text('Chat tim'), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/chat')),
                const Divider(),
                ListTile(leading: const Icon(Icons.phone_android_outlined), title: const Text('Tautan WhatsApp'), subtitle: const Text('Wajib tersambung · pindai QR lewat web'), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/whatsapp')),
                const Divider(),
                ListTile(leading: const Icon(Icons.lock_reset), title: const Text('Ganti password'), trailing: const Icon(Icons.chevron_right), onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const LayarGantiPassword()))),
              ],
            ),
          ),
          const JudulBagian('Notifikasi'),
          Card(
            child: ListTile(
              leading: Icon(firebaseTerkonfigurasi ? Icons.notifications_active_outlined : Icons.notifications_off_outlined),
              title: Text(firebaseTerkonfigurasi ? 'Push aktif' : 'Push belum dikonfigurasi'),
              subtitle: Text(firebaseTerkonfigurasi ? 'Presensi, cuti, dan sesi WhatsApp' : 'Build ini belum terhubung ke Firebase; lihat README mobile.'),
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(onPressed: () => _keluar(context, ref), icon: const Icon(Icons.logout), label: const Text('Keluar'), style: OutlinedButton.styleFrom(foregroundColor: skema.error)),
        ],
      ),
    );
  }
}

String labelPeran(String kode) => switch (kode) {
      'SUPER_ADMIN' => 'Super Admin',
      'HR_ADMIN' => 'HR Admin',
      'MANAGER' => 'Manajer',
      _ => 'Karyawan',
    };

class LayarGantiPassword extends ConsumerStatefulWidget {
  const LayarGantiPassword({super.key});
  @override
  ConsumerState<LayarGantiPassword> createState() => _LayarGantiPasswordState();
}

class _LayarGantiPasswordState extends ConsumerState<LayarGantiPassword> {
  final _form = GlobalKey<FormState>();
  final _lama = TextEditingController();
  final _baru = TextEditingController();
  final _ulang = TextEditingController();
  bool _proses = false;

  @override
  void dispose() {
    _lama.dispose();
    _baru.dispose();
    _ulang.dispose();
    super.dispose();
  }

  Future<void> _simpan() async {
    if (!_form.currentState!.validate()) return;
    setState(() => _proses = true);
    try {
      await ref.read(klienApiProvider).post('/auth/change-password', {'currentPassword': _lama.text, 'newPassword': _baru.text});
      if (!mounted) return;
      tampilkanPesan(context, 'Password diganti', rincian: 'Gunakan password baru saat masuk berikutnya.');
      Navigator.of(context).pop();
    } catch (e) {
      if (mounted) tampilkanGalat(context, e, 'Password belum diganti');
    } finally {
      if (mounted) setState(() => _proses = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ganti Password')),
      body: Form(
        key: _form,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TextFormField(controller: _lama, obscureText: true, decoration: const InputDecoration(labelText: 'Password saat ini'), validator: (v) => (v == null || v.isEmpty) ? 'Wajib diisi' : null),
            const SizedBox(height: 12),
            TextFormField(controller: _baru, obscureText: true, decoration: const InputDecoration(labelText: 'Password baru', helperText: 'Minimal 8 karakter'), validator: (v) => (v == null || v.length < 8) ? 'Minimal 8 karakter' : v == _lama.text ? 'Harus berbeda dari password lama' : null),
            const SizedBox(height: 12),
            TextFormField(controller: _ulang, obscureText: true, decoration: const InputDecoration(labelText: 'Ulangi password baru'), validator: (v) => v != _baru.text ? 'Tidak sama dengan password baru' : null),
            const SizedBox(height: 20),
            FilledButton(onPressed: _proses ? null : _simpan, child: _proses ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white)) : const Text('Simpan')),
          ],
        ),
      ),
    );
  }
}
