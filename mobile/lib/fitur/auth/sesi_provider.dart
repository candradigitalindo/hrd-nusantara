import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import 'model_pengguna.dart';

/// Tiga keadaan: belum diketahui (baru buka aplikasi), keluar, atau masuk.
sealed class StatusSesi {
  const StatusSesi();
}

class SesiMemuat extends StatusSesi {
  const SesiMemuat();
}

class SesiKeluar extends StatusSesi {
  const SesiKeluar();
}

class SesiMasuk extends StatusSesi {
  const SesiMasuk(this.pengguna);
  final Pengguna pengguna;
}

class SesiNotifier extends Notifier<StatusSesi> {
  @override
  StatusSesi build() {
    // Klien API memberi tahu kalau token ditolak server.
    ref.read(klienApiProvider).saatSesiHabis = keluar;
    _pulihkan();
    return const SesiMemuat();
  }

  Future<void> _pulihkan() async {
    final simpanan = ref.read(penyimpananSesiProvider);
    final token = await simpanan.bacaToken();
    if (token == null) {
      state = const SesiKeluar();
      return;
    }
    final tersimpan = await simpanan.bacaPengguna();
    if (tersimpan != null) state = SesiMasuk(Pengguna.dariJson(tersimpan));
    // Segarkan dari server; kalau token sudah mati, interceptor memanggil keluar().
    try {
      final segar = await ref.read(klienApiProvider).getObjek('/auth/me');
      await simpanan.simpanPengguna(segar);
      state = SesiMasuk(Pengguna.dariJson(segar));
    } catch (e) {
      if (tersimpan == null) state = const SesiKeluar();
      debugPrint('Profil tidak bisa disegarkan: $e');
    }
  }

  /// [username] = nomor HP/WhatsApp (08xx, +62xx) atau email sebagai cadangan.
  Future<Pengguna> masuk(String username, String password) async {
    final api = ref.read(klienApiProvider);
    final simpanan = ref.read(penyimpananSesiProvider);
    final hasil = await api.post('/auth/login', {'username': username.trim(), 'password': password});
    await simpanan.simpanToken(hasil['token'] as String);
    final profil = await api.getObjek('/auth/me');
    await simpanan.simpanPengguna(profil);
    final pengguna = Pengguna.dariJson(profil);
    state = SesiMasuk(pengguna);
    return pengguna;
  }

  Future<void> segarkanProfil() async {
    final profil = await ref.read(klienApiProvider).getObjek('/auth/me');
    await ref.read(penyimpananSesiProvider).simpanPengguna(profil);
    state = SesiMasuk(Pengguna.dariJson(profil));
  }

  Future<void> keluar() async {
    final simpanan = ref.read(penyimpananSesiProvider);
    final tokenPush = await simpanan.bacaTokenPush();
    // Lepaskan perangkat dulu selagi token masih sah, supaya notifikasi
    // pemilik lama tidak muncul di ponsel yang dipakai orang lain.
    if (tokenPush != null) {
      try {
        await ref.read(klienApiProvider).delete('/devices', badan: {'token': tokenPush});
      } catch (_) {}
      await simpanan.simpanTokenPush(null);
    }
    await simpanan.hapusSemua();
    state = const SesiKeluar();
  }
}

final sesiProvider = NotifierProvider<SesiNotifier, StatusSesi>(SesiNotifier.new);

/// Pengguna saat ini, atau null bila belum masuk.
final penggunaProvider = Provider<Pengguna?>((ref) {
  final s = ref.watch(sesiProvider);
  return s is SesiMasuk ? s.pengguna : null;
});
