import 'package:flutter/material.dart';

/// Warna utama sama dengan aplikasi web (indigo), supaya karyawan mengenali
/// keduanya sebagai satu sistem.
const Color warnaUtama = Color(0xFF4F46E5);
const Color warnaSukses = Color(0xFF16A34A);
const Color warnaPeringatan = Color(0xFFD97706);
const Color warnaBahaya = Color(0xFFDC2626);
const Color warnaInfo = Color(0xFF0284C7);

ThemeData temaTerang() => _tema(Brightness.light);
ThemeData temaGelap() => _tema(Brightness.dark);

ThemeData _tema(Brightness brightness) {
  final skema = ColorScheme.fromSeed(seedColor: warnaUtama, brightness: brightness);
  return ThemeData(
    useMaterial3: true,
    colorScheme: skema,
    scaffoldBackgroundColor: brightness == Brightness.light ? const Color(0xFFF6F7FB) : const Color(0xFF0F1117),
    appBarTheme: AppBarTheme(
      centerTitle: false,
      elevation: 0,
      scrolledUnderElevation: 0,
      backgroundColor: Colors.transparent,
      foregroundColor: skema.onSurface,
      titleTextStyle: TextStyle(fontSize: 20, fontWeight: FontWeight.w700, color: skema.onSurface),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: skema.surface,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: skema.outlineVariant.withValues(alpha: 0.5))),
      margin: EdgeInsets.zero,
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: skema.surface,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: skema.outlineVariant)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: skema.outlineVariant)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: skema.primary, width: 2)),
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)), textStyle: const TextStyle(fontWeight: FontWeight.w600)),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    navigationBarTheme: NavigationBarThemeData(
      height: 64,
      indicatorColor: skema.primaryContainer,
      labelTextStyle: WidgetStatePropertyAll(TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: skema.onSurface)),
    ),
    dividerTheme: DividerThemeData(color: skema.outlineVariant.withValues(alpha: 0.5), space: 1),
  );
}
