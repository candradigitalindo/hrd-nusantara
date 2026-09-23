import type { MetadataRoute } from "next";
import { ALAMAT_SITUS, ambilLowongan } from "@/lib/karier-server";

/** Peta situs: halaman statis publik ditambah satu entri per lowongan tayang. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { data } = await ambilLowongan();

  const statis: MetadataRoute.Sitemap = [
    { url: ALAMAT_SITUS, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${ALAMAT_SITUS}/lowongan`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${ALAMAT_SITUS}/unduh`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.4 },
  ];

  return [
    ...statis,
    ...data.map((l) => ({
      url: `${ALAMAT_SITUS}/lowongan/${l.id}`,
      lastModified: new Date(l.createdAt),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}
