import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeText } from "@/lib/utils";
import { log } from "@/services/loggerService";
import * as XLSX from "xlsx";

export const maxDuration = 120;

/**
 * Columnas reales del archivo SEPOMEX oficial (CPdescarga.xlsx de correos.gob.mx)
 * El archivo puede tener:
 * - Una sola hoja con todos los estados
 * - Múltiples hojas (una por estado o región)
 * - Una fila descripción antes de los encabezados
 */
const COLUMN_MAP: Record<string, string> = {
  // CP
  d_codigo: "cp",
  "d_codigo ": "cp",
  codigo_postal: "cp",
  cp: "cp",
  "código postal": "cp",

  // Colonia / Asentamiento
  d_asenta: "colonia",
  "d_asenta ": "colonia",
  asentamiento: "colonia",
  colonia: "colonia",
  nombre_asentamiento: "colonia",
  asenta_nombre: "colonia",

  // Tipo de asentamiento (referencia)
  d_tipo_asenta: "tipo",
  tipo_asenta: "tipo",
  tipo_asentamiento: "tipo",

  // Municipio (D_mnpio con D mayúscula es el nombre real de SEPOMEX)
  // normalizeKey() ya convierte a minúsculas, así que "D_mnpio" → "d_mnpio"
  d_mnpio: "municipio",
  "d_mnpio ": "municipio",
  municipio: "municipio",
  d_municipio: "municipio",
  municipio_nombre: "municipio",
  nombre_municipio: "municipio",

  // Estado
  d_estado: "estado",
  "d_estado ": "estado",
  estado: "estado",
  entidad: "estado",
  nombre_estado: "estado",

  // Ciudad (opcional — fallback para municipio)
  d_ciudad: "ciudad",
  ciudad: "ciudad",
};

interface SepomexRow {
  cp: string;
  colonia: string;
  municipio: string;
  estado: string;
  tipo?: string;
  ciudad?: string;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().trim().replace(/\s+/g, " ");
}

/** Detecta el encabezado real en una hoja (puede estar en fila 0 o 1) */
function detectHeaderRow(raw: unknown[][]): { headerRow: number; colMap: Record<number, string> } {
  for (let rowIdx = 0; rowIdx <= 3; rowIdx++) {
    const row = raw[rowIdx];
    if (!row) continue;
    const colMap: Record<number, string> = {};
    let matched = 0;
    for (let colIdx = 0; colIdx < row.length; colIdx++) {
      const cellKey = normalizeKey(String(row[colIdx] ?? ""));
      const mapped = COLUMN_MAP[cellKey];
      if (mapped) {
        colMap[colIdx] = mapped;
        matched++;
      }
    }
    if (matched >= 3) {
      return { headerRow: rowIdx, colMap };
    }
  }
  return { headerRow: -1, colMap: {} };
}

/** Procesa los datos de una hoja */
function parseSheet(ws: XLSX.WorkSheet): SepomexRow[] {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" }) as unknown[][];
  if (raw.length < 2) return [];

  const { headerRow, colMap } = detectHeaderRow(raw);
  if (headerRow === -1) {
    // Fallback: asumir que los headers son los de SEPOMEX estándar por posición
    // d_codigo(0), d_asenta(1), d_tipo_asenta(2), D_mnpio(3), d_estado(4), d_ciudad(5)
    const fallbackMap: Record<number, string> = {
      0: "cp",
      1: "colonia",
      2: "tipo",
      3: "municipio",
      4: "estado",
      5: "ciudad",
    };
    const rows: SepomexRow[] = [];
    for (let i = 1; i < raw.length; i++) {
      const row = raw[i];
      const rec: Partial<SepomexRow> = {};
      for (const [colIdx, field] of Object.entries(fallbackMap)) {
        rec[field as keyof SepomexRow] = String(row[Number(colIdx)] ?? "").trim();
      }
      if (rec.cp && rec.colonia && (rec.municipio || rec.ciudad) && rec.estado) {
        rows.push(rec as SepomexRow);
      }
    }
    return rows;
  }

  const rows: SepomexRow[] = [];
  for (let i = headerRow + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!row || !row.some(Boolean)) continue; // fila vacía

    const rec: Partial<SepomexRow> = {};
    for (const [colIdx, field] of Object.entries(colMap)) {
      rec[field as keyof SepomexRow] = String(row[Number(colIdx)] ?? "").trim();
    }

    // Usar ciudad como fallback para municipio
    if (!rec.municipio && rec.ciudad) rec.municipio = rec.ciudad;

    if (rec.cp && rec.colonia && rec.municipio && rec.estado) {
      rows.push(rec as SepomexRow);
    }
  }
  return rows;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ success: false, message: "No se recibió archivo" }, { status: 400 });
    }

    await log("[SEPOMEX] IMPORT_START", `Leyendo archivo: ${file.name} (${Math.round(file.size / 1024)} KB)`, {
      level: "INFO",
    });

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });

    if (workbook.SheetNames.length === 0) {
      return NextResponse.json({ success: false, message: "El archivo no contiene hojas" }, { status: 400 });
    }

    await log("[SEPOMEX] SHEETS_DETECTED", `${workbook.SheetNames.length} hoja(s): ${workbook.SheetNames.join(", ")}`, {
      level: "INFO",
    });

    // Recopilar filas de TODAS las hojas
    const allRows: SepomexRow[] = [];
    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      const rows = parseSheet(ws);
      await log("[SEPOMEX] SHEET_PARSED", `Hoja "${sheetName}": ${rows.length} registros válidos`, {
        level: "INFO",
      });
      allRows.push(...rows);
    }

    if (allRows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message:
            "No se encontraron registros válidos. Verifica que el archivo tenga columnas: d_codigo, d_asenta, D_mnpio, d_estado",
        },
        { status: 400 }
      );
    }

    await log("[SEPOMEX] IMPORT_PROCESS", `Procesando ${allRows.length} registros...`, {
      level: "INFO",
    });

    // Limpiar tabla antes de importar
    await prisma.colonia.deleteMany();

    // Insertar en lotes de 500 con deduplicación en memoria
    const BATCH = 500;
    let inserted = 0;
    const seen = new Set<string>();

    const cleanRows = allRows
      .map((row) => {
        const colonia = row.colonia.trim().replace(/\s+/g, " ");
        const cp = String(row.cp).trim().replace(/\D/g, "").padStart(5, "0");
        const municipio = row.municipio.trim().replace(/\s+/g, " ");
        const estado = row.estado.trim().replace(/\s+/g, " ");
        const coloniaNorm = normalizeText(colonia);
        return { colonia, cp, municipio, estado, coloniaNorm };
      })
      .filter((r) => {
        if (!r.colonia || !r.cp || r.cp === "00000" || !r.municipio || !r.estado) return false;
        const key = `${r.cp}|${r.coloniaNorm}|${r.municipio.toLowerCase().slice(0, 8)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    for (let i = 0; i < cleanRows.length; i += BATCH) {
      const batch = cleanRows.slice(i, i + BATCH);
      await prisma.colonia.createMany({ data: batch });
      inserted += batch.length;
    }

    await log("[SEPOMEX] IMPORT_DONE", `${inserted.toLocaleString()} colonias importadas`, {
      level: "SUCCESS",
    });

    return NextResponse.json({
      success: true,
      inserted,
      sheets: workbook.SheetNames.length,
      raw: allRows.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    await log("[SEPOMEX] IMPORT_ERROR", message, { level: "ERROR" });
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
