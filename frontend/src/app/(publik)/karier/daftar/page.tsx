"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Logo } from "@/components/ui/logo";

type Nilai = { name: string; email: string; phoneNumber: string; password: string; ulangi: string; situs: string };

function FormDaftar() {
  const router = useRouter();
  const params = useSearchParams();
  const lowongan = params.get("lowongan");
  const [galat, setGalat] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { isSubmitting, errors },
  } = useForm<Nilai>({ defaultValues: { name: "", email: "", phoneNumber: "", password: "", ulangi: "", situs: "" } });

  const daftar = async (v: Nilai) => {
    setGalat(null);
    try {
      await api.post("/karier/daftar", {
        name: v.name,
        email: v.email,
        ...(v.phoneNumber ? { phoneNumber: v.phoneNumber } : {}),
        password: v.password,
        situs: v.situs,
      });
      // Langsung ke dashboard; bila datang dari sebuah lowongan, formulir
      // lamarannya dibuka sekalian.
      router.replace(lowongan ? `/karier/dashboard?lamar=${lowongan}` : "/karier/dashboard");
      router.refresh();
    } catch (e) {
      const pesan = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      setGalat(pesan ?? "Pendaftaran gagal. Coba lagi sebentar lagi.");
    }
  };

  return (
    <form onSubmit={handleSubmit(daftar)} className="space-y-4" noValidate>
      {galat && <Alert tone="danger" title="Gagal mendaftar">{galat}</Alert>}

      {/* Umpan perangkap untuk pengisi formulir otomatis; disembunyikan dari
          orang dan dari pembaca layar, bukan sekadar dari mata. */}
      <div className="hidden" aria-hidden>
        <label htmlFor="situs">Jangan diisi</label>
        <input id="situs" tabIndex={-1} autoComplete="off" {...register("situs")} />
      </div>

      <Field label="Nama lengkap" error={errors.name?.message}>
        <Input autoComplete="name" {...register("name", { required: "Nama wajib diisi", minLength: { value: 2, message: "Terlalu pendek" } })} />
      </Field>
      <Field label="Email" hint="Dipakai untuk masuk dan menerima kabar seleksi" error={errors.email?.message}>
        <Input type="email" inputMode="email" autoComplete="email" {...register("email", { required: "Email wajib diisi" })} />
      </Field>
      <Field label="No. HP / WhatsApp (opsional)" error={errors.phoneNumber?.message}>
        <Input inputMode="tel" autoComplete="tel" placeholder="0812 3456 7890" {...register("phoneNumber")} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Kata sandi" hint="Minimal 8 karakter" error={errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...register("password", { required: "Wajib diisi", minLength: { value: 8, message: "Minimal 8 karakter" } })} />
        </Field>
        <Field label="Ulangi kata sandi" error={errors.ulangi?.message}>
          <Input
            type="password"
            autoComplete="new-password"
            {...register("ulangi", { required: "Wajib diisi", validate: (v) => v === getValues("password") || "Tidak sama dengan kata sandi" })}
          />
        </Field>
      </div>

      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
        {!isSubmitting && <UserPlus className="h-4 w-4" aria-hidden />} Buat akun
      </Button>
      <p className="text-center text-xs text-muted">
        Dengan mendaftar, Anda setuju data lamaran diproses tim SDM kami untuk keperluan seleksi.
      </p>
    </form>
  );
}

/** Pendaftaran akun pelamar. Satu akun dipakai untuk semua lamaran. */
export default function HalamanDaftarPelamar() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12">
      <div className="text-center">
        <Logo className="mx-auto h-12 w-12" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Buat akun pelamar</h1>
        <p className="mt-1 text-sm text-muted">Satu akun untuk semua lowongan yang Anda lamar.</p>
      </div>
      <div className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
        <React.Suspense>
          <FormDaftar />
        </React.Suspense>
      </div>
      <p className="mt-5 text-center text-sm text-muted">
        Sudah punya akun?{" "}
        <Link href="/karier/masuk" className="font-medium text-primary hover:underline">
          Masuk
        </Link>
      </p>
    </div>
  );
}
