import 'package:flutter/material.dart';

/// Warna brand sama dengan aplikasi web: hijau sage mengikuti
/// pos.nbp.co.id (brand-600), dengan kuning emas hangat sebagai sekunder.
const Color warnaUtama = Color(0xFF4A7C62);
const Color warnaUtamaGelap = Color(0xFF3A6350);
const Color warnaUtamaModeGelap = Color(0xFF7FB897);
const Color warnaUtamaLembut = Color(0xFFE6EFE9);
const Color warnaUtamaLembutModeGelap = Color(0xFF1D3327);
const Color warnaSekunder = Color(0xFFD9A627);
const Color warnaSekunderModeGelap = Color(0xFFE6B93F);
const Color warnaSekunderLembut = Color(0xFFFDF3D7);
const Color warnaTeksDiSekunder = Color(0xFF1C3829);
const Color warnaSukses = Color(0xFF16A34A);
const Color warnaPeringatan = Color(0xFFD97706);
const Color warnaBahaya = Color(0xFFDC2626);
const Color warnaInfo = Color(0xFF0284C7);

ThemeData temaTerang() => _tema(Brightness.light);
ThemeData temaGelap() => _tema(Brightness.dark);

ThemeData _tema(Brightness brightness) {
  final terang = brightness == Brightness.light;
  // Skema diturunkan dari hijau brand, lalu warna kuncinya dipatok persis
  // supaya tidak digeser oleh algoritma seed.
  final skema = ColorScheme.fromSeed(seedColor: warnaUtama, brightness: brightness).copyWith(
    primary: terang ? warnaUtama : warnaUtamaModeGelap,
    onPrimary: terang ? Colors.white : const Color(0xFF0C1512),
    primaryContainer: terang ? warnaUtamaLembut : warnaUtamaLembutModeGelap,
    onPrimaryContainer: terang ? warnaTeksDiSekunder : const Color(0xFFDDEBE2),
    secondary: terang ? warnaSekunder : warnaSekunderModeGelap,
    onSecondary: terang ? warnaTeksDiSekunder : const Color(0xFF1C1A10),
    secondaryContainer: terang ? warnaSekunderLembut : const Color(0xFF3D2F0B),
    onSecondaryContainer: terang ? warnaTeksDiSekunder : const Color(0xFFF6E7B5),
    surface: terang ? Colors.white : const Color(0xFF12201A),
    surfaceContainerHighest: terang ? const Color(0xFFEEF3F0) : const Color(0xFF1A2B23),
    outlineVariant: terang ? const Color(0xFFDBE4DE) : const Color(0xFF26392F),
  );
  // Gaya teks AppBar dan tombol diturunkan dari textTheme, bukan TextStyle
  // kosong: TextStyle tanpa fontFamily membuang keluarga font platform.
  final teks = ThemeData(useMaterial3: true, colorScheme: skema).textTheme;
  return ThemeData(
    useMaterial3: true,
    colorScheme: skema,
    scaffoldBackgroundColor: terang ? const Color(0xFFF4F7F5) : const Color(0xFF0C1512),
    appBarTheme: AppBarTheme(
      centerTitle: false,
      elevation: 0,
      scrolledUnderElevation: 0,
      backgroundColor: Colors.transparent,
      foregroundColor: skema.onSurface,
      titleTextStyle: teks.titleLarge?.copyWith(fontSize: 20, fontWeight: FontWeight.w700, color: skema.onSurface),
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
      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)), textStyle: teks.labelLarge?.copyWith(fontWeight: FontWeight.w600)),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12))),
    ),
    snackBarTheme: const SnackBarThemeData(behavior: SnackBarBehavior.floating),
    // Aksi kedua yang menonjol (mis. Ajukan Cuti) memakai kuning sekunder.
    floatingActionButtonTheme: FloatingActionButtonThemeData(backgroundColor: skema.secondary, foregroundColor: skema.onSecondary),
    chipTheme: ChipThemeData(selectedColor: skema.secondaryContainer, checkmarkColor: skema.onSecondaryContainer),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: skema.primary),
    navigationBarTheme: NavigationBarThemeData(
      height: 64,
      indicatorColor: skema.primaryContainer,
      labelTextStyle: WidgetStatePropertyAll(TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: skema.onSurface)),
    ),
    dividerTheme: DividerThemeData(color: skema.outlineVariant.withValues(alpha: 0.5), space: 1),
  );
}
