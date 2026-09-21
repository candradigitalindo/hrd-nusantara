"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Eye, EyeOff, LogIn } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";
import { notifikasi } from "@/hooks/use-notifikasi";

// Username = nomor HP/WhatsApp; email tetap diterima sebagai cadangan.
const skema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "Nomor HP wajib diisi")
    .refine((v) => v.includes("@") || v.replace(/\D/g, "").length >= 9, "Masukkan nomor HP (08xx / +62xx) atau email"),
  password: z.string().min(1, "Kata sandi wajib diisi"),
});
type Nilai = z.infer<typeof skema>;

function FormLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const [lihat, setLihat] = React.useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Nilai>({ resolver: zodResolver(skema) });

  const masuk = async (nilai: Nilai) => {
    try {
      const { data } = await api.post<{ user: { name: string } }>("/auth/login", nilai);
      notifikasi.sukses(`Selamat datang, ${data.user.name}`);
      const kembali = params.get("kembali");
      router.replace(kembali && kembali.startsWith("/") ? kembali : "/");
      router.refresh();
    } catch (error) {
      notifikasi.galat(error, "Login gagal");
    }
  };

  return (
    <form onSubmit={handleSubmit(masuk)} className="space-y-4" noValidate>
      <Field label="Nomor HP / WhatsApp" error={errors.username?.message} hint="Nomor yang terdaftar di HR, mis. 0812xxxx. Email juga bisa.">
        <Input
          type="text"
          autoComplete="username"
          inputMode="tel"
          placeholder="0812 3456 7890"
          aria-invalid={Boolean(errors.username)}
          {...register("username")}
        />
      </Field>
      <Field label="Kata sandi" error={errors.password?.message}>
        <div className="relative">
          <Input
            type={lihat ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••"
            className="pr-11"
            aria-invalid={Boolean(errors.password)}
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setLihat((v) => !v)}
            className="absolute inset-y-0 right-0 grid w-11 place-items-center text-muted hover:text-foreground"
            aria-label={lihat ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
          >
            {lihat ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
          </button>
        </div>
      </Field>
      <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
        {!isSubmitting && <LogIn className="h-4 w-4" aria-hidden />}
        Masuk
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6 animate-fade-up">
        <div className="text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary text-on-primary text-xl font-bold">
            H
          </span>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">HRD Nusantara</h1>
          <p className="mt-1 text-sm text-muted">Masuk dengan akun karyawan Anda</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6">
          <React.Suspense>
            <FormLogin />
          </React.Suspense>
        </div>
        <p className="text-center text-xs text-muted">
          Lupa kata sandi? Hubungi HR untuk pengaturan ulang.
        </p>
      </div>
    </div>
  );
}
