"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const dasar =
  "w-full rounded-lg border border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted " +
  "transition-colors focus:border-ring disabled:opacity-60 aria-[invalid=true]:border-danger";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(dasar, "h-10", className)} {...props} />;
  }
);

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(dasar, "min-h-24 py-2", className)} {...props} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn(dasar, "h-10 pr-8", className)} {...props}>
        {children}
      </select>
    );
  }
);

/** Label + kontrol + pesan galat, dalam satu blok yang konsisten di semua formulir. */
export const Field = ({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) => (
  <label className={cn("flex flex-col gap-1.5", className)}>
    <span className="text-sm font-medium">{label}</span>
    {children}
    {error ? (
      <span role="alert" className="text-xs text-danger">
        {error}
      </span>
    ) : hint ? (
      <span className="text-xs text-muted">{hint}</span>
    ) : null}
  </label>
);
