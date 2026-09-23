import 'package:flutter_test/flutter_test.dart';
import 'package:hrd_nusantara/fitur/auth/model_pengguna.dart';
import 'package:hrd_nusantara/fitur/profil/layar_profil.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'alat_uji.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting('id_ID');
    await muatFontAsli();
  });

  test('penanda wajib ganti sandi dibaca dari mustChangePassword', () {
    final p = Pengguna.dariJson({'id': 'K1', 'name': 'Budi', 'email': 'budi@contoh.id', 'mustChangePassword': true});
    expect(p.wajibGantiSandi, isTrue);
    expect(Pengguna.dariJson(p.keJson()).wajibGantiSandi, isTrue);
    expect(Pengguna.dariJson({'id': 'K2', 'name': 'Siti', 'email': 's@contoh.id'}).wajibGantiSandi, isFalse);
  });

  testWidgets('layar ganti sandi wajib: tidak bisa kembali, memvalidasi sebelum memanggil server', (tester) async {
    ukuranPonsel(tester);
    await tester.pumpWidget(aplikasiUji(const LayarGantiPassword(wajib: true)));
    await tester.pumpAndSettle();
    expect(find.text('Buat Password Baru'), findsOneWidget);
    expect(find.textContaining('HR mengatur ulang kata sandi Anda'), findsOneWidget);
    expect(find.text('Password sementara dari HR'), findsOneWidget);
    expect(find.text('Keluar'), findsOneWidget);
    expect(find.byTooltip('Back'), findsNothing);
    await tester.tap(find.text('Simpan & Lanjutkan'));
    await tester.pump();
    expect(find.text('Wajib diisi'), findsOneWidget);
    expect(find.text('Minimal 8 karakter'), findsNWidgets(2)); // teks bantuan + pesan galat
    await potret(tester, 'ganti-sandi-wajib');
  });
}
