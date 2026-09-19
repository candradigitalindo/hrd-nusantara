"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Search, UserX, Users, Pencil } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi, bolehHr } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { ResponsiveTable, type Kolom } from "@/components/ui/responsive-table";
import { Pagination } from "@/components/ui/pagination";
import { SkeletonBaris } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfirmDialog } from "@/components/ui/modal";
import { FormKaryawan } from "@/components/karyawan/form-karyawan";
import { formatTanggal, labelStatus, LABEL_ROLE, LABEL_STATUS, inisial } from "@/lib/utils";
import type { Halaman, Karyawan, Departemen } from "@/lib/types";

export default function HalamanKaryawan() {
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const hr = bolehHr(saya?.role);

  const [cari, setCari] = React.useState("");
  const [cariTunda, setCariTunda] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [dept, setDept] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [form, setForm] = React.useState<{ open: boolean; karyawan: Karyawan | null }>({ open: false, karyawan: null });
  const [nonaktif, setNonaktif] = React.useState<Karyawan | null>(null);

  // Pencarian ditunda 300ms supaya tiap ketukan tidak jadi satu permintaan.
  React.useEffect(() => {
    const t = setTimeout(() => {
      setCariTunda(cari);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [cari]);

  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (cariTunda) params.set("search", cariTunda);
  if (status) params.set("status", status);
  if (dept) params.set("departmentId", dept);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["karyawan", params.toString()],
    queryFn: async () => (await api.get<Halaman<Karyawan>>(`/employees?${params}`)).data,
    placeholderData: (prev) => prev,
  });

  const { data: departemen } = useQuery({
    queryKey: ["departemen", "semua"],
    queryFn: async () => (await api.get<Halaman<Departemen>>("/departments?limit=100")).data.data,
  });

  const nonaktifkan = useMutation({
    mutationFn: async (k: Karyawan) => (await api.patch(`/employees/${k.id}/deactivate`, {})).data,
    onSuccess: (_, k) => {
      qc.invalidateQueries({ queryKey: ["karyawan"] });
      notifikasi.sukses("Karyawan dinonaktifkan", `${k.name} tidak lagi bisa login. Datanya tetap tersimpan.`);
      setNonaktif(null);
    },
    onError: (e) => notifikasi.galat(e, "Gagal menonaktifkan"),
  });

  const kolom: Kolom<Karyawan>[] = [
    {
      key: "nama",
      header: "Karyawan",
      primary: true,
      cell: (k) => (
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-primary text-xs font-semibold">
            {inisial(k.name)}
          </span>
          <div className="min-w-0">
            <p className="font-medium truncate">{k.name}</p>
            <p className="text-xs text-muted truncate">{k.nik} · {k.email}</p>
          </div>
        </div>
      ),
    },
    { key: "dept", header: "Departemen", cell: (k) => k.department?.name ?? <span className="text-muted">—</span> },
    { key: "jabatan", header: "Jabatan", cell: (k) => k.position?.name ?? <span className="text-muted">—</span> },
    { key: "peran", header: "Peran", cell: (k) => LABEL_ROLE[k.role] },
    {
      key: "status",
      header: "Status",
      cell: (k) => (
        <Badge tone={nadaStatus(k.status)} dot>
          {labelStatus(k.status)}
        </Badge>
      ),
    },
    { key: "gabung", header: "Bergabung", cell: (k) => formatTanggal(k.joinDate) },
    ...(hr
      ? [
          {
            key: "aksi",
            header: "",
            hideOnMobile: false,
            className: "text-right",
            cell: (k: Karyawan) => (
              <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="sm" onClick={() => setForm({ open: true, karyawan: k })} aria-label={`Sunting ${k.name}`}>
                  <Pencil className="h-4 w-4" aria-hidden />
                  <span className="hidden sm:inline">Sunting</span>
                </Button>
                {k.status !== "inactive" && k.status !== "resign" && k.status !== "terminated" && (
                  <Button variant="ghost" size="sm" className="text-danger" onClick={() => setNonaktif(k)} aria-label={`Nonaktifkan ${k.name}`}>
                    <UserX className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </div>
            ),
          } satisfies Kolom<Karyawan>,
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Karyawan"
        description={data ? `${data.pagination.total} karyawan terdaftar` : "Data seluruh karyawan"}
        actions={
          hr && (
            <Button onClick={() => setForm({ open: true, karyawan: null })}>
              <Plus className="h-4 w-4" aria-hidden /> Tambah Karyawan
            </Button>
          )
        }
      />

      <Card>
        <div className="grid gap-2 border-b border-border p-3 sm:grid-cols-[1fr_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              className="pl-9"
              placeholder="Cari nama, NIK, atau email…"
              value={cari}
              onChange={(e) => setCari(e.target.value)}
              aria-label="Cari karyawan"
            />
          </div>
          <Select value={dept} onChange={(e) => { setDept(e.target.value); setPage(1); }} aria-label="Saring departemen" className="sm:w-48">
            <option value="">Semua departemen</option>
            {(departemen ?? []).map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Saring status" className="sm:w-44">
            <option value="">Semua status</option>
            {Object.entries(LABEL_STATUS)
              .filter(([k]) => ["active", "probation", "contract", "internship", "on_leave", "inactive", "resign", "terminated"].includes(k))
              .map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
          </Select>
        </div>

        {isLoading ? (
          <SkeletonBaris />
        ) : isError ? (
          <EmptyState title="Gagal memuat" description={(error as Error).message} />
        ) : data && data.data.length === 0 ? (
          <EmptyState
            icon={Users}
            title={cariTunda || status || dept ? "Tidak ada yang cocok" : "Belum ada karyawan"}
            description={cariTunda || status || dept ? "Coba ubah kata kunci atau saringan." : "Tambahkan karyawan pertama untuk memulai."}
            action={hr && !cariTunda && <Button onClick={() => setForm({ open: true, karyawan: null })}>Tambah Karyawan</Button>}
          />
        ) : (
          data && (
            <>
              <ResponsiveTable columns={kolom} rows={data.data} rowKey={(k) => k.id} onRowClick={hr ? (k) => setForm({ open: true, karyawan: k }) : undefined} />
              <Pagination pagination={data.pagination} onPage={setPage} />
            </>
          )
        )}
      </Card>

      <FormKaryawan open={form.open} onClose={() => setForm({ open: false, karyawan: null })} karyawan={form.karyawan} peranSaya={saya?.role} />

      <ConfirmDialog
        open={Boolean(nonaktif)}
        onClose={() => setNonaktif(null)}
        onConfirm={() => nonaktif && nonaktifkan.mutate(nonaktif)}
        loading={nonaktifkan.isPending}
        danger
        title="Nonaktifkan karyawan?"
        description={`${nonaktif?.name ?? ""} tidak akan bisa login lagi. Riwayat presensi dan penggajiannya tetap tersimpan — data karyawan tidak pernah dihapus.`}
        confirmLabel="Nonaktifkan"
      />
    </>
  );
}
