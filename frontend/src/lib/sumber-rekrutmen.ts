export const sumberRekrutmen = (value: unknown): "jobstreet" | "linkedin" | undefined =>
  value === "jobstreet" || value === "linkedin" ? value : undefined;
