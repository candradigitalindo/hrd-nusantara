import 'dart:io' show Platform;

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/klien_api.dart';
import '../../firebase_options.dart';

/// Rute tujuan saat notifikasi diketuk, berdasarkan `data.jenis` dari backend.
String? ruteUntukPesan(Map<String, dynamic> data) => switch (data['jenis']) {
      'whatsapp_session' => '/whatsapp',
      'leave' || 'cuti' => '/cuti',
      'attendance' || 'presensi' => '/presensi',
      'announcement' || 'pengumuman' => '/pengumuman',
      _ => null,
    };

@pragma('vm:entry-point')
Future<void> _pesanLatarBelakang(RemoteMessage pesan) async {
  // Notifikasi dengan blok `notification` sudah ditampilkan sistem; tidak ada
  // yang perlu dikerjakan di sini selain menjaga handler tetap terdaftar.
}

/// Notifikasi push (FCM). Tidak aktif bila Firebase belum dikonfigurasi —
/// aplikasi tetap berjalan penuh tanpa push.
class LayananPush {
  LayananPush(this._ref);
  final Ref _ref;
  final _lokal = FlutterLocalNotificationsPlugin();
  bool _siap = false;
  void Function(String rute)? saatDiketuk;

  bool get aktif => _siap;

  static Future<bool> inisialisasiFirebase() async {
    if (!firebaseTerkonfigurasi) return false;
    try {
      await Firebase.initializeApp(options: opsiFirebase());
      FirebaseMessaging.onBackgroundMessage(_pesanLatarBelakang);
      return true;
    } catch (e) {
      debugPrint('Firebase tidak bisa diinisialisasi: $e');
      return false;
    }
  }

  /// Dipanggil setelah login: minta izin, ambil token, daftarkan ke backend.
  Future<void> daftarkan() async {
    if (!firebaseTerkonfigurasi || Firebase.apps.isEmpty) return;
    try {
      final fcm = FirebaseMessaging.instance;
      final izin = await fcm.requestPermission(alert: true, badge: true, sound: true);
      if (izin.authorizationStatus == AuthorizationStatus.denied) return;

      await _lokal.initialize(
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
          iOS: DarwinInitializationSettings(),
        ),
        onDidReceiveNotificationResponse: (r) {
          final rute = r.payload;
          if (rute != null && rute.isNotEmpty) saatDiketuk?.call(rute);
        },
      );

      final token = await fcm.getToken();
      if (token != null) await _kirimToken(token);
      fcm.onTokenRefresh.listen(_kirimToken);

      // Di latar depan sistem tidak menampilkan notifikasi; tampilkan sendiri.
      FirebaseMessaging.onMessage.listen((m) {
        final n = m.notification;
        if (n == null) return;
        _lokal.show(
          id: m.hashCode,
          title: n.title,
          body: n.body,
          notificationDetails: const NotificationDetails(
            android: AndroidNotificationDetails('hrd_utama', 'Pemberitahuan HRD', importance: Importance.high, priority: Priority.high),
            iOS: DarwinNotificationDetails(),
          ),
          payload: ruteUntukPesan(m.data),
        );
      });
      FirebaseMessaging.onMessageOpenedApp.listen((m) {
        final rute = ruteUntukPesan(m.data);
        if (rute != null) saatDiketuk?.call(rute);
      });
      final awal = await fcm.getInitialMessage();
      if (awal != null) {
        final rute = ruteUntukPesan(awal.data);
        if (rute != null) saatDiketuk?.call(rute);
      }
      _siap = true;
    } catch (e) {
      debugPrint('Push tidak aktif: $e');
    }
  }

  Future<void> _kirimToken(String token) async {
    try {
      await _ref.read(klienApiProvider).post('/devices', {'token': token, 'platform': Platform.isIOS ? 'ios' : 'android'});
      await _ref.read(penyimpananSesiProvider).simpanTokenPush(token);
    } catch (e) {
      debugPrint('Token push gagal didaftarkan: $e');
    }
  }
}

final layananPushProvider = Provider<LayananPush>((ref) => LayananPush(ref));
