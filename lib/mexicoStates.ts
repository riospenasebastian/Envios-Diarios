/**
 * Mapa de abreviaciones de estados mexicanos → nombre completo.
 * Soporta códigos ISO, códigos de Shopify (province_code) y variantes comunes.
 *
 * Shopify devuelve province = "Guanajuato" (nombre completo) y
 * province_code = "GTO" (sigla).  Esta tabla permite resolver
 * cualquiera de los dos formatos al nombre canónico de SEPOMEX.
 */
export const MEXICO_STATES: Record<string, string> = {
  // Aguascalientes
  AGS: "Aguascalientes",
  AGU: "Aguascalientes",
  // Baja California
  BC: "Baja California",
  BCN: "Baja California",
  // Baja California Sur
  BCS: "Baja California Sur",
  // Campeche
  CAM: "Campeche",
  CMP: "Campeche",
  // Chiapas
  CHP: "Chiapas",
  CHIS: "Chiapas",
  // Chihuahua
  CHH: "Chihuahua",
  CHI: "Chihuahua",
  CHIH: "Chihuahua",
  // Ciudad de México
  CDMX: "Ciudad de México",
  CMX: "Ciudad de México",
  DF: "Ciudad de México",
  DIF: "Ciudad de México",
  // Coahuila
  COA: "Coahuila",
  COAH: "Coahuila",
  // Colima
  COL: "Colima",
  // Durango
  DGO: "Durango",
  DUR: "Durango",
  // Guanajuato
  GTO: "Guanajuato",
  GUA: "Guanajuato",
  GUAN: "Guanajuato",
  // Guerrero
  GRO: "Guerrero",
  GUE: "Guerrero",
  // Hidalgo
  HGO: "Hidalgo",
  HID: "Hidalgo",
  // Jalisco
  JAL: "Jalisco",
  // Estado de México
  MEX: "Estado de México",
  EMX: "Estado de México",
  EDOMEX: "Estado de México",
  MXS: "Estado de México",
  // Michoacán
  MIC: "Michoacán",
  MCH: "Michoacán",
  MICH: "Michoacán",
  // Morelos
  MOR: "Morelos",
  // Nayarit
  NAY: "Nayarit",
  // Nuevo León
  NL: "Nuevo León",
  NLE: "Nuevo León",
  // Oaxaca
  OAX: "Oaxaca",
  // Puebla
  PUE: "Puebla",
  // Querétaro
  QRO: "Querétaro",
  QUE: "Querétaro",
  // Quintana Roo
  QR: "Quintana Roo",
  ROO: "Quintana Roo",
  QUI: "Quintana Roo",
  // San Luis Potosí
  SLP: "San Luis Potosí",
  // Sinaloa
  SIN: "Sinaloa",
  // Sonora
  SON: "Sonora",
  // Tabasco
  TAB: "Tabasco",
  // Tamaulipas
  TAM: "Tamaulipas",
  TAMS: "Tamaulipas",
  // Tlaxcala
  TLA: "Tlaxcala",
  TLX: "Tlaxcala",
  TLAX: "Tlaxcala",
  // Veracruz
  VER: "Veracruz",
  // Yucatán
  YUC: "Yucatán",
  // Zacatecas
  ZAC: "Zacatecas",
};

/**
 * Nombres canónicos de SEPOMEX para búsqueda normalizada.
 * Usado para mapear "Ciudad de México" → "Ciudad de Mexico" (sin tilde).
 */
export const ESTADO_NORM_MAP: Record<string, string> = {
  "ciudad de mexico": "Ciudad de México",
  "cdmx": "Ciudad de México",
  "estado de mexico": "Estado de México",
  "michoacan": "Michoacán",
  "nuevo leon": "Nuevo León",
  "queretaro": "Querétaro",
  "san luis potosi": "San Luis Potosí",
  "yucatan": "Yucatán",
};

/**
 * Resuelve el nombre completo del estado a partir de:
 * - Sigla (GTO → "Guanajuato")
 * - Nombre completo ya correcto ("Guanajuato" → "Guanajuato")
 * - Nombre sin tilde ("Queretaro" → "Querétaro")
 */
export function resolveStateName(state: string): string {
  if (!state || state.trim().length === 0) return state;
  const trimmed = state.trim();
  // Probar sigla exacta (mayúsculas)
  const upper = trimmed.toUpperCase();
  if (MEXICO_STATES[upper]) return MEXICO_STATES[upper];
  // Probar nombre normalizado (sin tilde, minúsculas)
  const lower = trimmed.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (ESTADO_NORM_MAP[lower]) return ESTADO_NORM_MAP[lower];
  // Devolver tal como vino (probablemente ya es el nombre correcto)
  return trimmed;
}
