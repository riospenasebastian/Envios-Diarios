/**
 * POST /api/orders/bulk
 * Operaciones masivas sobre pedidos seleccionados.
 *
 * Actions: approve | reject | revalidate
 * Body: { action, ids: string[] }
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { log } from "@/services/loggerService";

export async function POST(request: Request) {
  const body = await request.json();
  const { action, ids, reason } = body as {
    action: "approve" | "reject" | "revalidate";
    ids: string[];
    reason?: string;
  };

  if (!ids || ids.length === 0) {
    return NextResponse.json({ success: false, message: "No se especificaron pedidos" }, { status: 400 });
  }

  // ── APPROVE ──────────────────────────────────────────
  if (action === "approve") {
    const result = await prisma.order.updateMany({
      where: {
        id: { in: ids },
        status: { in: ["CORRECTABLE", "NEEDS_REVIEW", "CRITICAL"] },
      },
      data: { status: "APPROVED" },
    });
    await log(
      "[BULK] APPROVE",
      `${result.count} pedidos aprobados en masa (de ${ids.length} seleccionados)`,
      { level: "SUCCESS" }
    );
    return NextResponse.json({ success: true, count: result.count, action });
  }

  // ── REJECT ────────────────────────────────────────────
  if (action === "reject") {
    const result = await prisma.order.updateMany({
      where: {
        id: { in: ids },
        status: { notIn: ["APPLIED"] },
      },
      data: {
        status: "REJECTED",
        ...(reason ? { errorDetails: reason } : {}),
      },
    });
    await log(
      "[BULK] REJECT",
      `${result.count} pedidos rechazados en masa`,
      { level: "INFO" }
    );
    return NextResponse.json({ success: true, count: result.count, action });
  }

  // ── REVALIDATE ────────────────────────────────────────
  if (action === "revalidate") {
    const result = await prisma.order.updateMany({
      where: { id: { in: ids } },
      data: { status: "ANALYZING" },
    });
    await log(
      "[BULK] REVALIDATE",
      `${result.count} pedidos marcados para revalidación`,
      { level: "INFO" }
    );
    return NextResponse.json({ success: true, count: result.count, action });
  }

  return NextResponse.json({ success: false, message: "Acción no reconocida" }, { status: 400 });
}
