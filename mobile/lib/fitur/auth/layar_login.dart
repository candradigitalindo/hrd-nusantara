import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/galat_api.dart';
import '../../core/konfigurasi.dart';
import '../../core/widget/widget_umum.dart';
import 'sesi_provider.dart';

class LayarLogin extends ConsumerStatefulWidget {
  const LayarLogin({super.key});

  @override
  ConsumerState<LayarLogin> createState() => _LayarLoginState();
}

class _LayarLoginState extends ConsumerState<LayarLogin> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _sembunyi = true;
  bool _memproses = false;
  String? _galat;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _masuk() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _memproses = true;
      _galat = null;
    });
    try {
      final p = await ref.read(sesiProvider.notifier).masuk(_email.text, _password.text);
      if (!mounted) return;
      tampilkanPesan(context, 'Selamat datang, ${p.nama.split(' ').first}', rincian: p.jabatan ?? p.departemen);
    } catch (e) {
      if (!mounted) return;
      setState(() => _galat = GalatApi.dari(e).pesanLengkap);
    } finally {
      if (mounted) setState(() => _memproses = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final skema = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Form(
                key: _form,
                child: AutofillGroup(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Container(
                        width: 64,
                        height: 64,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(color: skema.primary, borderRadius: BorderRadius.circular(18)),
                        child: const Icon(Icons.badge_rounded, color: Colors.white, size: 34),
                      ),
                      const SizedBox(height: 20),
                      Text(namaAplikasi, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800)),
                      const SizedBox(height: 4),
                      Text('Masuk dengan akun karyawan Anda', style: TextStyle(color: skema.onSurfaceVariant)),
                      const SizedBox(height: 28),
                      TextFormField(
                        controller: _email,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.username, AutofillHints.email],
                        textInputAction: TextInputAction.next,
                        decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline)),
                        validator: (v) => (v == null || !v.contains('@')) ? 'Masukkan email yang sah' : null,
                      ),
                      const SizedBox(height: 14),
                      TextFormField(
                        controller: _password,
                        obscureText: _sembunyi,
                        autofillHints: const [AutofillHints.password],
                        textInputAction: TextInputAction.done,
                        onFieldSubmitted: (_) => _masuk(),
                        decoration: InputDecoration(
                          labelText: 'Password',
                          prefixIcon: const Icon(Icons.lock_outline),
                          suffixIcon: IconButton(
                            onPressed: () => setState(() => _sembunyi = !_sembunyi),
                            icon: Icon(_sembunyi ? Icons.visibility_outlined : Icons.visibility_off_outlined),
                            tooltip: _sembunyi ? 'Tampilkan password' : 'Sembunyikan password',
                          ),
                        ),
                        validator: (v) => (v == null || v.isEmpty) ? 'Password wajib diisi' : null,
                      ),
                      if (_galat != null)
                        Container(
                          margin: const EdgeInsets.only(top: 14),
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(color: skema.errorContainer, borderRadius: BorderRadius.circular(12)),
                          child: Row(
                            children: [
                              Icon(Icons.error_outline, color: skema.onErrorContainer),
                              const SizedBox(width: 10),
                              Expanded(child: Text(_galat!, style: TextStyle(color: skema.onErrorContainer))),
                            ],
                          ),
                        ),
                      const SizedBox(height: 20),
                      FilledButton(
                        onPressed: _memproses ? null : _masuk,
                        child: _memproses
                            ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : const Text('Masuk'),
                      ),
                      const SizedBox(height: 16),
                      Text('Lupa password? Hubungi HR untuk mengatur ulang.', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: skema.onSurfaceVariant)),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
