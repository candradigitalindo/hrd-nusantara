"use client";

import * as React from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import { Table2, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatAngka, formatRupiah, formatRupiahRingkas } from "@/lib/utils";

export interface TitikData {
  label: string;
  nilai: number;
}

/**
 * Grafik batang satu seri, satu hue.
 *
 * Spesifikasi mark: batang <= 24px, ujung data membulat 4px dan rata di
 * garis dasar, grid hairline satu langkah dari permukaan, label langsung
 * hanya pada nilai tertinggi, tooltip per batang. Satu seri berarti tanpa
 * legenda — judulnya sudah menyebut apa yang diukur.
 *
 * Tampilan tabel selalu tersedia: tooltip melengkapi, tidak pernah
 * menjadi satu-satunya jalan ke angkanya.
 */
export const GrafikBatang = ({
  data,
  satuan = "",
  format = "angka",
  tinggi = 260,
}: {
  data: TitikData[];
  /** Satuan yang ditempel di belakang angka, mis. " diterima". */
  satuan?: string;
  /** "rupiah" memformat nilainya sebagai mata uang, bukan menempelkan "Rp" di belakang. */
  format?: "angka" | "rupiah";
  tinggi?: number;
}) => {
  const rupiah = format === "rupiah";
  // Nilai penuh untuk tooltip dan tabel; ringkas untuk sumbu yang sempit.
  const nilaiPenuh = (v: number) => (rupiah ? formatRupiah(v) : `${formatAngka(v)}${satuan}`);
  const nilaiSumbu = (v: number) => (rupiah ? formatRupiahRingkas(v) : formatAngka(v));
  const [tabel, setTabel] = React.useState(false);
  const [aktif, setAktif] = React.useState<number | null>(null);
  const maks = Math.max(...data.map((d) => d.nilai), 0);

  if (data.length === 0) {
    return <p className="px-2 py-8 text-center text-sm text-muted">Belum ada data untuk ditampilkan.</p>;
  }

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setTabel((v) => !v)} aria-pressed={tabel}>
          {tabel ? <BarChart3 className="h-4 w-4" aria-hidden /> : <Table2 className="h-4 w-4" aria-hidden />}
          {tabel ? "Grafik" : "Tabel"}
        </Button>
      </div>

      {tabel ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-2 pr-3 font-medium">Kategori</th>
              <th className="py-2 text-right font-medium">Nilai</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label} className="border-b border-border last:border-0">
                <td className="py-2 pr-3">{d.label}</td>
                <td className="py-2 text-right tabular-nums">{nilaiPenuh(d.nilai)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <ResponsiveContainer width="100%" height={tinggi}>
          <BarChart data={data} margin={{ top: 20, right: 8, left: -12, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "var(--border)" }}
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              interval="preserveStartEnd"
              minTickGap={8}
              tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted)", fontSize: 12 }}
              allowDecimals={false}
              width={rupiah ? 76 : undefined}
              tickFormatter={nilaiSumbu}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm shadow-md">
                    <p className="font-semibold tabular-nums">{nilaiPenuh(payload[0].value as number)}</p>
                    <p className="text-muted">{(payload[0].payload as TitikData).label}</p>
                  </div>
                ) : null
              }
            />
            <Bar
              dataKey="nilai"
              fill="var(--chart-1)"
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
              onMouseEnter={(_, i) => setAktif(i)}
              onMouseLeave={() => setAktif(null)}
              isAnimationActive={false}
            >
              {data.map((d, i) => (
                <Cell key={d.label} fillOpacity={aktif === null || aktif === i ? 1 : 0.55} />
              ))}
              {/* Label langsung hanya pada nilai tertinggi: yang lain lewat tooltip dan tabel. */}
              <LabelList
                dataKey="nilai"
                position="top"
                content={(p) => {
                  const { x, y, width, value } = p as { x?: number; y?: number; width?: number; value?: number };
                  if (value !== maks || x === undefined || y === undefined || width === undefined) return null;
                  return (
                    <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={12} fill="var(--foreground)" fontWeight={600}>
                      {nilaiSumbu(value)}
                    </text>
                  );
                }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};
