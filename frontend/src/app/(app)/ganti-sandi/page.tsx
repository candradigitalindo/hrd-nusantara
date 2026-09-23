"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { useSesi } from "@/hooks/use-sesi";
import { notifikasi } from "@/hooks/use-notifikasi";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

type Nilai = { currentPassword: string; newPassword: string; ulang: string };

/** Ganti kata sandi sendiri; juga halaman wajib setelah HR mengatur ulang sandi. */
export default function HalamanGantiSandi() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: saya } = useSesi();
  const wajib = saya?.mustChangePassword === true;
  const { register, handleSubmit, control, formState: { errors, isSubmitting } } = useForm<Nilai>({ defaultValues: { currentPassword: "", newPassword: "", ulang: "" } });
  const baru = useWatch({ control, name: "newPassword" });

  const simpan = async (v: Nilai) => {
    try {
      await api.post("/auth/change-password", { currentPassword: v.currentPassword, newPassword: v.newPassword });
      await qc.invalidateQueries({ queryKey: ["sesi"] });
      notifikasi.sukses("Kata sandi diganti", "Gunakan sandi baru saat masuk berikutnya, di web maupun aplikasi Android.");
      router.replace("/");
    } catch (e) {
      notifikasi.galat(e, "Kata sandi belum diganti");
    }
  };

  return (
    <>
      <PageHeader title={wajib ? "Buat kata sandi baru" : "Ganti kata sandi"} description={wajib ? "Sandi dari HR bersifat sementara; buat sandi yang hanya Anda ketahui sebelum melanjutkan." : "Sandi berlaku untuk web dan aplikasi Android."} />
      <Card className="max-w-lg">
        <CardContent className="pt-6">
          {wajib && (
            <Alert tone="warning" title="Sandi sementara" className="mb-4">
              HR baru saja mengatur ulang kata sandi Anda. Halaman lain terbuka setelah sandi diganti.
            </Alert>
          )}
          <form onSubmit={handleSubmit(simpan)} className="space-y-4" noValidate>
            <Field label={wajib ? "Sandi sementara dari HR" : "Sandi saat ini"} error={errors.currentPassword?.message}>
              <Input type="password" autoComplete="current-password" {...register("currentPassword", { required: "Wajib diisi" })} />
            </Field>
            <Field label="Sandi baru" error={errors.newPassword?.message} hint="Minimal 8 karakter, berbeda dari sandi sebelumnya">
              <Input type="password" autoComplete="new-password" {...register("newPassword", { required: "Wajib diisi", minLength: { value: 8, message: "Minimal 8 karakter" }, validate: (v, f) => v !== f.currentPassword || "Harus berbeda dari sandi sebelumnya" })} />
            </Field>
            <Field label="Ulangi sandi baru" error={errors.ulang?.message}>
              <Input type="password" autoComplete="new-password" {...register("ulang", { validate: (v) => v === baru || "Tidak sama dengan sandi baru" })} />
            </Field>
            <Button type="submit" loading={isSubmitting} className="w-full sm:w-auto">
              <KeyRound className="h-4 w-4" aria-hidden /> {wajib ? "Simpan & lanjutkan" : "Simpan sandi baru"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
