/**
 * POST /api/apply/bulk
 * ─────────────────────────────────────────────────────────────────────────────
 * Aplica masivamente todos los pedidos APPROVED en EnviaTodo.
 *
 * IMPORTANTE: abre el navegador UNA sola vez para todos los pedidos.
 *             Nunca abre/cierra el browser por cada pedido.
 *
 * Actions: start | stop | status | clear
 *
 * start  → Inicia el proceso en background. El cliente hace polling con "status".
 * stop   → Señala que el loop debe detenerse (flag). No mata el browser de golpe.
 * status → Devuelve el estado actual (log, progreso, errores).
 * clear  → Limpia el estado cuando el proceso terminó.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  bulkApplyCorrections,
  type BulkOrderInput,
  type BulkApplyResult,
} from "@/services/playwrightService";
import { log } from "@/services/loggerService";

// ─── Estado del proceso (module-level — app de un solo usuario) ───────────────
type BulkStatus = "idle" | "running" | "done" | "stopped" | "error";

let bulkRunning    = false;
let bulkStatus: BulkStatus = "idle";
let bulkLog        = "";
let bulkTotal      = 0;
let bulkDone       = 0;
let bulkErrors     = 0;
let bulkCurrentOrder = "";
let bulkStartedAt: string | null = null;

// Flag para stop: bulkApplyCorrections respeta este flag entre pedidos
// (no podemos matar la sesión a mitad de un formulario — esperamos que termine el pedido actual)
let stopRequested = false;

function ts() {
  return new Date().toTimeString().slice(0, 8);
}
function addLine(msg: string) {
  bulkLog += `[${ts()}] ${msg}\n`;
}

export async function POST(request: Request) {
  const body            = await request.json();
  const { action, debugMode, headless } = body as { action: string; debugMode?: boolean; headless?: boolean };
  const isDebug = debugMode === true;

  // ── START ─────────────────────────────────────────────────────────────────
  if (action === "start") {
    if (bulkRunning) {
      return NextResponse.json({
        success: false,
        message: "Ya hay una automatización activa",
      });
    }

    const approvedOrders = await prisma.order.findMany({
      where: { status: "APPROVED" },
      orderBy: { shopifyCreatedAt: "asc" },
    });

    if (approvedOrders.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No hay pedidos aprobados para procesar",
      });
    }

    // Resetear estado
    bulkTotal        = approvedOrders.length;
    bulkDone         = 0;
    bulkErrors       = 0;
    bulkLog          = "";
    bulkStatus       = "running";
    bulkRunning      = true;
    bulkStartedAt    = new Date().toISOString();
    bulkCurrentOrder = "";
    stopRequested    = false;

    addLine(`Iniciando automatización masiva EnviaTodo`);
    addLine(`${bulkTotal} pedido(s) aprobado(s) en cola`);
    addLine(`─────────────────────────────────────────`);

    await log(
      "[BULK_APPLY] START",
      `Iniciando aplicación masiva: ${bulkTotal} pedidos`,
      { level: "INFO" }
    );

    // Construir lista tipada para bulkApplyCorrections
    const orders: BulkOrderInput[] = approvedOrders.map((o) => ({
      id:              o.id,
      shopifyOrderNum: o.shopifyOrderNum,
      customerName:    o.customerName,
      origAddress1:    o.origAddress1,          // ← para identificar en búsqueda
      origAddress2:    o.origAddress2  ?? null,
      origCity:        o.origCity,              // ← para navegación robusta
      origZip:         o.origZip,
      enviatodoId:     o.enviatodoId   ?? null,
      sugAddress1:     o.sugAddress1   ?? null,
      sugAddress2:     o.sugAddress2   ?? null,
      sugCity:         o.sugCity       ?? null,
      sugState:        o.sugState      ?? null,
      sugZip:          o.sugZip        ?? null,
      sugColonia:      o.sugColonia    ?? null,
      sugReference:    o.sugReference  ?? null,
    }));

    // ── Proceso asíncrono en background ──────────────────────────────────────
    // NO usamos await — la respuesta HTTP sale inmediatamente.
    // El cliente hace polling a "status" cada 1.5s para ver el progreso.
    (async () => {
      try {
        await bulkApplyCorrections(
          // Filtrar pedidos si el usuario presionó Stop entre iteraciones
          orders.filter(() => !stopRequested || bulkRunning),

          // onLog: actualiza el log en tiempo real
          (msg: string) => {
            addLine(msg);
            // Detectar el pedido actual del mensaje
            const matchOrder = msg.match(/#(\d+)/);
            if (matchOrder) bulkCurrentOrder = `#${matchOrder[1]}`;
          },

          // onOrderComplete: actualiza la DB inmediatamente después de cada pedido
          async (result: BulkApplyResult) => {

            if (!bulkRunning) return; // Stop fue solicitado

            if (result.success) {
              await prisma.order.update({
                where: { id: result.orderId },
                data:  { status: "APPLIED", appliedAt: new Date() },
              });
              bulkDone++;

              // ── Registrar en historial permanente ──────────────────────────
              // Buscar el order para obtener shopifyId y datos de dirección
              const ord = approvedOrders.find((o) => o.id === result.orderId);
              if (ord) {
                await prisma.appliedHistory.upsert({
                  where:  { shopifyId: ord.shopifyId },
                  create: {
                    shopifyId:       ord.shopifyId,
                    shopifyOrderNum: ord.shopifyOrderNum,
                    customerName:    ord.customerName,
                    origAddress1:    ord.origAddress1,
                    origCity:        ord.origCity,
                    origZip:         ord.origZip,
                    appliedColonia:  ord.sugColonia  ?? null,
                    appliedZip:      ord.sugZip      ?? null,
                    appliedAddress1: ord.sugAddress1 ?? null,
                  },
                  update: { appliedAt: new Date() },
                });
              }

              await log(
                "[BULK_APPLY] ORDER_OK",
                `Pedido ${result.orderId} aplicado en masa`,
                { level: "SUCCESS", orderId: result.orderId }
              );
            } else {
              await prisma.order.update({
                where: { id: result.orderId },
                data: {
                  status:       "NEEDS_REVIEW",
                  errorDetails: `Bulk apply: ${result.message}`,
                },
              });
              bulkErrors++;
              addLine(`   Progreso: ${bulkDone + bulkErrors}/${bulkTotal}`);
              await log(
                "[BULK_APPLY] ORDER_FAIL",
                `Pedido ${result.orderId}: ${result.message}`,
                { level: "ERROR", orderId: result.orderId }
              );
            }

            addLine(`   Progreso: ${bulkDone + bulkErrors}/${bulkTotal}`);

            // Verificar flag de stop entre pedidos
            if (stopRequested) {
              bulkRunning = false;
            }
          },

          // debugMode: muestra screenshots paso a paso
          isDebug,

          // headless: undefined = leer de settings; false = ventana visible; true = segundo plano
          headless
        );

      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addLine(`❌ Error fatal: ${msg}`);
        await log("[BULK_APPLY] FATAL", `Error fatal: ${msg}`, { level: "ERROR" });
        bulkStatus = "error";
      } finally {
        bulkRunning      = false;
        bulkCurrentOrder = "";

        if (bulkStatus === "running") {
          bulkStatus = stopRequested ? "stopped" : "done";
        }

        addLine(`─────────────────────────────────────────`);
        if (bulkStatus === "stopped") {
          addLine(`⏹️  Proceso detenido · ${bulkDone}/${bulkTotal} aplicados`);
        } else if (bulkStatus === "done") {
          addLine(`✅ Proceso terminado`);
          addLine(`✅ ${bulkDone} exitosos  ❌ ${bulkErrors} errores  📦 ${bulkTotal} total`);
        }

        await log(
          "[BULK_APPLY] DONE",
          `Bulk: ${bulkDone}/${bulkTotal} exitosos, ${bulkErrors} errores`,
          { level: bulkErrors > 0 ? "WARN" : "SUCCESS" }
        );
      }
    })();

    return NextResponse.json({
      success: true,
      total:   bulkTotal,
      message: `Procesando ${bulkTotal} pedidos con EnviaTodo…`,
    });
  }

  // ── STOP ──────────────────────────────────────────────────────────────────
  if (action === "stop") {
    stopRequested = true;
    bulkStatus    = "stopped";
    addLine(`⏹️  Stop solicitado — esperando que el pedido actual termine`);
    return NextResponse.json({ success: true });
  }

  // ── STATUS ────────────────────────────────────────────────────────────────
  if (action === "status") {
    return NextResponse.json({
      running:      bulkRunning,
      status:       bulkStatus,
      log:          bulkLog,
      total:        bulkTotal,
      done:         bulkDone,
      errors:       bulkErrors,
      currentOrder: bulkCurrentOrder,
      startedAt:    bulkStartedAt,
    });
  }

  // ── CLEAR ─────────────────────────────────────────────────────────────────
  if (action === "clear") {
    if (bulkRunning) {
      return NextResponse.json({
        success: false,
        message: "No se puede limpiar mientras hay un proceso activo",
      });
    }
    bulkLog          = "";
    bulkStatus       = "idle";
    bulkTotal        = 0;
    bulkDone         = 0;
    bulkErrors       = 0;
    bulkCurrentOrder = "";
    bulkStartedAt    = null;
    stopRequested    = false;
    return NextResponse.json({ success: true });
  }

  return NextResponse.json(
    { success: false, message: "Acción inválida" },
    { status: 400 }
  );
}
