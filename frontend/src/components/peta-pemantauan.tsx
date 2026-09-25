"use client";

import * as React from "react";
import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap } from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";

export interface TitikPeta {
  id: string;
  lat: number;
  lng: number;
  judul: string;
  keterangan?: string;
  /** Warna penanda: segar (baru), lama (belum melapor lagi), jalur (titik riwayat). */
  nada?: "segar" | "lama" | "jalur" | "awal" | "akhir";
}

const WARNA: Record<NonNullable<TitikPeta["nada"]>, string> = {
  segar: "#4A7C62",
  lama: "#D97706",
  jalur: "#0284C7",
  awal: "#16A34A",
  akhir: "#DC2626",
};

/** Menyesuaikan tampilan peta dengan titik yang sedang ditampilkan. */
function Paskan({ titik }: { titik: TitikPeta[] }) {
  const peta = useMap();
  const kunci = titik.map((t) => `${t.lat},${t.lng}`).join("|");
  React.useEffect(() => {
    if (titik.length === 0) return;
    if (titik.length === 1) {
      peta.setView([titik[0].lat, titik[0].lng], 16);
      return;
    }
    const batas: LatLngBoundsExpression = titik.map((t) => [t.lat, t.lng] as [number, number]);
    peta.fitBounds(batas, { padding: [32, 32], maxZoom: 17 });
    // Hanya saat kumpulan titik berubah, bukan setiap render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunci, peta]);
  return null;
}

/**
 * Peta OpenStreetMap untuk Pemantauan Lokasi. Dimuat hanya di peramban
 * (next/dynamic ssr:false) karena Leaflet membutuhkan `window`.
 * Penanda berupa lingkaran, bukan ikon gambar, supaya tidak bergantung pada
 * aset marker Leaflet yang tidak ikut terbundel.
 */
export default function PetaPemantauan({ titik, jalur, tinggi = 420 }: { titik: TitikPeta[]; jalur?: [number, number][]; tinggi?: number }) {
  const pusat: LatLngExpression = titik[0] ? [titik[0].lat, titik[0].lng] : [-6.2, 106.816];
  return (
    <MapContainer center={pusat} zoom={12} scrollWheelZoom style={{ height: tinggi, width: "100%" }} className="z-0 rounded-xl">
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {jalur && jalur.length > 1 && <Polyline positions={jalur} pathOptions={{ color: WARNA.jalur, weight: 3, opacity: 0.7 }} />}
      {titik.map((t) => (
        <CircleMarker
          key={t.id}
          center={[t.lat, t.lng]}
          radius={t.nada === "jalur" ? 4 : 8}
          pathOptions={{ color: "#ffffff", weight: 2, fillColor: WARNA[t.nada ?? "segar"], fillOpacity: 0.95 }}
        >
          <Popup>
            <strong>{t.judul}</strong>
            {t.keterangan && (
              <>
                <br />
                {t.keterangan}
              </>
            )}
          </Popup>
        </CircleMarker>
      ))}
      <Paskan titik={titik} />
    </MapContainer>
  );
}
