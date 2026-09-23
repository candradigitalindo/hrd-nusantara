"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Logo } from "@/components/ui/logo";

type Nilai = { email: string; password: string };

function FormMasuk() {
  const router = useRouter();
  const params = useSearchParams();
  const kembali = params.get("kembali") ?? "/karier/dashboard";
  const [lihat, setLihat] = React.useState(false);
  const [galat, setGalat] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { isSubmitting, errors },
  } = useForm<Nilai>({ defaultValues: { email: "", password: "" } });

  const masuk = async (v: Nilai) => {
    setGalat(null);
    try {
      await api.post("/karier/masuk", v);
      // Token disimpan server sebagai cookie httpOnly; peramban tidak pernah
      // memegangnya. Setelah itu tinggal pindah halaman.
      router.replace(kembali);
      router.refresh();
    } catch (e) {
      const pesan = (e as { response?: { data?: { error?: string } } }).response?.data?.error;
      setGalat(pesan ?? "Tidak bisa masuk. Coba lagi sebentar lagi.");
    }
  };

  return (
    <form onSubmit={handleSubmit(masuk)} className="space-y-4" noValidate>
      {galat && <Alert tone="danger" title="Gagal masuk">{galat}</Alert>}
      <Field label="Email" error={errors.email?.message}>
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          {...register("email", { required: "Email wajib diisi" })}
          aria-invalid={Boolean(errors.email)}
        />
      </Field>
      <Field label="Kata sandi" error={errors.password?.message}>
        <div className="relative">
          <Input
            type={lihat ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            className="pr-11"
            {...register("password", { required: "Kata sandi wajib diisi" })}
            aria-invalid={Boolean(errors.password)}
          />
          <button
            type="button"
            onClick={() => setLihat((v) => !v)}
            aria-label={lihat ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
            className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted hover:bg-surface-2"
          >
            {lihat ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
        {!isSubmitting && <LogIn className="h-4 w-4" aria-hidden />} Masuk
      </Button>
    </form>
  );
}

/** Pintu masuk portal pelamar. Terpisah dari login karyawan. */
export default function HalamanMasukPelamar() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4 py-12">
      <div className="text-center">
        <Logo className="mx-auto h-12 w-12" />
        <h1 className="mt-4 text-2xl font-bold tracking-tight">Portal Pelamar</h1>
        <p className="mt-1 text-sm text-muted">Pantau lamaran, tes, dan jadwal wawancara Anda.</p>
      </div>
      <div className="mt-6 rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
        <React.Suspense>
          <FormMasuk />
        </React.Suspense>
      </div>
      <p className="mt-5 text-center text-sm text-muted">
        Belum punya akun?{" "}
        <Link href="/karier/daftar" className="font-medium text-primary hover:underline">
          Daftar di sini
        </Link>
      </p>
      <p className="mt-2 text-center text-xs text-muted">
        Karyawan masuk lewat <Link href="/login" className="hover:underline">halaman karyawan</Link>.
      </p>
    </div>
  );
}
