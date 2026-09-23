"use client";

import * as React from "react";
import { X, AlertTriangle, Check, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

/**
 * Dialog yang jadi lembar dari bawah di ponsel dan kotak di tengah di layar
 * lebar. Ditutup dengan Esc, klik latar, atau tombol; fokus dikunci ke dalam.
 */
export const Modal = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "md" | "lg";
}) => {
  React.useEffect(() => {
    if (!open) return;
    const tutup = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", tutup);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", tutup);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="presentation">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={cn(
          "relative w-full max-h-[92dvh] overflow-y-auto rounded-t-2xl bg-surface shadow-xl animate-fade-up",
          "sm:rounded-2xl sm:m-4",
          size === "lg" ? "sm:max-w-2xl" : "sm:max-w-lg"
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border p-4 sm:p-5">
          <div>
            <h2 id="modal-title" className="text-lg font-semibold">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Tutup">
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </div>
        {children && <div className="p-4 sm:p-5">{children}</div>}
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-border p-4 sm:flex-row sm:justify-end sm:p-5 pb-safe">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Konfirmasi untuk aksi yang tidak bisa dibatalkan. Tombol utamanya merah dan
 * menyebut aksinya ("Hapus", bukan "OK") supaya orang tahu apa yang ditekan.
 */
export const ConfirmDialog = ({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Lanjutkan",
  confirmIcon: IkonKonfirmasi = Check,
  loading,
  danger,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  /** Ikon tombol konfirmasi; isi sesuai tindakannya (Trash2, UserX, …). */
  confirmIcon?: LucideIcon;
  loading?: boolean;
  danger?: boolean;
}) => (
  <Modal
    open={open}
    onClose={onClose}
    title={title}
    footer={
      <>
        <Button variant="outline" onClick={onClose} disabled={loading}>
          <X className="h-4 w-4" aria-hidden />
          Batal
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
          {!loading && <IkonKonfirmasi className="h-4 w-4" aria-hidden />}
          {confirmLabel}
        </Button>
      </>
    }
  >
    <div className="flex gap-3">
      {danger && (
        <span className="shrink-0 rounded-xl bg-danger-soft p-2.5 text-danger">
          <AlertTriangle className="h-5 w-5" aria-hidden />
        </span>
      )}
      <p className="text-sm text-muted">{description}</p>
    </div>
  </Modal>
);
