/**
 * GET /api/colonias/search?q=QUERY&estado=ESTADO&ciudad=CIUDAD
 * ─────────────────────────────────────────────────────────────────────────────
 * Búsqueda fuzzy de colonias por nombre parcial dentro del estado/ciudad.
 * Usado por el autocomplete del campo Colonia en el panel de edición manual.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { NextResponse } from "next/server";
import { findColoniaFuzzy } from "@/services/sepomexService";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q      = searchParams.get("q")?.trim()      ?? "";
  const estado = searchParams.get("estado")?.trim()  ?? "";
  const ciudad = searchParams.get("ciudad")?.trim()  ?? "";

  if (q.length < 3) {
    return NextResponse.json({ colonias: [] });
  }

  try {
    const matches = await findColoniaFuzzy(q, ciudad, estado);
    return NextResponse.json({
      colonias: matches.slice(0, 10).map((m) => ({
        colonia:  m.colonia,
        cp:       m.cp,
        matchPct: m.matchPct,
      })),
    });
  } catch {
    return NextResponse.json({ colonias: [] });
  }
}
