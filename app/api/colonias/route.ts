/**
 * GET /api/colonias?cp=XXXXX
 * ─────────────────────────────────────────────────────────────────────────────
 * Devuelve las colonias disponibles para un código postal dado.
 * Usado por el picker de colonias en el panel lateral (modo edición manual).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { NextResponse } from "next/server";
import { getColoniasByCp } from "@/services/sepomexService";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cp = searchParams.get("cp")?.trim().replace(/\D/g, "").padStart(5, "0");

  if (!cp || cp === "00000" || cp.length !== 5) {
    return NextResponse.json({ colonias: [] });
  }

  try {
    const colonias = await getColoniasByCp(cp);
    return NextResponse.json({
      colonias: colonias.slice(0, 25).map((c) => ({
        colonia: c.colonia,
        cp:      c.cp,
      })),
    });
  } catch {
    return NextResponse.json({ colonias: [] });
  }
}
