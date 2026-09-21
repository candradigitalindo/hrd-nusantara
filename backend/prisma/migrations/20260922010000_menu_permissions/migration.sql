-- Izin akses menu: halaman layanan mandiri sebelumnya terbuka untuk semua
-- pengguna, jadi setiap peran yang sudah ada (sistem maupun kustom) diberi
-- kunci-kunci ini supaya tidak ada yang tiba-tiba kehilangan akses.
UPDATE "CustomRole" SET "permissions" = ARRAY(SELECT x FROM unnest("permissions" || ARRAY['halaman.dashboard', 'halaman.pengumuman', 'halaman.chat', 'halaman.whatsapp_saya', 'halaman.presensi', 'halaman.cuti', 'halaman.gaji', 'halaman.pelatihan', 'halaman.kinerja', 'halaman.kompetensi', 'halaman.kasus', 'halaman.unduh']::TEXT[]) WITH ORDINALITY AS t(x, ord) GROUP BY x ORDER BY min(ord));

-- Wawancara: sebelumnya menu Rekrutmen tampil untuk manajer ke atas.
UPDATE "CustomRole" SET "permissions" = ARRAY(SELECT x FROM unnest("permissions" || ARRAY['rekrutmen.wawancara']::TEXT[]) WITH ORDINALITY AS t(x, ord) GROUP BY x ORDER BY min(ord)) WHERE "baseRole" IN ('MANAGER', 'HR_ADMIN', 'SUPER_ADMIN');
