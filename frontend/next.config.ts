import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keluaran mandiri untuk container: Next melacak berkas yang benar-benar
  // dipakai dan menyalinnya beserta node_modules seperlunya, sehingga image
  // runtime tidak perlu memuat seluruh dependensi build.
  output: "standalone",
};

export default nextConfig;
