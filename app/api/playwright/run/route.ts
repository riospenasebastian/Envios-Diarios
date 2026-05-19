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

const SCRIPTS_DIR = path.join(process.cwd(), "playwright", "scripts");

type RunStatus = "idle" | "running" | "done" | "error" | "stopped";

let runProcess: ReturnType<typeof spawn> | null = null;
let runOutput = "";
let runStatus: RunStatus = "idle";
let currentScript = "";
let startedAt: string | null = null;

export async function POST(request: Request) {
  const body = await request.json();
  const { action, script } = body as { action: string; script?: string };

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

    // Para scripts de test (@playwright/test): npx playwright test --headed --reporter=line
    // Para scripts estándar (playwright):      npx tsx <archivo>
    const args: string[] = isTestFile
      ? [
  "playwright",
  "test",
  path.basename(scriptPath),
  "--headed",
  "--reporter=line"
]
      : ["tsx", scriptPath];

    runOutput += `[CMD] npx ${args.join(" ")}\n`;

    try {
      runProcess = spawn("npx", args, {
  shell: true,
  detached: false,
  stdio: ["ignore", "pipe", "pipe"],
  cwd: SCRIPTS_DIR,
  env: {
    ...process.env,
    FORCE_COLOR: "0",
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
