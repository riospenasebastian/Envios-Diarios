/**
 * validationService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * NUEVA LÓGICA DE PRIORIDAD (obligatoria):
 *
 * PASO 1  Validar si el CP original existe y pertenece al estado+ciudad.
 * PASO 2  Si el CP es válido → buscar colonia DENTRO de las colonias de ese CP.
 * PASO 3  Solo si no hay coincidencia en ese CP → fuzzy matching en estado/municipio.
 * PASO 4  Solo como último recurso → sugerir otro CP.
 *
 * REGLA: NUNCA cambiar un CP que ya es válido para el estado+ciudad
 *        si existen colonias similares dentro de ese mismo CP.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { normalizeText } from "@/lib/utils";
import { resolveStateName } from "@/lib/mexicoStates";
import { getSetting } from "./settingsService";
import {
  getCpInfo,
  matchColoniaInList,
  findColoniaExacta,
  findColoniaFuzzy,
  getColoniasCount,
  normalizeColoniaInput,
} from "./sepomexService";
import { validateWithMiCp } from "./micodigopostalService";
import type { ValidationResult, ShopifyAddress, ColoniaRecord } from "@/types";

// ─────────────────────────────────────────────────────────
// Patrones de dirección inválida
// ─────────────────────────────────────────────────────────
const INVALID_ADDRESS_PATTERNS = [
  /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i,
  /^\d{1,3}$/,
  /^(n\/a|na|ninguna|sin dirección|no tiene|no aplica)$/i,
  /^.{0,5}$/,
];

// ─────────────────────────────────────────────────────────
// Patrones de colonia explícita
// ─────────────────────────────────────────────────────────
const COLONIA_PATTERNS = [
  /\bcol(?:onia)?\.?\s+([^,\n]{3,60})/i,
  /\bfracc(?:ionamiento)?\.?\s+([^,\n]{3,60})/i,
  /\bbarrio\s+([^,\n]{3,50})/i,
  /\bunidad\s+hab(?:itacional)?\.?\s+([^,\n]{3,50})/i,
  /\bresidencial\s+([^,\n]{3,50})/i,
  /\bpoblado\s+([^,\n]{3,50})/i,
  /\bprivada\s+([^,\n]{3,50})/i,
  /\bcoto\s+([^,\n]{3,50})/i,
];

// ─────────────────────────────────────────────────────────
// Abreviaciones para dirección física (al dividir dirección larga)
// ─────────────────────────────────────────────────────────
const ADDRESS_ABBREV: Array<[RegExp, string]> = [
  [/\bdepartamento\b/gi, "Dep"],
  [/\bdepto\b/gi, "Dep"],
  [/\bapartamento\b/gi, "Apto"],
  [/\bavenida\b/gi, "Av"],
  [/\bboulevard\b/gi, "Blvd"],
  [/\bcalzada\b/gi, "Calz"],
  [/\bcolonia\b/gi, "Col"],
  [/\bfraccionamiento\b/gi, "Fracc"],
  [/\binterior\b/gi, "Int"],
  [/\bnúmero\b/gi, "No"],
  [/\bnumero\b/gi, "No"],
  [/\bedificio\b/gi, "Edif"],
  [/\bprolongación\b/gi, "Prol"],
  [/\bprolongacion\b/gi, "Prol"],
  [/\bcircuito\b/gi, "Cto"],
  [/\bprivada\b/gi, "Priv"],
  [/\bcalle\b(?=\s+[a-záéíóúñ])/gi, ""],  // "Calle " solo al inicio de nombre de calle
];

const REFERENCE_KEYWORDS = [
  "dep ", "apto ", "int ", "piso ", "torre ", "local ",
  "frente a ", "frente al ", "cerca de ", "entre calles ",
  "entre ", "esquina ", "esquina con ", "a un lado ", "bodega ",
];

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function isInvalidAddress(addr: string): boolean {
  return INVALID_ADDRESS_PATTERNS.some((p) => p.test(addr.trim()));
}

function abbreviateAddress(text: string): string {
  let r = text;
  for (const [p, a] of ADDRESS_ABBREV) {
    r = a ? r.replace(p, a) : r.replace(p, "");
  }
  return r.replace(/\s{2,}/g, " ").trim();
}

function splitAddress(addr: string, maxChars: number): { address1: string; reference: string } {
  const abbr = abbreviateAddress(addr);
  if (abbr.length <= maxChars) return { address1: abbr, reference: "" };

  const lower = abbr.toLowerCase();
  for (const kw of REFERENCE_KEYWORDS) {
    const idx = lower.indexOf(kw);
    if (idx > 5) {
      const main = abbr.slice(0, idx).trim().replace(/[,\s]+$/, "");
      if (main.length <= maxChars) return { address1: main, reference: abbr.slice(idx).trim() };
    }
  }

  const sub = abbr.slice(0, maxChars + 1);
  const commaIdx = sub.lastIndexOf(",");
  if (commaIdx > 10) return { address1: abbr.slice(0, commaIdx).trim(), reference: abbr.slice(commaIdx + 1).trim() };

  const subFit = abbr.slice(0, maxChars);
  const lastSpace = subFit.lastIndexOf(" ");
  if (lastSpace > 15) return { address1: abbr.slice(0, lastSpace).trim(), reference: abbr.slice(lastSpace).trim() };

  return { address1: abbr.slice(0, maxChars), reference: abbr.slice(maxChars) };
}

function truncateName(name: string, max: number): string {
  if (name.length <= max) return name;
  const sub = name.slice(0, max);
  const sp = sub.lastIndexOf(" ");
  return sp > 5 ? name.slice(0, sp) : sub;
}

/**
 * Extrae el candidato de colonia de las dos líneas de dirección de Shopify.
 *
 * REGLAS FUNDAMENTALES:
 *  - streetLine es SIEMPRE addr1. Nunca se intercambia con addr2.
 *  - Nunca se asume estructura fija (addr1=calle, addr2=colonia).
 *  - Se analizan ambas líneas para detectar colonia por patrones explícitos.
 *  - Si addr2 existe y no tiene patrón explícito, se usa como colonia (más común en MX).
 *  - Si addr1 tiene patrón explícito de colonia (y no hay addr2), se extrae de ahí.
 *
 * Ejemplo:
 *   addr1 = "Av federalistas 4345 casa 62"
 *   addr2 = "Real De Valdepeñas fracc Miralto"
 *   → streetLine = "Av federalistas 4345 casa 62"  (sin tocar)
 *   → coloniaCandidate = "Real De Valdepeñas fracc Miralto"  (addr2 completa)
 */
function analyzeAddressLines(
  addr1: string,
  addr2: string
): { coloniaCandidate: string | null; streetLine: string } {
  // streetLine SIEMPRE es addr1 — nunca se invierte
  const streetLine = addr1;

  // PASO 1: patrón explícito de colonia en addr2 (tiene prioridad)
  // Usar addr2 COMPLETA como colonia para no perder contexto
  // ("Real De Valdepeñas fracc Miralto" → no truncar a solo "Miralto")
  if (addr2 && addr2.trim().length > 2) {
    for (const p of COLONIA_PATTERNS) {
      if (p.test(addr2)) {
        return { coloniaCandidate: addr2.trim(), streetLine };
      }
    }
  }

  // PASO 2: patrón explícito de colonia en addr1
  // Solo extraer el grupo capturado (la colonia), no toda addr1
  for (const p of COLONIA_PATTERNS) {
    const m = addr1.match(p);
    if (m) {
      return { coloniaCandidate: m[1].trim(), streetLine };
    }
  }

  // PASO 3: addr2 existe sin patrón explícito → usarla como colonia
  // Es el caso más común en pedidos Shopify México
  if (addr2 && addr2.trim().length > 2) {
    return { coloniaCandidate: addr2.trim(), streetLine };
  }

  // PASO 4: sin colonia detectable en ninguna línea
  return { coloniaCandidate: null, streetLine };
}

// ─────────────────────────────────────────────────────────
// Función principal de validación
// ─────────────────────────────────────────────────────────

export async function validateAddress(
  address: ShopifyAddress,
  customerName: string
): Promise<ValidationResult> {
  const maxNombre = parseInt(await getSetting("maxNombreChars")) || 30;
  const maxDir = parseInt(await getSetting("maxDireccionChars")) || 42;

  const addr1 = (address.address1 ?? "").trim();
  const addr2 = (address.address2 ?? "").trim();
  const city = (address.city ?? "").trim();
  const zip = String(address.zip ?? "").trim().replace(/\D/g, "").padStart(5, "0");

  // Resolución de estado: soporta siglas (GTO, JAL…) y nombres completos
  const rawState = (address.province ?? address.province_code ?? "").trim();
  const state = resolveStateName(rawState);

  const nombreLargo = customerName.length > maxNombre;

  // ─────────────────────────────────────────────────────
  // 1. Dirección inválida o vacía
  // ─────────────────────────────────────────────────────
  if (!addr1 || isInvalidAddress(addr1)) {
    return {
      errorType: "DIRECCION_INVALIDA",
      confidence: "CRITICA",
      errorDetails: `Dirección "${addr1}" parece inválida o vacía`,
    };
  }

  // ─────────────────────────────────────────────────────
  // 2. Analizar líneas (sin asumir cuál es calle / colonia)
  // ─────────────────────────────────────────────────────
  const { coloniaCandidate, streetLine } = analyzeAddressLines(addr1, addr2);

  // Construir la dirección "limpia" (calle+número para EnviaTodo)
  const cleanStreet = streetLine || addr1;
  const { address1: splitAddr1, reference: splitRef } = splitAddress(cleanStreet, maxDir);

  // ─────────────────────────────────────────────────────
  // PASO 1: Validar CP original contra estado+ciudad
  // ─────────────────────────────────────────────────────
  const cpData = await getCpInfo(zip, city, state);

  // ═════════════════════════════════════════════════════
  // CASO A: CP válido para este estado+ciudad
  // ═════════════════════════════════════════════════════
  if (cpData.valid) {

    // ── A1: Hay colonia detectada ──────────────────────
    if (coloniaCandidate) {
      // PASO 2: Buscar colonia DENTRO del CP original
      const matchInCp = matchColoniaInList(coloniaCandidate, cpData.colonias);

      if (matchInCp && matchInCp.confidence !== "CRITICA") {
        const coloniaName = matchInCp.colonia;
        const isSameColoniaName =
          normalizeText(coloniaName) === normalizeText(coloniaCandidate);

        // Solo hay problemas de largo de dirección
        if (cleanStreet.length > maxDir || nombreLargo) {
          return buildResult({
            errorType: nombreLargo ? "MULTIPLE_ERRORES" : "DIRECCION_LARGA",
            confidence: "ALTA",
            detectedColonia: coloniaCandidate,
            addr1: splitAddr1,
            addr2: splitRef || (addr2 !== coloniaCandidate ? addr2 : undefined) || undefined,
            city, state,
            zip, // ← CP original, no cambia
            colonia: coloniaName,
            reference: splitRef || undefined,
            notes: `✓ CP ${zip} válido · Colonia en ese CP: "${coloniaName}" (${matchInCp.matchPct}%)`,
          });
        }

        // Dirección correcta o solo corrección menor de nombre de colonia
        if (isSameColoniaName) {
          return {
            errorType: "OK",
            confidence: "ALTA",
            detectedColonia: coloniaCandidate,
            notes: `✓ CP ${zip} correcto · Colonia "${coloniaName}" validada en SEPOMEX`,
            source: "sepomex",
          };
        }

        // Colonia con nombre ligeramente diferente pero mismo CP → corrección menor
        return buildResult({
          errorType: "COLONIA_MAL_ESCRITA",
          confidence: matchInCp.confidence,
          detectedColonia: coloniaCandidate,
          addr1: cleanStreet.length > maxDir ? splitAddr1 : cleanStreet,
          addr2: addr2 !== coloniaCandidate ? addr2 : undefined,
          city, state,
          zip, // ← CP original, no cambia
          colonia: coloniaName,
          reference: splitRef || undefined,
          notes: `✓ CP ${zip} correcto · Nombre colonia: "${coloniaCandidate}" → "${coloniaName}" (${matchInCp.matchPct}% en SEPOMEX)`,
        });
      }

      // PASO 2.5: Antes del fuzzy global → buscar coincidencia EXACTA de nombre en estado+municipio.
      // Si "Morales" existe en SEPOMEX con ese nombre exacto, NO sugerir "El Jaralito" aunque
      // el fuzzy score sea mejor. La coincidencia exacta siempre gana sobre el fuzzy.
      const coloniaExactaGlobal = await findColoniaExacta(coloniaCandidate, city, state);
      if (coloniaExactaGlobal) {
        // Nombre de colonia bien escrito — solo puede estar mal el CP
        return buildResult({
          errorType: coloniaExactaGlobal.cp === zip ? "COLONIA_MAL_ESCRITA" : "CP_INCORRECTO",
          confidence: "ALTA",
          detectedColonia: coloniaCandidate,
          addr1: cleanStreet.length > maxDir ? splitAddr1 : cleanStreet,
          addr2: addr2 !== coloniaCandidate ? addr2 : undefined,
          city, state,
          zip: coloniaExactaGlobal.cp,
          colonia: coloniaExactaGlobal.colonia,
          reference: splitRef || undefined,
          notes: `✓ Colonia "${coloniaCandidate}" en SEPOMEX · CP ${coloniaExactaGlobal.cp} · ${coloniaExactaGlobal.municipio}, ${coloniaExactaGlobal.estado}`,
        });
      }

      // PASO 3: No hay match exacto ni en el CP → fuzzy en estado+municipio
      // Solo cambiar CP si la confianza es MUY ALTA
      const fuzzyMatches = await findColoniaFuzzy(coloniaCandidate, city, state);

      if (fuzzyMatches.length > 0) {
        const best = fuzzyMatches[0];

        if (best.cp === zip) {
          // Fuzzy encontró colonia en el MISMO CP → corrección menor de nombre
          const r = buildResult({
            errorType: "COLONIA_MAL_ESCRITA",
            confidence: best.confidence,
            detectedColonia: coloniaCandidate,
            addr1: cleanStreet.length > maxDir ? splitAddr1 : cleanStreet,
            addr2: addr2 !== coloniaCandidate ? addr2 : undefined,
            city, state,
            zip, // CP original
            colonia: best.colonia,
            reference: splitRef || undefined,
            notes: `✓ CP ${zip} correcto · Fuzzy en CP: "${coloniaCandidate}" → "${best.colonia}" (${best.matchPct}%)`,
          });
          // Si la confianza es baja (<60%), mostrar alternativas para que el usuario elija
          if (best.confidence === "BAJA" || best.confidence === "CRITICA") {
            r.coloniasSugeridas = [
              { colonia: best.colonia, cp: best.cp, matchPct: best.matchPct },
              ...fuzzyMatches.slice(1).map((m) => ({ colonia: m.colonia, cp: m.cp, matchPct: m.matchPct })),
              ...cpData.colonias
                .filter((c) => c.colonia !== best.colonia)
                .slice(0, 12)
                .map((c) => ({ colonia: c.colonia, cp: c.cp })),
            ].slice(0, 15);
          }
          return r;
        }

        // Fuzzy encontró otra CP — solo sugerir cambio si confianza MUY ALTA
        if (best.confidence === "ALTA") {
          return buildResult({
            errorType: "COLONIA_MAL_ESCRITA",
            confidence: "MEDIA", // Degradar a MEDIA porque CP cambia
            detectedColonia: coloniaCandidate,
            addr1: cleanStreet.length > maxDir ? splitAddr1 : cleanStreet,
            addr2: addr2 !== coloniaCandidate ? addr2 : undefined,
            city, state,
            zip: best.cp,
            colonia: best.colonia,
            reference: splitRef || undefined,
            notes: `CP ${zip} válido pero colonia no encontrada en él · Posible: "${best.colonia}" en CP ${best.cp} (${best.matchPct}%)`,
          });
        }

        // Confianza media/baja: mantener CP original, solo señalar la discrepancia
        return {
          errorType: "SIN_COLONIA",
          confidence: "MEDIA",
          detectedColonia: coloniaCandidate,
          suggestedAddress: {
            address1: cleanStreet.length > maxDir ? splitAddr1 : cleanStreet,
            city, state,
            zip, // CP original
          },
          errorDetails: `Colonia "${coloniaCandidate}" no encontrada en CP ${zip} (${cpData.colonias.length} colonias disponibles)`,
          notes: `CP ${zip} válido para ${state} · Posible colonia cercana: "${best.colonia}" (${best.matchPct}%) — revisar manualmente`,
          source: "sepomex",
          coloniasSugeridas: cpData.colonias.slice(0, 15).map((c) => ({ colonia: c.colonia, cp: c.cp })),
        };
      }

      // Sin ningún match pero CP válido — solo señalar que falta colonia
      return {
        errorType: "SIN_COLONIA",
        confidence: "BAJA",
        detectedColonia: coloniaCandidate,
        suggestedAddress: {
          address1: cleanStreet.length > maxDir ? splitAddr1 : cleanStreet,
          city, state,
          zip, // CP original válido
        },
        errorDetails: `Colonia "${coloniaCandidate}" no encontrada en SEPOMEX · CP ${zip} sí es válido`,
        notes: `CP ${zip} válido para ${state} · Colonias en ese CP: ${cpData.colonias.map((c) => c.colonia).join(", ")}`,
        source: "sepomex",
        coloniasSugeridas: cpData.colonias.slice(0, 15).map((c) => ({ colonia: c.colonia, cp: c.cp })),
      };
    }

    // ── A2: Sin colonia detectada, pero CP válido ──────
    const numColonias = cpData.colonias.length;

    if (numColonias === 1) {
      // Una sola colonia → asignar automáticamente
      const sola = cpData.colonias[0];
      return buildResult({
        errorType: "SIN_COLONIA",
        confidence: "MEDIA",
        detectedColonia: null,
        addr1: cleanStreet.length > maxDir ? splitAddr1 : cleanStreet,
        addr2: addr2 || undefined,
        city, state,
        zip, colonia: sola.colonia,
        reference: splitRef || undefined,
        notes: `CP ${zip} tiene una sola colonia: "${sola.colonia}" → asignada automáticamente`,
      });
    }

    if (numColonias <= 4) {
      const primera = cpData.colonias[0];
      const r = buildResult({
        errorType: "SIN_COLONIA",
        confidence: "BAJA",
        detectedColonia: null,
        addr1: cleanStreet.length > maxDir ? splitAddr1 : cleanStreet,
        addr2: addr2 || undefined,
        city, state,
        zip, colonia: primera.colonia,
        reference: splitRef || undefined,
        notes: `CP ${zip} válido · ${numColonias} colonias posibles: ${cpData.colonias.map((c) => c.colonia).join(", ")}`,
      });
      r.coloniasSugeridas = cpData.colonias.map((c) => ({ colonia: c.colonia, cp: c.cp }));
      return r;
    }

    // Muchas colonias — pedir al usuario que especifique
    return {
      errorType: "SIN_COLONIA",
      confidence: "MEDIA",
      suggestedAddress: { address1: cleanStreet, city, state, zip },
      errorDetails: `No se detectó colonia · CP ${zip} válido con ${numColonias} colonias`,
      notes: `CP ${zip} correcto · El usuario debe especificar la colonia`,
      coloniasSugeridas: cpData.colonias.slice(0, 15).map((c) => ({ colonia: c.colonia, cp: c.cp })),
    };
  }

  // ═════════════════════════════════════════════════════
  // CASO B: CP inválido o no pertenece a este estado
  // ═════════════════════════════════════════════════════

  // PASO 3: Buscar colonia por nombre en el estado/municipio
  if (coloniaCandidate) {
    // B1: Búsqueda exacta
    const coloniaExacta = await findColoniaExacta(coloniaCandidate, city, state);
    if (coloniaExacta) {
      return buildResult({
        errorType: "CP_INCORRECTO",
        confidence: "ALTA",
        detectedColonia: coloniaCandidate,
        addr1: cleanStreet.length > maxDir ? splitAddr1 : cleanStreet,
        addr2: addr2 !== coloniaCandidate ? addr2 : undefined,
        city, state,
        zip: coloniaExacta.cp,
        colonia: coloniaExacta.colonia,
        reference: splitRef || undefined,
        notes: `✓ Colonia exacta en SEPOMEX · CP ${zip} → correcto: ${coloniaExacta.cp} · ${coloniaExacta.municipio}, ${coloniaExacta.estado}`,
      });
    }

    // B2: Fuzzy matching en estado+municipio
    const fuzzyMatches = await findColoniaFuzzy(coloniaCandidate, city, state);
    if (fuzzyMatches.length > 0) {
      const best = fuzzyMatches[0];
      const r = buildResult({
        errorType: "COLONIA_MAL_ESCRITA",
        confidence: best.confidence,
        detectedColonia: coloniaCandidate,
        addr1: cleanStreet.length > maxDir ? splitAddr1 : cleanStreet,
        addr2: addr2 !== coloniaCandidate ? addr2 : undefined,
        city, state,
        zip: best.cp,
        colonia: best.colonia,
        reference: splitRef || undefined,
        notes: `SEPOMEX fuzzy ${best.matchPct}% · "${coloniaCandidate}" → "${best.colonia}" en ${best.municipio}, ${best.estado}`,
      });
      // Si la confianza es baja (<60%), mostrar todas las alternativas del fuzzy
      if (best.confidence === "BAJA" || best.confidence === "CRITICA") {
        r.coloniasSugeridas = fuzzyMatches.map((m) => ({
          colonia: m.colonia,
          cp: m.cp,
          matchPct: m.matchPct,
        }));
      }
      return r;
    }

    // B3: Fuente secundaria micodigopostal.org
    const sepomexLoaded = (await getColoniasCount()) > 0;
    if (sepomexLoaded) {
      const miCpResult = await validateWithMiCp(coloniaCandidate, zip, city, state);
      if (miCpResult?.found) {
        return buildResult({
          errorType: "COLONIA_MAL_ESCRITA",
          confidence: miCpResult.confidence,
          detectedColonia: coloniaCandidate,
          addr1: cleanStreet.length > maxDir ? splitAddr1 : cleanStreet,
          addr2: addr2 !== coloniaCandidate ? addr2 : undefined,
          city, state,
          zip: miCpResult.suggestedCp ?? zip,
          colonia: miCpResult.suggestedColonia ?? coloniaCandidate,
          reference: splitRef || undefined,
          notes: `✓ micodigopostal.org: "${miCpResult.suggestedColonia}"`,
          source: "micodigopostal",
        });
      }
    }

    // Sin coincidencias
    return {
      errorType: "SIN_COLONIA_CP_INCORRECTO",
      confidence: "CRITICA",
      detectedColonia: coloniaCandidate,
      errorDetails: `Colonia "${coloniaCandidate}" no encontrada en ${state} · CP "${zip}" inválido`,
      notes: `Estado: ${state} · Ciudad: ${city} · CP intentado: ${zip}`,
    };
  }

  // Sin colonia Y sin CP válido
  return {
    errorType: "SIN_COLONIA_CP_INCORRECTO",
    confidence: "CRITICA",
    errorDetails: `Sin colonia detectada · CP "${zip}" inválido para ${state}`,
    notes: `Estado: ${state} · Ciudad: ${city}`,
  };
}

// ─────────────────────────────────────────────────────────
// Helper para construir ValidationResult de forma consistente
// ─────────────────────────────────────────────────────────
interface BuildResultParams {
  errorType: ValidationResult["errorType"];
  confidence: ValidationResult["confidence"];
  detectedColonia: string | null;
  addr1: string;
  addr2?: string;
  city: string;
  state: string;
  zip: string;
  colonia?: string;
  reference?: string;
  notes?: string;
  source?: ValidationResult["source"];
}

function buildResult(p: BuildResultParams): ValidationResult {
  return {
    errorType: p.errorType,
    confidence: p.confidence,
    detectedColonia: p.detectedColonia ?? undefined,
    suggestedAddress: {
      address1: p.addr1,
      address2: p.addr2,
      city: p.city,
      state: p.state,
      zip: p.zip,
      colonia: p.colonia,
      reference: p.reference,
    },
    notes: p.notes,
    source: p.source ?? "sepomex",
    errorDetails: undefined,
  };
}
