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
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import {
  bulkApplyCorrections,
  type BulkOrderInput,
  type BulkApplyResult,
} from "@/services/playwrightService";
import { log } from "@/services/loggerService";

const SCRIPTS_DIR   = path.join(process.cwd(), "playwright", "scripts");
const ORDER_CTX_FILE = path.join(process.cwd(), "playwright", "current_order.json");
const PW_CONFIG_FILE = path.join(SCRIPTS_DIR, "playwright.config.ts");

/**
 * Crea (si no existe) un `playwright.config.ts` dentro de SCRIPTS_DIR que
 * permita que CUALQUIER archivo `.ts` sea reconocido como test.
 *
 * Por defecto Playwright Test solo busca archivos `*.spec.ts` o `*.test.ts`,
 * lo que rompe los scripts grabados (`flujo_xxx.ts`) con "No tests found".
 */
function ensurePlaywrightConfig() {
  // Si existe pero es la versión vieja (con headless: false hardcodeado),
  // lo regeneramos para que el flag --headed sí tenga efecto.
  if (fs.existsSync(PW_CONFIG_FILE)) {
    try {
      const cur = fs.readFileSync(PW_CONFIG_FILE, "utf-8");
      if (!cur.includes("headless se controla desde la CLI")) {
        fs.unlinkSync(PW_CONFIG_FILE);
      } else {
        return;
      }
    } catch { /* si falla la lectura, sobrescribimos */ }
  }
  const cfg = `import { defineConfig } from '@playwright/test';

// Auto-generado por la app para que los scripts grabados por codegen
// (con nombres tipo flujo_YYYYMMDD_HHMM.ts) sean reconocidos como tests.
// NOTA: el modo headless se controla desde la CLI (--headed) o via env
// PLAYWRIGHT_HEADLESS=1, NO se hardcodea aquí.
export default defineConfig({
  testMatch: ['**/*.ts'],
  testIgnore: ['**/playwright.config.ts'],
  reporter: 'line',
  fullyParallel: false,
  workers: 1,
  use: {
    viewport: { width: 1920, height: 1080 },
  },
  timeout: 120_000,
});
`;
  fs.writeFileSync(PW_CONFIG_FILE, cfg, "utf-8");
}

/**
 * Escribe el contexto del pedido en `playwright/current_order.json`
 * y luego ejecuta el script con `npx tsx`. Devuelve si terminó OK.
 */
function runScriptForOrder(scriptName: string, order: BulkOrderInput, headless: boolean): Promise<{ success: boolean; output: string }> {
  // Usar solo el basename + cwd=SCRIPTS_DIR para evitar que los espacios
  // en la ruta del proyecto rompan el comando al pasarlo por el shell.
  const scriptBasename = path.basename(scriptName);
  const scriptFullPath = path.join(SCRIPTS_DIR, scriptBasename);
  fs.writeFileSync(ORDER_CTX_FILE, JSON.stringify(order, null, 2), "utf-8");

  // ── Detección automática de formato (igual que /api/playwright/run) ────────
  // Si el script importa de @playwright/test → correr con `npx playwright test`
  // Si no → correr como script Node con `npx tsx`
  let isTestFile = false;
  try {
    const code = fs.readFileSync(scriptFullPath, "utf-8");
    isTestFile =
      code.includes("from '@playwright/test'") ||
      code.includes('from "@playwright/test"');
  } catch { /* archivo no existe — fallará al lanzar el proceso */ }

  // Para playwright test: asegurar config local que reconozca cualquier .ts
  if (isTestFile) ensurePlaywrightConfig();

  // ── Argumentos según modo y headless ─────────────────────────────────────
  // playwright test: --headed solo si NO es headless (omitir = headless por defecto)
  // tsx: el script lee process.env.PLAYWRIGHT_HEADLESS
  const baseTestArgs = ["playwright", "test", scriptBasename, "--config", "playwright.config.ts", "--reporter=line"];
  if (!headless) baseTestArgs.push("--headed");

  const args = isTestFile ? baseTestArgs : ["tsx", scriptBasename];

  return new Promise((resolve) => {
    const proc = spawn("npx", args, {
      shell: true,
      cwd: SCRIPTS_DIR,   // ← sin espacios problemáticos en los args
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        PLAYWRIGHT_ORDER_ID:  order.id,
        PLAYWRIGHT_ORDER_NUM: order.shopifyOrderNum,
        PLAYWRIGHT_ORDER_CTX: ORDER_CTX_FILE,         // ruta absoluta al JSON de contexto
        PLAYWRIGHT_HEADLESS:  headless ? "1" : "0",   // para scripts tsx que lo respeten
      },
    });

    let output = "";
    proc.stdout?.on("data", (d: Buffer) => { output += d.toString(); });
    proc.stderr?.on("data", (d: Buffer) => { output += d.toString(); });
    proc.on("error", (err) => resolve({ success: false, output: err.message }));
    proc.on("close", (code) => resolve({ success: code === 0, output }));
  });
}

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
  const { action, debugMode, headless, scriptName } = body as {
    action: string;
    debugMode?: boolean;
    headless?: boolean;
    scriptName?: string;
  };
  const isDebug = debugMode === true;
  const useScript = scriptName ? path.basename(scriptName) : null;

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
    addLine(useScript ? `Modo: script → ${useScript}` : `Modo: flujo automático built-in`);
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
      // ── Helper compartido: actualiza DB tras procesar un pedido ────────────
      async function handleResult(result: BulkApplyResult) {
        if (!bulkRunning) return;

        if (result.success) {
          await prisma.order.update({
            where: { id: result.orderId },
            data:  { status: "APPLIED", appliedAt: new Date() },
          });
          bulkDone++;

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
          await log("[BULK_APPLY] ORDER_OK",  `Pedido ${result.orderId} aplicado`, { level: "SUCCESS", orderId: result.orderId });
        } else {
          // ── NO downgradear el pedido. Mantener APPROVED para poder reintentar ──
          // Las correcciones aprobadas se conservan; solo registramos el error
          // en errorDetails para que el usuario sepa qué pasó.
          await prisma.order.update({
            where: { id: result.orderId },
            data: { errorDetails: `Bulk apply falló: ${result.message}` },
          });
          bulkErrors++;
          await log("[BULK_APPLY] ORDER_FAIL", `Pedido ${result.orderId}: ${result.message} (sigue APPROVED para reintentar)`, { level: "ERROR", orderId: result.orderId });
        }

        addLine(`   Progreso: ${bulkDone + bulkErrors}/${bulkTotal}`);
        if (stopRequested) bulkRunning = false;
      }

      try {
        if (useScript) {
          // ── MODO SCRIPT: ejecutar el archivo .ts por cada pedido ────────────
          const scriptPath = path.join(SCRIPTS_DIR, useScript);
          if (!fs.existsSync(scriptPath)) throw new Error(`Script no encontrado: ${useScript}`);

          for (const order of orders) {
            if (stopRequested || !bulkRunning) break;

            bulkCurrentOrder = `#${order.shopifyOrderNum}`;
            addLine(`\n📦 #${order.shopifyOrderNum} · ${order.customerName}`);
            addLine(`   ▶ Ejecutando ${useScript}…`);

            // headless: undefined → respetar default (true = segundo plano); explícito gana
            const { success, output } = await runScriptForOrder(useScript, order, headless ?? true);

            // Mostrar el output: si OK pocas líneas, si falla TODO el output para debug
            const allLines = output.split("\n");
            const linesToShow = success ? allLines.slice(-5) : allLines;
            for (const l of linesToShow) {
              if (l.trim()) addLine(`   ${l}`);
            }

            // Mensaje de error: primera línea no vacía que contenga "Error" o la última
            let errMsg = "Error en script";
            if (!success) {
              const errLine = allLines.find((l) => /error/i.test(l) && l.trim().length > 0);
              errMsg = errLine?.trim() ?? allLines.filter((l) => l.trim()).pop() ?? errMsg;
            }
            await handleResult({ orderId: order.id, success, message: success ? "OK" : errMsg });
          }

        } else {
          // ── MODO BUILT-IN: flujo automático de playwrightService ────────────
          await bulkApplyCorrections(
            orders.filter(() => !stopRequested || bulkRunning),

            (msg: string) => {
              addLine(msg);
              const matchOrder = msg.match(/#(\d+)/);
              if (matchOrder) bulkCurrentOrder = `#${matchOrder[1]}`;
            },

            async (result: BulkApplyResult) => {
              await handleResult(result);
            },

            isDebug,
            headless
          );
        }

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
