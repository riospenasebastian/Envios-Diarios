import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .trim();
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + "...";
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Returns semantic CSS classes for order status badges.
 * Classes use CSS variables (--c-*) that automatically adapt
 * to both dark and light themes with proper WCAG AA contrast.
 */
export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    PENDING:      "s-pending",
    ANALYZING:    "s-analyzing",
    CORRECTABLE:  "s-correctable",
    NEEDS_REVIEW: "s-review",
    CRITICAL:     "s-critical",
    APPROVED:     "s-approved",
    REJECTED:     "s-rejected",
    APPLIED:      "s-applied",
    OK:           "s-ok",
  };
  return map[status] ?? "s-pending";
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING:      "Pendiente",
    ANALYZING:    "Analizando",
    CORRECTABLE:  "Corregible",
    NEEDS_REVIEW: "Req. revisión",
    CRITICAL:     "Crítico",
    APPROVED:     "Aprobado",
    REJECTED:     "Rechazado",
    APPLIED:      "Aplicado",
    OK:           "Correcto",
  };
  return labels[status] ?? status;
}

/**
 * Semantic text colors that flip between bright (dark mode)
 * and dark (light mode) for WCAG AA compliance.
 */
export function getConfidenceColor(level: string): string {
  const colors: Record<string, string> = {
    ALTA:    "text-c-success font-semibold",
    MEDIA:   "text-c-warning font-semibold",
    BAJA:    "text-c-orange  font-semibold",
    CRITICA: "text-c-danger  font-semibold",
    UNKNOWN: "text-dark-500",
  };
  return colors[level] ?? "text-dark-500";
}

export function getConfidenceLabel(level: string): string {
  const labels: Record<string, string> = {
    ALTA:    "Alta",
    MEDIA:   "Media",
    BAJA:    "Baja",
    CRITICA: "Crítica",
    UNKNOWN: "—",
  };
  return labels[level] ?? level;
}

export function getErrorLabel(errorType: string | null | undefined): string {
  if (!errorType) return "—";
  const labels: Record<string, string> = {
    CP_INCORRECTO:             "CP incorrecto",
    COLONIA_MAL_ESCRITA:       "Colonia mal escrita",
    SIN_COLONIA:               "Sin colonia",
    SIN_COLONIA_CP_INCORRECTO: "Sin colonia + CP",
    DIRECCION_INVALIDA:        "Dirección inválida",
    DIRECCION_LARGA:           "Dirección larga",
    NOMBRE_LARGO:              "Nombre largo",
    MULTIPLE_ERRORES:          "Múltiples errores",
    OK:                        "Sin errores",
  };
  return labels[errorType] ?? errorType;
}

export function getErrorColor(errorType: string | null | undefined): string {
  if (!errorType) return "text-dark-500";
  const colors: Record<string, string> = {
    CP_INCORRECTO:             "text-c-warning",
    COLONIA_MAL_ESCRITA:       "text-c-orange",
    SIN_COLONIA:               "text-c-orange",
    SIN_COLONIA_CP_INCORRECTO: "text-c-danger",
    DIRECCION_INVALIDA:        "text-c-danger",
    DIRECCION_LARGA:           "text-c-warning",
    NOMBRE_LARGO:              "text-c-warning",
    MULTIPLE_ERRORES:          "text-c-danger",
    OK:                        "text-c-success",
  };
  return colors[errorType] ?? "text-dark-500";
}
