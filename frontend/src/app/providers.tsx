"use client";

import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";

export const Providers = ({ children }: { children: React.ReactNode }) => {
  const [client] = React.useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data HR jarang berubah tiap detik; 30 detik cukup segar tanpa
            // membanjiri backend saat orang berpindah-pindah tab.
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={client}>
      {children}
      {/*
        Notifikasi: pojok kanan atas di desktop, atas-tengah di ponsel supaya
        tidak tertutup jempol maupun bar navigasi bawah. richColors memberi
        warna sesuai jenisnya; closeButton supaya bisa ditutup tanpa menunggu.
      */}
      <Toaster
        position="top-center"
        richColors
        closeButton
        expand={false}
        duration={4500}
        toastOptions={{ className: "font-sans" }}
      />
    </QueryClientProvider>
  );
};
