/**
 * shopifyNoteService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Extrae Estado / Municipio / Colonia / CP del formulario obligatorio del
 * carrito de Shopify.
 *
 * Los datos llegan en `note_attributes` (sección "Información adicional" del
 * admin de Shopify), con este formato real:
 *
 *   _loggedInId          → 9553176035604      (privado, se ignora)
 *   Direccion validada   → SI
 *   Estado validado      → Puebla
 *   Municipio validado   → Puebla
 *   Colonia validada     → Ex-Hacienda Mayorazgo
 *   CP validado          → 72480
 *
 * También se acepta el mismo contenido escrito como texto libre en `note`
 * (formato "Clave: Valor" por línea), por si el formulario cambia de destino.
 *
 * REGLA DE SEGURIDAD: esta función NUNCA lanza y NUNCA adivina. O devuelve los
 * cuatro campos completos y bien formados, o devuelve `absent` con el motivo.
 * Quien la consume debe caer a la lógica actual cuando el resultado es `absent`.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { ShopifyOrder, ShopifyNoteAttribute } from "@/types";

export interface CartFormData {
  estado: string;
  municipio: string;
  colonia: string;
  /** Siempre 5 dígitos. */
  cp: string;
}

export type CartFormExtraction =
  | { status: "found"; data: CartFormData }
  | { status: "absent"; reason: string };

/**
 * Normaliza el nombre de una clave para poder compararla:
 * sin acentos, minúsculas, sin puntuación y SIN el sufijo "validado/validada".
 *
 *   "Estado validado"    → "estado"
 *   "CP validado"        → "cp"
 *   "Colonia validada"   → "colonia"
 *   "Código Postal"      → "codigo postal"
 *   "_loggedInId"        → "loggedinid"
 */
function normalizeKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(validad[oa]|validacion|confirmad[oa]|seleccionad[oa])\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Alias aceptados por campo. Se comparan contra la clave ya normalizada.
const KEY_ALIASES: Record<keyof CartFormData | "gate", string[]> = {
  estado: ["estado", "state", "entidad"],
  municipio: ["municipio", "ciudad", "delegacion", "alcaldia", "municipio ciudad"],
  colonia: ["colonia", "asentamiento", "col"],
  cp: ["cp", "codigo postal", "codigopostal", "zip", "c p"],
  // Bandera que pone el formulario del carrito al completarse.
  gate: ["direccion", "direccion completa", "formulario"],
};

function matchField(normKey: string): keyof CartFormData | "gate" | null {
  for (const [field, aliases] of Object.entries(KEY_ALIASES)) {
    if (aliases.includes(normKey)) return field as keyof CartFormData | "gate";
  }
  return null;
}

/** Convierte `note_attributes` en un mapa campo → valor. */
function readFromAttributes(attrs: ShopifyNoteAttribute[]): Map<string, string> {
  const out = new Map<string, string>();

  for (const attr of attrs) {
    if (!attr || typeof attr.name !== "string") continue;

    // Los atributos que empiezan con "_" son privados de la tienda (ej. _loggedInId).
    if (attr.name.trim().startsWith("_")) continue;

    const field = matchField(normalizeKey(attr.name));
    if (!field) continue;

    const value = String(attr.value ?? "").trim();
    if (!value) continue;

    // El primero gana: si el formulario repite una clave, no la sobreescribimos.
    if (!out.has(field)) out.set(field, value);
  }

  return out;
}

/** Parsea una nota de texto libre con líneas "Clave: Valor". */
function readFromFreeText(note: string): Map<string, string> {
  const out = new Map<string, string>();

  for (const rawLine of note.split(/\r?\n/)) {
    const sep = rawLine.indexOf(":");
    if (sep <= 0) continue;

    const field = matchField(normalizeKey(rawLine.slice(0, sep)));
    if (!field) continue;

    const value = rawLine.slice(sep + 1).trim();
    if (!value) continue;

    if (!out.has(field)) out.set(field, value);
  }

  return out;
}

/** Deja el CP en 5 dígitos exactos, o null si no es un CP mexicano válido. */
function cleanCp(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  return digits.length === 5 ? digits : null;
}

/** ¿La bandera "Direccion validada" dice que sí? */
function isAffirmative(value: string): boolean {
  const v = normalizeKey(value);
  return ["si", "s", "yes", "y", "true", "1", "ok", "completo"].includes(v);
}

/**
 * Extrae los datos del formulario del carrito de un pedido de Shopify.
 * Prioriza `note_attributes`; completa con `note` si falta algún campo.
 */
export function extractCartFormData(order: ShopifyOrder): CartFormExtraction {
  const attrs = Array.isArray(order.note_attributes) ? order.note_attributes : [];
  const values = readFromAttributes(attrs);

  // Completar (nunca sobreescribir) con la nota de texto libre.
  if (typeof order.note === "string" && order.note.trim()) {
    for (const [field, value] of readFromFreeText(order.note)) {
      if (!values.has(field)) values.set(field, value);
    }
  }

  if (values.size === 0) {
    return { status: "absent", reason: "el pedido no trae datos del formulario del carrito" };
  }

  // Si el formulario dejó la bandera y NO dice que sí, no confiamos en la nota.
  const gate = values.get("gate");
  if (gate !== undefined && !isAffirmative(gate)) {
    return { status: "absent", reason: `la nota marca "Direccion validada = ${gate}"` };
  }

  const estado = values.get("estado") ?? "";
  const municipio = values.get("municipio") ?? "";
  const colonia = values.get("colonia") ?? "";
  const cpRaw = values.get("cp") ?? "";

  const faltantes: string[] = [];
  if (!estado) faltantes.push("estado");
  if (!municipio) faltantes.push("municipio");
  if (!colonia) faltantes.push("colonia");
  if (!cpRaw) faltantes.push("cp");

  if (faltantes.length > 0) {
    return { status: "absent", reason: `la nota está incompleta (falta: ${faltantes.join(", ")})` };
  }

  const cp = cleanCp(cpRaw);
  if (!cp) {
    return { status: "absent", reason: `el CP de la nota no tiene 5 dígitos: "${cpRaw}"` };
  }

  return { status: "found", data: { estado, municipio, colonia, cp } };
}
