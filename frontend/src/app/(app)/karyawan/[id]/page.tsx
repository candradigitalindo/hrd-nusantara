"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Mail, Phone, MapPin, Calendar, Building2, Briefcase } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi, punyaIzin } from "@/hooks/use-sesi";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge, nadaStatus } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert } from "@/components/ui/alert";
import { PanelDokumen } from "@/components/karyawan/dokumen-karyawan";
import { PanelGaji } from "@/components/karyawan/panel-gaji";
import { formatTanggal, labelStatus, LABEL_ROLE, inisial } from "@/lib/utils";
import type { Karyawan } from "@/lib/types";

const Baris = ({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: React.ReactNode }) => (
  <div className="flex items-start gap-3 py-2">
    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm break-words">{value ?? <span className="text-muted">—</span>}</p>
    </div>
  </div>
);

export default function HalamanDetailKaryawan() {
  const { id } = useParams<{ id: string }>();
  const { data: saya } = useSesi();
  const hr = punyaIzin(saya, "karyawan.kelola");
  const gaji = punyaIzin(saya, "payroll.kelola");
  const dokumen = punyaIzin(saya, "dokumen.kelola");

  const { data: k, isLoading, isError, error } = useQuery({
    queryKey: ["karyawan", id],
    queryFn: async () => (await api.get<Karyawan>(`/employees/${id}`)).data,
  });

  return (
    <>
      <Link href="/karyawan" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Kembali ke daftar
      </Link>

      {isError && <Alert tone="danger" title="Karyawan tidak bisa dimuat">{(error as Error).message}</Alert>}

      {isLoading || !k ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <PageHeader
            title={k.name}
            description={`${k.nik} · ${k.customRole?.name ?? LABEL_ROLE[k.role]}`}
            actions={<Badge tone={nadaStatus(k.status)} dot className="text-sm px-3 py-1">{labelStatus(k.status)}</Badge>}
          />

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-1">
              <CardHeader className="items-center text-center">
                <span className="grid h-16 w-16 place-items-center rounded-full bg-primary-soft text-primary text-xl font-semibold">
                  {inisial(k.name)}
                </span>
                <CardTitle className="mt-2">{k.name}</CardTitle>
              </CardHeader>
              <CardContent className="divide-y divide-border">
                <Baris icon={Building2} label="Departemen" value={k.department?.name} />
                <Baris icon={Briefcase} label="Jabatan" value={k.position?.name} />
                <Baris icon={Mail} label="Email" value={k.email} />
                <Baris icon={Phone} label="No. HP" value={k.phoneNumber} />
                <Baris icon={MapPin} label="Alamat" value={k.address} />
                <Baris icon={Calendar} label="Bergabung" value={formatTanggal(k.joinDate)} />
                <Baris icon={Calendar} label="Tanggal lahir" value={formatTanggal(k.dateOfBirth)} />
              </CardContent>
              {hr && (
                <div className="border-t border-border p-4">
                  <Button variant="outline" className="w-full" onClick={() => history.back()}>Sunting dari daftar</Button>
                </div>
              )}
            </Card>

            <div className="space-y-4 lg:col-span-2">
              {gaji && <PanelGaji employeeId={k.id} />}
              <PanelDokumen employeeId={k.id} hr={dokumen} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
