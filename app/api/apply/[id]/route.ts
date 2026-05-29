import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { applyCorrectionsToEnviaTodo } from "@/services/playwrightService";
import { log } from "@/services/loggerService";
import path from "path";

const BUILT_IN_FLOW_FILE = path.join(process.cwd(), "services", "playwrightService.ts");

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: paramId }              = await params;
  const body                         = await request.json().catch(() => ({}));
  const { debugMode = false }        = body as { debugMode?: boolean };

  try {
    const order = await prisma.order.findUnique({ where: { id: paramId } });

    if (!order) {
      return NextResponse.json(
        { success: false, message: "Pedido no encontrado" },
        { status: 404 }
      );
    }

    if (order.status !== "APPROVED") {
      return NextResponse.json(
        { success: false, message: "El pedido debe estar APROBADO antes de aplicar" },
        { status: 400 }
      );
    }

    const diag = [
      "[DIAG] Punto de decision: /api/apply/[id]",
      "[DIAG] Flujo seleccionado UI: (no aplica; endpoint individual no recibe scriptName)",
      "[DIAG] Flow ID: (no existe)",
      "[DIAG] Origen del flujo: configuracion default / built-in",
      `[DIAG] Fallback/default flow: ${BUILT_IN_FLOW_FILE}`,
      `[DIAG] Ruta absoluta del flujo activo: ${BUILT_IN_FLOW_FILE}`,
      "[DIAG] Archivo compilado dist/build/.next: no",
      `[DIAG] Comando exacto: no usa CLI; llama applyCorrectionsToEnviaTodo()`,
      `[DIAG] Working directory: ${process.cwd()}`,
      `[DIAG] Variables entorno relevantes: PLAYWRIGHT_ACTIVE_FLOW_PATH=${BUILT_IN_FLOW_FILE}; NODE_ENV=${process.env.NODE_ENV ?? "(unset)"}`,
      "[DIAG] Llama funciones de pedidos antes del script: si; ensureLoggedIn -> applyOneOrder -> navigateToOrders",
    ].join("\n");
    console.log(diag);
    process.env.PLAYWRIGHT_ACTIVE_FLOW_PATH = BUILT_IN_FLOW_FILE;

    const result = await applyCorrectionsToEnviaTodo(
      order.id,
      {
        // ── Datos del pedido para búsqueda dinámica ────────────────────────
        shopifyOrderNum: order.shopifyOrderNum,
        customerName:    order.customerName,
        origAddress1:    order.origAddress1,
        origCity:        order.origCity,
        origZip:         order.origZip,
        // ── Correcciones aprobadas ─────────────────────────────────────────
        address1:        order.sugAddress1   ?? undefined,
        zip:             order.sugZip        ?? undefined,
        colonia:         order.sugColonia    ?? undefined,
        reference:       order.sugReference  ?? undefined,
      },
      debugMode
    );

    if (result.success) {
      await prisma.order.update({
        where: { id: paramId },
        data:  { status: "APPLIED", appliedAt: new Date() },
      });

      // ── Registrar en historial permanente (no reaparece en próximas syncs) ──
      await prisma.appliedHistory.upsert({
        where:  { shopifyId: order.shopifyId },
        create: {
          shopifyId:       order.shopifyId,
          shopifyOrderNum: order.shopifyOrderNum,
          customerName:    order.customerName,
          origAddress1:    order.origAddress1,
          origCity:        order.origCity,
          origZip:         order.origZip,
          appliedColonia:  order.sugColonia  ?? null,
          appliedZip:      order.sugZip      ?? null,
          appliedAddress1: order.sugAddress1 ?? null,
        },
        update: { appliedAt: new Date() },
      });

      await log(
        "APPLY_ORDER",
        `Pedido #${order.shopifyOrderNum} aplicado en EnviaTodo`,
        { level: "SUCCESS", orderId: order.id }
      );
    } else {
      await prisma.order.update({
        where: { id: paramId },
        data: {
          status:       "NEEDS_REVIEW",
          errorDetails: `Error apply: ${result.message}`,
        },
      });
    }

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
