import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/widget/widget_umum.dart';
import '../auth/sesi_provider.dart';
import 'model_chat.dart';
import 'repo_chat.dart';

class LayarChat extends ConsumerWidget {
  const LayarChat({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ruang = ref.watch(ruangChatProvider);
    final skema = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Chat Tim')),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(ruangChatProvider);
          await ref.read(ruangChatProvider.future);
        },
        child: ruang.when(
          loading: () => const Pemuat(),
          error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(ruangChatProvider)),
          data: (daftar) => daftar.isEmpty
              ? ListView(children: const [KeadaanKosong(ikon: Icons.forum_outlined, judul: 'Belum ada ruang', keterangan: 'Atasan atau HR akan menambahkan Anda ke ruang tim. Ruang baru dibuat dari aplikasi web.')])
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                  itemCount: daftar.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 8),
                  itemBuilder: (_, i) {
                    final r = daftar[i];
                    return Card(
                      child: ListTile(
                        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => LayarRuang(r))),
                        leading: CircleAvatar(backgroundColor: skema.primaryContainer, child: Text(r.nama.substring(0, r.nama.length >= 2 ? 2 : 1).toUpperCase(), style: TextStyle(color: skema.onPrimaryContainer, fontWeight: FontWeight.w700))),
                        title: Row(children: [Expanded(child: Text(r.nama, style: const TextStyle(fontWeight: FontWeight.w700), overflow: TextOverflow.ellipsis)), if (r.privat) Icon(Icons.lock_outline, size: 14, color: skema.onSurfaceVariant)]),
                        subtitle: Text(
                          r.waktuTerakhir == null ? '${r.jumlahAnggota} anggota · belum ada pesan' : r.terakhirDihapus ? 'Pesan dihapus' : '${r.pengirimTerakhir?.split(' ').first}: ${r.pesanTerakhir}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        trailing: r.waktuTerakhir == null ? null : Text(formatRelatif(r.waktuTerakhir), style: TextStyle(fontSize: 11, color: skema.onSurfaceVariant)),
                      ),
                    );
                  },
                ),
        ),
      ),
    );
  }
}

class LayarRuang extends ConsumerStatefulWidget {
  const LayarRuang(this.ruang, {super.key});
  final RuangChat ruang;
  @override
  ConsumerState<LayarRuang> createState() => _LayarRuangState();
}

class _LayarRuangState extends ConsumerState<LayarRuang> {
  final _teks = TextEditingController();
  final _gulir = ScrollController();
  Timer? _penyegar;
  bool _mengirim = false;

  @override
  void initState() {
    super.initState();
    // Tanpa WebSocket: segarkan tiap 5 detik selama layar terbuka.
    _penyegar = Timer.periodic(const Duration(seconds: 5), (_) => ref.invalidate(pesanChatProvider(widget.ruang.id)));
  }

  @override
  void dispose() {
    _penyegar?.cancel();
    _teks.dispose();
    _gulir.dispose();
    super.dispose();
  }

  Future<void> _kirim() async {
    final isi = _teks.text.trim();
    if (isi.isEmpty || _mengirim) return;
    setState(() => _mengirim = true);
    try {
      await ref.read(repoChatProvider).kirim(widget.ruang.id, isi);
      _teks.clear();
      ref.invalidate(pesanChatProvider(widget.ruang.id));
      ref.invalidate(ruangChatProvider);
    } catch (e) {
      if (mounted) tampilkanGalat(context, e, 'Pesan tidak terkirim');
    } finally {
      if (mounted) setState(() => _mengirim = false);
    }
  }

  Future<void> _hapus(PesanChat p) async {
    final ya = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Hapus pesan?'),
        content: const Text('Isinya disembunyikan dari semua anggota; jejak bahwa ada pesan yang dihapus tetap terlihat.'),
        actions: [
          TextButton.icon(onPressed: () => Navigator.pop(ctx, false), icon: const Icon(Icons.close), label: const Text('Batal')),
          FilledButton.icon(onPressed: () => Navigator.pop(ctx, true), icon: const Icon(Icons.delete_outline), label: const Text('Hapus')),
        ],
      ),
    );
    if (ya != true) return;
    try {
      await ref.read(repoChatProvider).hapus(p.id);
      ref.invalidate(pesanChatProvider(widget.ruang.id));
    } catch (e) {
      if (mounted) tampilkanGalat(context, e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pesan = ref.watch(pesanChatProvider(widget.ruang.id));
    final saya = ref.watch(penggunaProvider);
    final skema = Theme.of(context).colorScheme;
    final moderator = widget.ruang.peranSaya == 'moderator' || (saya?.hr ?? false);
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(widget.ruang.nama, style: const TextStyle(fontSize: 17)), Text('${widget.ruang.jumlahAnggota} anggota${widget.ruang.deskripsi != null ? ' · ${widget.ruang.deskripsi}' : ''}', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w400, color: skema.onSurfaceVariant), maxLines: 1, overflow: TextOverflow.ellipsis)]),
      ),
      body: Column(
        children: [
          Expanded(
            child: pesan.when(
              loading: () => const Pemuat(),
              error: (e, _) => PanelGalat(galat: e, cobaLagi: () => ref.invalidate(pesanChatProvider(widget.ruang.id))),
              data: (daftar) => daftar.isEmpty
                  ? const KeadaanKosong(ikon: Icons.chat_bubble_outline, judul: 'Belum ada pesan', keterangan: 'Mulai percakapan.')
                  : ListView.builder(
                      controller: _gulir,
                      reverse: true, // terbaru di bawah, daftar dari server sudah terbaru-dulu
                      padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
                      itemCount: daftar.length,
                      itemBuilder: (_, i) {
                        final p = daftar[i];
                        final milikku = p.pengirimId == saya?.id;
                        final gantiHari = i == daftar.length - 1 || formatTanggal(daftar[i + 1].waktu) != formatTanggal(p.waktu);
                        return Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            if (gantiHari) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Center(child: Text(formatTanggal(p.waktu, pola: 'EEEE, d MMM yyyy'), style: TextStyle(fontSize: 11, color: skema.onSurfaceVariant)))),
                            Align(
                              alignment: milikku ? Alignment.centerRight : Alignment.centerLeft,
                              child: GestureDetector(
                                onLongPress: (!p.dihapus && (milikku || moderator)) ? () => _hapus(p) : null,
                                child: Container(
                                  constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
                                  margin: const EdgeInsets.symmetric(vertical: 3),
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                                  decoration: BoxDecoration(
                                    color: milikku ? skema.primary : skema.surfaceContainerHighest,
                                    borderRadius: BorderRadius.only(topLeft: const Radius.circular(16), topRight: const Radius.circular(16), bottomLeft: Radius.circular(milikku ? 16 : 4), bottomRight: Radius.circular(milikku ? 4 : 16)),
                                  ),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      if (!milikku) Text(p.pengirim, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w700, color: skema.primary)),
                                      Text(p.dihapus ? 'Pesan dihapus' : (p.isi ?? ''), style: TextStyle(color: milikku ? skema.onPrimary : skema.onSurface, fontStyle: p.dihapus ? FontStyle.italic : null)),
                                      Text(formatWaktu(p.waktu), style: TextStyle(fontSize: 10, color: (milikku ? skema.onPrimary : skema.onSurfaceVariant).withValues(alpha: 0.7))),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ],
                        );
                      },
                    ),
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _teks,
                      minLines: 1,
                      maxLines: 4,
                      maxLength: 5000,
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _kirim(),
                      decoration: const InputDecoration(hintText: 'Tulis pesan…', counterText: '', isDense: true),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(onPressed: _mengirim ? null : _kirim, icon: const Icon(Icons.send), tooltip: 'Kirim'),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
