import { prisma } from "@/lib/prisma";
import { normalizeText } from "@/lib/utils";
import { resolveStateName } from "@/lib/mexicoStates";
import Fuse from "fuse.js";
import type { ColoniaRecord, ConfidenceLevel } from "@/types";

interface ColoniaMatch {
  colonia: string;
  cp: string;
  municipio: string;
  estado: string;
  score: number;
  confidence: ConfidenceLevel;
  matchPct: number;
}

export interface CpInfo {
  valid: boolean;       // CP existe y pertenece al estado correcto
  colonias: ColoniaRecord[];  // Todas las colonias de ese CP (del estado correcto)
  municipioMatch: boolean;    // Hay colonias que también coinciden con el municipio
}

// ─────────────────────────────────────────────────────────
// Normalización de abreviaciones de colonias
// ─────────────────────────────────────────────────────────

/**
 * Tabla de expansión de abreviaciones comunes en colonias mexicanas.
 * Permite que el fuzzy matching encuentre "fraccionamiento Real De Valdepeñas"
 * cuando el usuario escribe "fracc Real De Valdepeñas" o "Fracc. Real".
 */
const COLONIA_EXPAND: Array<[RegExp, string]> = [
  [/\bfracc?(?:ionamiento)?\.?\s*/gi, "fraccionamiento "],
  [/\bpriv\.?\s*/gi, "privada "],
  [/\bcto\.?\s*/gi, "coto "],
  [/\bres(?:id)?\.?\s*/gi, "residencial "],
  [/\bunid\.?\s*/gi, "unidad "],
  [/\bconj\.?\s*/gi, "conjunto "],
  [/\bbo\.?\s*/gi, "barrio "],
  // Ordinales numéricos → texto
  [/\b1er?\b/gi, "primero"],
  [/\b1ro?\b/gi, "primero"],
  [/\b2do?\b/gi, "segundo"],
  [/\b3er?\b/gi, "tercero"],
  [/\b3ro?\b/gi, "tercero"],
  [/\b4to?\b/gi, "cuarto"],
  [/\b5to?\b/gi, "quinto"],
  [/\b6to?\b/gi, "sexto"],
];

/**
 * Genera múltiples variantes de búsqueda para una colonia,
 * expandiendo abreviaciones y probando substrings más cortos.
 * Esto aumenta enormemente la tasa de matches en SEPOMEX.
 *
 * Ejemplo: "Real De Valdepeñas fracc Miralto"
 * → ["Real De Valdepeñas fracc Miralto",
 *    "Real De Valdepeñas fraccionamiento Miralto",
 *    "Real De Valdepeñas",    // primeras 3 palabras
 *    "Real De"]               // primeras 2 palabras
 *
 * NOTA: Las palabras sueltas cortas (< 6 chars) NO se usan como variante
 * para evitar false positives ("Miralto" → "Mirador Escondido").
 */
export function normalizeColoniaInput(colonia: string): string[] {
  const base     = colonia.trim().replace(/\s+/g, " ");
  const variants = new Set<string>([base]);

  // Variante con abreviaciones expandidas
  let expanded = base;
  for (const [pattern, replacement] of COLONIA_EXPAND) {
    expanded = expanded.replace(pattern, replacement);
  }
  expanded = expanded.replace(/\s+/g, " ").trim();
  if (expanded !== base) variants.add(expanded);

  // Variantes de substrings (útil cuando el usuario agrega info extra)
  const words = base.split(/\s+/);

  if (words.length > 3) {
    variants.add(words.slice(0, 3).join(" "));
    variants.add(words.slice(0, 2).join(" "));
  }
  if (words.length > 2) {
    // Palabras del medio (quitar primera y última)
    if (words.length >= 4) {
      variants.add(words.slice(1, -1).join(" "));
    }
    // Última palabra SOLO si tiene >= 6 caracteres (evita falsos positivos)
    // "Miralto" (7 chars) quedaría fuera bajo el umbral estricto,
    // pero "Valdepeñas" (10 chars) sí se agrega.
    const lastWord = words[words.length - 1];
    if (lastWord.length >= 6) {
      variants.add(lastWord);
    }
  }

  return [...variants].filter((v) => v.length >= 3);
}

// ─────────────────────────────────────────────────────────
// Helpers internos de filtrado
// ─────────────────────────────────────────────────────────

function filterByEstado(colonias: ColoniaRecord[], estado: string): ColoniaRecord[] {
  const eNorm = normalizeText(resolveStateName(estado));
  return colonias.filter((c) => {
    const cNorm = normalizeText(c.estado);
    return cNorm.includes(eNorm.slice(0, 7)) || eNorm.includes(cNorm.slice(0, 7));
  });
}

function filterByMunicipio(colonias: ColoniaRecord[], municipio: string): ColoniaRecord[] {
  if (!municipio || municipio.length < 3) return colonias;
  const mNorm = normalizeText(municipio);
  const prefix = mNorm.slice(0, 6);
  return colonias.filter((c) => {
    const cNorm = normalizeText(c.municipio);
    return cNorm.includes(prefix) || prefix.includes(cNorm.slice(0, 5));
  });
}

function estadoSqlPrefix(estado: string): string {
  const resolved = resolveStateName(estado);
  const norm = normalizeText(resolved);
  return norm.slice(0, 4);
}

// ─────────────────────────────────────────────────────────
// API principal del servicio
// ─────────────────────────────────────────────────────────

/** Obtiene todas las colonias de un CP exacto */
export async function getColoniasByCp(cp: string): Promise<ColoniaRecord[]> {
  return prisma.colonia.findMany({ where: { cp: cp.trim() }, take: 100 }) as unknown as ColoniaRecord[];
}

/**
 * Valida el CP contra estado+ciudad y devuelve sus colonias.
 * PASO 1 obligatorio de validación: el CP debe coincidir con estado+municipio.
 */
export async function getCpInfo(cp: string, city: string, estado: string): Promise<CpInfo> {
  const cleanCp = cp.trim().replace(/\D/g, "").padStart(5, "0");
  if (!cleanCp || cleanCp === "00000") {
    return { valid: false, colonias: [], municipioMatch: false };
  }

  const all = await getColoniasByCp(cleanCp);
  if (all.length === 0) {
    return { valid: false, colonias: [], municipioMatch: false };
  }

  // Filtrar por estado — REGLA: el CP debe pertenecer al estado correcto
  const byEstado = filterByEstado(all, estado);
  if (byEstado.length === 0) {
    // El CP existe pero NO pertenece a este estado → inválido para esta dirección
    return { valid: false, colonias: [], municipioMatch: false };
  }

  // Verificar si también coincide con el municipio
  const byMun = filterByMunicipio(byEstado, city);

  return {
    valid: true,
    colonias: byEstado,
    municipioMatch: byMun.length > 0,
  };
}

/**
 * Fuzzy match de una colonia contra una lista específica de candidatos.
 * Usa múltiples variantes de normalización para maximizar el recall.
 * Threshold más amplio (0.6) ya que la lista es pequeña y específica.
 */
export function matchColoniaInList(
  colonia: string,
  candidates: ColoniaRecord[]
): ColoniaMatch | null {
  if (!colonia || candidates.length === 0) return null;

  const variants = normalizeColoniaInput(colonia);

  // Primero: búsqueda exacta por coloniaNorm
  for (const variant of variants) {
    const norm = normalizeText(variant);
    const exact = candidates.find(
      (c) =>
        c.coloniaNorm === norm ||
        c.coloniaNorm.includes(norm) ||
        norm.includes(c.coloniaNorm)
    );
    if (exact) {
      return {
        colonia: exact.colonia,
        cp: exact.cp,
        municipio: exact.municipio,
        estado: exact.estado,
        score: 0,
        matchPct: 100,
        confidence: "ALTA",
      };
    }
  }

  // Segundo: fuzzy matching con threshold amplio (lista pequeña = menos falsos positivos)
  let bestMatch: ColoniaMatch | null = null;

  for (const variant of variants) {
    const fuse = new Fuse(candidates, {
      keys: ["colonia", "coloniaNorm"],
      threshold: 0.6,
      distance: 150,
      includeScore: true,
      minMatchCharLength: 2,
    });

    const results = fuse.search(variant);
    if (results.length === 0) continue;

    const top = results[0];
    const score = top.score ?? 1;
    if (score < 0.6) {
      const matchPct = Math.round((1 - score) * 100);
      let confidence: ConfidenceLevel;
      if (score < 0.15) confidence = "ALTA";
      else if (score < 0.35) confidence = "MEDIA";
      else if (score < 0.55) confidence = "BAJA";
      else confidence = "CRITICA";

      const match: ColoniaMatch = {
        colonia: top.item.colonia,
        cp: top.item.cp,
        municipio: top.item.municipio,
        estado: top.item.estado,
        score,
        matchPct,
        confidence,
      };

      if (!bestMatch || score < bestMatch.score) {
        bestMatch = match;
      }
    }
  }

  return bestMatch;
}

// ─────────────────────────────────────────────────────────
// Búsquedas amplias (estado + municipio)
// ─────────────────────────────────────────────────────────

export async function findColoniaExacta(
  colonia: string,
  municipio: string,
  estado: string
): Promise<ColoniaRecord | null> {
  const variants = normalizeColoniaInput(colonia);
  const mNorm    = normalizeText(municipio);

  /**
   * Helper interno — prueba una lista de candidatos filtrada por estado/municipio.
   * Retorna el primer match válido o null.
   */
  function pickBest(candidates: ColoniaRecord[]): ColoniaRecord | null {
    const byEstado = filterByEstado(candidates, estado);
    if (byEstado.length === 0) return null;

    if (mNorm.length >= 3) {
      const byMun = byEstado.filter((r) =>
        normalizeText(r.municipio).includes(mNorm.slice(0, 6))
      );
      if (byMun.length > 0) return byMun[0];
    }
    return byEstado[0];
  }

  // ── RONDA 1: coincidencia exacta por coloniaNorm ────────────────────────
  for (const variant of variants) {
    const norm = normalizeText(variant);
    if (norm.length < 2) continue;

    const results = await prisma.colonia.findMany({
      where: { coloniaNorm: norm },
      take:  100,
    });
    if (results.length === 0) continue;

    const best = pickBest(results as unknown as ColoniaRecord[]);
    if (best) return best;
  }

  // ── RONDA 2: búsqueda contains ─────────────────────────────────────────
  // Permite que "real de valdepeñas" encuentre "fracc real de valdepeñas"
  // (caso donde el cliente escribe la colonia sin el prefijo "Fracc.")
  for (const variant of variants) {
    const norm = normalizeText(variant);
    if (norm.length < 4) continue; // evitar false positives con términos cortos

    const results = await prisma.colonia.findMany({
      where: { coloniaNorm: { contains: norm } },
      take:  100,
    });
    if (results.length === 0) continue;

    const best = pickBest(results as unknown as ColoniaRecord[]);
    if (best) return best;
  }

  // ── RONDA 3: el nombre de SEPOMEX contiene el término del usuario ───────
  // "fracc real de valdepeñas" contiene "real de valdepeñas"
  const baseNorm = normalizeText(colonia);
  if (baseNorm.length >= 5) {
    const results = await prisma.colonia.findMany({
      where: { coloniaNorm: { contains: baseNorm.slice(0, Math.min(baseNorm.length, 20)) } },
      take:  100,
    });
    if (results.length > 0) {
      const best = pickBest(results as unknown as ColoniaRecord[]);
      if (best) return best;
    }
  }

  return null;
}

export async function findColoniaFuzzy(
  colonia: string,
  municipio: string,
  estado: string
): Promise<ColoniaMatch[]> {
  const prefix = estadoSqlPrefix(estado);

  const colonias = await prisma.colonia.findMany({
    where: { estado: { contains: prefix } },
    take: 5000,
  });

  if (colonias.length === 0) return [];

  const all = colonias as unknown as ColoniaRecord[];
  const byEstado = filterByEstado(all, estado);
  if (byEstado.length === 0) return [];

  const byMun = filterByMunicipio(byEstado, municipio);
  const candidates = byMun.length >= 5 ? byMun : byEstado;

  // Usar múltiples variantes para maximizar recall
  const variants = normalizeColoniaInput(colonia);
  return runFuseMultiVariant(variants, candidates);
}

export async function findColoniaFuzzyByEstado(
  colonia: string,
  estado: string
): Promise<ColoniaMatch[]> {
  const prefix = estadoSqlPrefix(estado);

  const colonias = await prisma.colonia.findMany({
    where: { estado: { contains: prefix } },
    take: 5000,
  });

  if (colonias.length === 0) return [];

  const all = colonias as unknown as ColoniaRecord[];
  const byEstado = filterByEstado(all, estado);
  const candidates = byEstado.length > 0 ? byEstado : all;

  const variants = normalizeColoniaInput(colonia);
  return runFuseMultiVariant(variants, candidates);
}

function runFuseMultiVariant(variants: string[], records: ColoniaRecord[]): ColoniaMatch[] {
  if (records.length === 0 || variants.length === 0) return [];

  // Buscar con todas las variantes y tomar los mejores resultados únicos
  const seen = new Set<string>();
  const allMatches: ColoniaMatch[] = [];

  for (const query of variants) {
    const results = runFuse(query, records);
    for (const r of results) {
      const key = `${r.cp}|${r.colonia}`;
      if (!seen.has(key)) {
        seen.add(key);
        allMatches.push(r);
      }
    }
  }

  // Ordenar por score (menor = mejor)
  return allMatches.sort((a, b) => a.score - b.score).slice(0, 5);
}

function runFuse(query: string, records: ColoniaRecord[]): ColoniaMatch[] {
  if (records.length === 0) return [];

  const fuse = new Fuse(records, {
    keys: ["colonia", "coloniaNorm"],
    threshold: 0.45,
    distance: 100,
    includeScore: true,
    minMatchCharLength: 3,
  });

  const results = fuse.search(query);

  return results.slice(0, 5).map((r) => {
    const score = r.score ?? 1;
    const matchPct = Math.round((1 - score) * 100);
    let confidence: ConfidenceLevel;
    if (score < 0.1) confidence = "ALTA";
    else if (score < 0.25) confidence = "MEDIA";
    else if (score < 0.4) confidence = "BAJA";
    else confidence = "CRITICA";

    return {
      colonia: r.item.colonia,
      cp: r.item.cp,
      municipio: r.item.municipio,
      estado: r.item.estado,
      score,
      matchPct,
      confidence,
    };
  });
}

export async function cpExists(cp: string): Promise<boolean> {
  const count = await prisma.colonia.count({ where: { cp: cp.trim() } });
  return count > 0;
}

export async function extractColoniaFromText(
  text: string,
  municipio: string,
  estado: string
): Promise<{ colonia: string; cp: string; confidence: ConfidenceLevel; matchPct: number } | null> {
  const matches = await findColoniaFuzzy(text, municipio, estado);
  if (matches.length === 0) return null;

  const best = matches[0];
  if (best.confidence === "CRITICA") return null;

  return { colonia: best.colonia, cp: best.cp, confidence: best.confidence, matchPct: best.matchPct };
}

export async function getColoniasCount(): Promise<number> {
  return prisma.colonia.count();
}
