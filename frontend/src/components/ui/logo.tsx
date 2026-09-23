/**
 * Lambang aplikasi: kalender dengan centang — ikon Presensi, bentuk yang sama
 * dengan menu Presensi di sidebar, favicon, dan ikon peluncur Android.
 *
 * Bentuknya berasal dari satu sumber di `merek/buat-ikon.mjs`; kalau di sini
 * diubah, jalankan skrip itu supaya favicon dan ikon ponsel ikut berubah.
 * Warnanya dipatok (bukan mengikuti tema) seperti lambang pada umumnya.
 */
export const Logo = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 64 64" className={className} aria-hidden focusable="false">
    <rect width="64" height="64" rx="14" fill="#4A7C62" />
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <g stroke="#FFFFFF" strokeWidth="3.6">
        <rect x="13" y="17" width="38" height="34" rx="5" />
        <path d="M23 11.5v7M41 11.5v7" />
        <path d="M13 28h38" />
      </g>
      <path d="M23.5 39 29.5 45 41 33" stroke="#D9A627" strokeWidth="4.8" />
    </g>
  </svg>
);
