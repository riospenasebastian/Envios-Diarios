/**
 * /api/playwright/run
 * Ejecuta un script Playwright guardado en playwright/scripts/
 * y transmite los logs en tiempo real mediante polling.
 *
 * Acciones: start | stop | status | clear
 *
 * Detección automática de formato:
 *  - Si el script importa de "@playwright/test" → npx playwright test --headed
 *  - Si el script importa de "playwright"       → npx tsx <archivo>
 */
import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const SCRIPTS_DIR    = path.join(process.cwd(), "playwright", "scripts");
const PW_CONFIG_FILE = path.join(SCRIPTS_DIR, "playwright.config.ts");

function diagEnv(values: Record<string, string | undefined>) {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value ?? "(unset)"}`)
    .join("\n");
}

function isCompiledPath(filePath: string) {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  return /\/(dist|build|out|compiled|\.next)\//.test(normalized);
}

/** Asegura que exista un playwright.config.ts que reconozca cualquier .ts como test. */
function ensurePlaywrightConfig() {
  if (fs.existsSync(PW_CONFIG_FILE)) {
    try {
      const cur = fs.readFileSync(PW_CONFIG_FILE, "utf-8");
      if (cur.includes("headless se controla desde la CLI")) return;
      fs.unlinkSync(PW_CONFIG_FILE);   // versión vieja → regenerar
    } catch { /* sobrescribir */ }
  }
  fs.writeFileSync(PW_CONFIG_FILE, `import { defineConfig } from '@playwright/test';

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
`, "utf-8");
}

type RunStatus = "idle" | "running" | "done" | "error" | "stopped";

let runProcess: ReturnType<typeof spawn> | null = null;
let runOutput = "";
let runStatus: RunStatus = "idle";
let currentScript = "";
let startedAt: string | null = null;

export async function POST(request: Request) {
  const body = await request.json();
  const { action, script, headless } = body as { action: string; script?: string; headless?: boolean };

  // ── START ────────────────────────────────────────────
  if (action === "start") {
    if (runProcess) {
      return NextResponse.json({ success: false, message: "Ya hay una ejecución en curso" });
    }
    if (!script) {
      return NextResponse.json({ success: false, message: "Nombre de script requerido" });
    }

    const scriptPath = path.join(SCRIPTS_DIR, path.basename(script));
    if (!scriptPath.startsWith(SCRIPTS_DIR)) {
      return NextResponse.json({ success: false, message: "Ruta inválida" });
    }
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json({ success: false, message: `Script no encontrado: ${script}` });
    }

    const code = fs.readFileSync(scriptPath, "utf-8");
    const isTestFile =
      code.includes("from '@playwright/test'") ||
      code.includes('from "@playwright/test"');

    currentScript = script;
    startedAt = new Date().toISOString();
    runOutput = `[${startedAt}] Iniciando script: ${script}\n`;
    runStatus = "running";

    // Para scripts de test (@playwright/test): npx playwright test --config ... --headed --reporter=line
    // Para scripts estándar (playwright):      npx tsx <archivo>
    if (isTestFile) ensurePlaywrightConfig();
    const wantsHeadless = headless ?? false;   // standalone default: visible
    const baseTestArgs: string[] = [
      "playwright", "test",
      path.basename(scriptPath),
      "--config", "playwright.config.ts",
      "--reporter=line",
    ];
    if (!wantsHeadless) baseTestArgs.push("--headed");
    const args: string[] = isTestFile ? baseTestArgs : ["tsx", path.basename(scriptPath)];
    const command = `npx ${args.join(" ")}`;
    const diag = [
      "[DIAG] Punto de decision: /api/playwright/run",
      `[DIAG] Flujo seleccionado UI: ${script}`,
      "[DIAG] Flow ID: (no existe en este runner; se usa nombre de archivo)",
      "[DIAG] Origen del flujo: archivo local",
      "[DIAG] Fallback/default flow: ninguno en /api/playwright/run",
      "[DIAG] Llama funciones de pedidos antes del script: no",
      `[DIAG] Ruta absoluta ejecutada: ${scriptPath}`,
      `[DIAG] Archivo compilado dist/build/.next: ${isCompiledPath(scriptPath) ? "si" : "no"}`,
      `[DIAG] Comando exacto: ${command}`,
      `[DIAG] Working directory: ${SCRIPTS_DIR}`,
      "[DIAG] Variables entorno relevantes:",
      diagEnv({
        PLAYWRIGHT_HEADLESS: wantsHeadless ? "1" : "0",
        PLAYWRIGHT_ACTIVE_FLOW_PATH: scriptPath,
        NODE_ENV: process.env.NODE_ENV,
      }),
    ].join("\n");

    runOutput += `${diag}\n`;
    runOutput += `[CMD] ${command}\n`;
    console.log(diag);

    try {
      runProcess = spawn("npx", args, {
  shell: true,
  detached: false,
  stdio: ["ignore", "pipe", "pipe"],
  cwd: SCRIPTS_DIR,
  env: {
    ...process.env,
    FORCE_COLOR: "0",
    PLAYWRIGHT_HEADLESS: wantsHeadless ? "1" : "0",
    PLAYWRIGHT_ACTIVE_FLOW_PATH: scriptPath,
  },
});

      runProcess.stdout?.on("data", (d: Buffer) => {
        runOutput += d.toString();
      });

      runProcess.stderr?.on("data", (d: Buffer) => {
        runOutput += d.toString();
      });

      runProcess.on("error", (err) => {
        runOutput += `\n[ERROR] ${err.message}\n`;
        if (err.message.includes("tsx")) {
          runOutput += `\n💡 Tip: instala tsx con: npm install -D tsx\n`;
        }
        runStatus = "error";
        runProcess = null;
      });

      runProcess.on("close", (code) => {
        runOutput += `\n[${new Date().toISOString()}] Script terminado (código ${code})\n`;
        if (code !== 0 && code !== null && runStatus !== "stopped") {
          runStatus = "error";
          runOutput += `\n⚠️  El script terminó con errores. Revisa los logs arriba.\n`;
        } else if (runStatus !== "stopped") {
          runStatus = "done";
          runOutput += `\n✅ Ejecución completada.\n`;
        }
        runProcess = null;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      runOutput += `\n[ERROR AL INICIAR] ${msg}\n`;
      runStatus = "error";
      runProcess = null;
      return NextResponse.json({ success: false, message: `Error: ${msg}` });
    }

    return NextResponse.json({
      success: true,
      message: `Ejecutando ${script}…`,
      status: runStatus,
    });
  }

  // ── STOP ─────────────────────────────────────────────
  if (action === "stop") {
    if (runProcess) {
      runStatus = "stopped";
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/F", "/T", "/PID", String(runProcess.pid)], {
            shell: false,
          });
        } else {
          runProcess.kill("SIGTERM");
        }
      } catch { /* proceso ya terminado */ }
      runProcess = null;
    }
    runOutput += `\n[${new Date().toISOString()}] Ejecución detenida por el usuario.\n`;
    return NextResponse.json({ success: true, status: runStatus });
  }

  // ── STATUS ────────────────────────────────────────────
  if (action === "status") {
    return NextResponse.json({
      running: !!runProcess,
      status: runStatus,
      output: runOutput,
      script: currentScript,
      startedAt,
    });
  }

  // ── CLEAR ─────────────────────────────────────────────
  if (action === "clear") {
    if (runProcess) {
      return NextResponse.json({
        success: false,
        message: "No se puede limpiar mientras hay una ejecución activa",
      });
    }
    runOutput = "";
    runStatus = "idle";
    currentScript = "";
    startedAt = null;
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, message: "Acción inválida" }, { status: 400 });
}
