/**
 * Fuente secundaria de validación: micodigopostal.org
 * Se usa ÚNICAMENTE cuando la base SEPOMEX no encuentra coincidencia.
 *
 * Prioridad:
 * 1. Base local SEPOMEX  ← principal
 * 2. micodigopostal.org  ← este servicio
 * 3. Revisión manual
 *
 * Implementación: scraping simple via fetch + regex.
 * Incluye caché local en SQLite para no repetir peticiones.
 */

import { prisma } from "@/lib/prisma";
import { normalizeText } from "@/lib/utils";
import { log } from "./loggerService";

const TIMEOUT_MS = 8000;
const BASE_URL = "https://micodigopostal.org";

interface MiCpResult {
  cp: string;
  colonia: string;
  municipio: string;
  estado: string;
  source: "micodigopostal";
}

// Caché en settings para evitar repetir peticiones
async function getCacheKey(key: string): Promise<string | null> {
  const cached = await prisma.setting.findUnique({ where: { key: `mcp_cache_${key}` } });
  return cached?.value ?? null;
}

async function setCacheKey(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({
    where: { key: `mcp_cache_${key}` },
    create: { key: `mcp_cache_${key}`, value },
    update: { value },
  });
}

/** Consulta colonias por CP en micodigopostal.org */
export async function lookupByCp(cp: string): Promise<MiCpResult[]> {
  const cacheKey = `cp_${cp}`;
  const cached = await getCacheKey(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as MiCpResult[];
    } catch {
      /* cache corrupto, ignorar */
    }
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${BASE_URL}/codigo-postal/${cp}/`, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; EnviosSaaS/1.0; validacion-logistica)",
        Accept: "text/html",
      },
    });
    clearTimeout(timer);

    if (!res.ok) return [];

    const html = await res.text();
    const results = parseMiCpHtml(html, cp);

    // Guardar en caché
    if (results.length > 0) {
      await setCacheKey(cacheKey, JSON.stringify(results));
    }

    return results;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      await log("[SEPOMEX] MCP_TIMEOUT", `Timeout consultando micodigopostal.org para CP ${cp}`, {
        level: "WARN",
      });
    }
    return [];
  }
}

/** Busca colonias por nombre en micodigopostal.org */
export async function searchByColonia(
  colonia: string,
  estado: string
): Promise<MiCpResult[]> {
  const norm = normalizeText(colonia);
  const cacheKey = `col_${norm}_${normalizeText(estado).slice(0, 6)}`;
  const cached = await getCacheKey(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as MiCpResult[];
    } catch { /* ignore */ }
  }

  try {
    const query = encodeURIComponent(`${colonia} ${estado}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(`${BASE_URL}/?q=${query}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; EnviosSaaS/1.0)",
        Accept: "text/html",
      },
    });
    clearTimeout(timer);

    if (!res.ok) return [];

    const html = await res.text();
    const results = parseMiCpSearch(html);

    if (results.length > 0) {
      await setCacheKey(cacheKey, JSON.stringify(results.slice(0, 10)));
    }

    return results;
  } catch {
    return [];
  }
}

/** Parsea la página de detalle de un CP */
function parseMiCpHtml(html: string, cp: string): MiCpResult[] {
  const results: MiCpResult[] = [];

  // Extrae colonias de tablas o listas en la página
  // Patrón típico: <td>Nombre Colonia</td> o similar
  const coloniaPatterns = [
    /<td[^>]*>([^<]{4,60})<\/td>\s*<td[^>]*>([^<]{3,40})<\/td>\s*<td[^>]*>([^<]{3,40})<\/td>/gi,
    /class="colonia[^"]*"[^>]*>([^<]+)</gi,
    /<strong>([^<]{4,60})<\/strong>/gi,
  ];

  // Extraer estado y municipio del título/encabezado
  const estadoMatch = html.match(/estado[^:]*:\s*<[^>]+>([^<]+)</i);
  const munMatch = html.match(/municipio[^:]*:\s*<[^>]+>([^<]+)</i);
  const estado = estadoMatch ? estadoMatch[1].trim() : "";
  const municipio = munMatch ? munMatch[1].trim() : "";

  // Extraer lista de colonias (patrón más común en micodigopostal.org)
  const listPattern = /<li[^>]*>\s*(?:<a[^>]*>)?([^<\n]{4,60})(?:<\/a>)?\s*<\/li>/gi;
  let match;
  while ((match = listPattern.exec(html)) !== null) {
    const colonia = match[1].trim();
    if (colonia.length > 3 && !colonia.toLowerCase().includes("http")) {
      results.push({
        cp,
        colonia,
        municipio: municipio || colonia,
        estado: estado || "",
        source: "micodigopostal",
      });
    }
  }

  return results.slice(0, 20);
}

/** Parsea la página de búsqueda */
function parseMiCpSearch(html: string): MiCpResult[] {
  const results: MiCpResult[] = [];

  // Buscar resultados con CP, colonia, municipio, estado
  const rowPattern =
    /(\d{5})[^\d]*([A-Za-záéíóúüñÁÉÍÓÚÜÑ][^<\n]{3,50})[^<\n]*([A-Za-záéíóúüñÁÉÍÓÚÜÑ][^<\n]{3,30})[^<\n]*([A-Za-záéíóúüñÁÉÍÓÚÜÑ][^<\n]{3,30})/g;

  let match;
  while ((match = rowPattern.exec(html)) !== null) {
    results.push({
      cp: match[1],
      colonia: match[2].trim(),
      municipio: match[3].trim(),
      estado: match[4].trim(),
      source: "micodigopostal",
    });
  }

  return results.slice(0, 10);
}

/** Punto de entrada principal para validación secundaria */
export async function validateWithMiCp(
  colonia: string,
  cp: string,
  municipio: string,
  estado: string
): Promise<{
  found: boolean;
  suggestedCp?: string;
  suggestedColonia?: string;
  confidence: "MEDIA" | "BAJA";
} | null> {
  try {
    // Estrategia 1: buscar por CP existente y ver si la colonia encaja
    if (cp && cp !== "00000") {
      const byCP = await lookupByCp(cp);
      if (byCP.length > 0) {
        const normCol = normalizeText(colonia);
        const match = byCP.find(
          (r) =>
            normalizeText(r.colonia).includes(normCol) ||
            normCol.includes(normalizeText(r.colonia))
        );
        if (match) {
          return {
            found: true,
            suggestedCp: match.cp,
            suggestedColonia: match.colonia,
            confidence: "MEDIA",
          };
        }
      }
    }

    // Estrategia 2: buscar por nombre de colonia
    const byName = await searchByColonia(colonia, estado);
    if (byName.length > 0) {
      const normEstado = normalizeText(estado);
      const match = byName.find(
        (r) =>
          r.estado &&
          normalizeText(r.estado).includes(normEstado.slice(0, 5))
      );
      if (match) {
        return {
          found: true,
          suggestedCp: match.cp,
          suggestedColonia: match.colonia,
          confidence: "BAJA",
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}
