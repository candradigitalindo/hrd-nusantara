import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import '../../core/penyimpanan/cache_lokal.dart';
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
    final String? token;
    final Map<String, dynamic>? tersimpan;
    try {
      token = await simpanan.bacaToken();
      tersimpan = token == null ? null : await simpanan.bacaPengguna();
    } catch (e) {
      // Keystore/Keychain tak terbaca (dikenal terjadi setelah ponsel
      // dipulihkan dari cadangan): tanpa ini aplikasi macet selamanya di
      // layar memuat. Minta login ulang saja.
      debugPrint('Sesi tersimpan tidak terbaca: $e');
      state = const SesiKeluar();
      return;
    }
    if (token == null) {
      state = const SesiKeluar();
      return;
    }
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
    // Menyebut perangkat = meminta sesi perangkat (refresh token), supaya
    // tidak terlempar keluar setiap token akses kedaluwarsa.
    final hasil = await api.post('/auth/login', {
      'username': username.trim(),
      'password': password,
      'device': {'platform': Platform.isIOS ? 'ios' : 'android'},
    });
    await _hapusDataTersimpan();
    await simpanan.simpanToken(hasil['token'] as String);
    await simpanan.simpanRefreshToken(hasil['refreshToken'] as String?);
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
    // Sesi perangkat di server ikut diakhiri; gagal (mis. offline) tidak
    // menghalangi keluar — sesinya tetap berakhir sendiri saat kedaluwarsa.
    final refresh = await simpanan.bacaRefreshToken();
    if (refresh != null) {
      try {
        await ref.read(klienApiProvider).post('/auth/logout', {'refreshToken': refresh});
      } catch (_) {}
    }
    await simpanan.hapusSemua();
    await _hapusDataTersimpan();
    state = const SesiKeluar();
  }

  /// Salinan offline milik akun ini tidak boleh terbaca akun berikutnya di
  /// ponsel yang sama. Dipanggil saat keluar dan lagi saat masuk, kalau-kalau
  /// pembersihan saat keluar dulu gagal.
  Future<void> _hapusDataTersimpan() async {
    try {
      await ref.read(cacheLokalProvider).hapusSemua();
    } catch (e) {
      debugPrint('Data tersimpan gagal dihapus: $e');
    }
  }
}

final sesiProvider = NotifierProvider<SesiNotifier, StatusSesi>(SesiNotifier.new);

/// Pengguna saat ini, atau null bila belum masuk.
final penggunaProvider = Provider<Pengguna?>((ref) {
  final s = ref.watch(sesiProvider);
  return s is SesiMasuk ? s.pengguna : null;
});
