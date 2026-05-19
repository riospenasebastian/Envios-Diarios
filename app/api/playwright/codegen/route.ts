import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";

let codegenProcess: ReturnType<typeof spawn> | null = null;
let codegenOutput = "";
let codegenStartedAt: string | null = null;
let codegenStatus: "idle" | "starting" | "running" | "stopped" | "error" = "idle";

/**
 * Archivo de salida en os.tmpdir() → ruta sin espacios en Windows.
 * (process.cwd() contiene "app facebook ads/app envios" con espacios)
 */
const SAFE_OUTPUT_FILE = path.join(os.tmpdir(), "playwright_codegen_output.ts");

export async function POST(request: Request) {
  const body = await request.json();
  const { action, url } = body as { action: string; url?: string };

  // ──────────────────────────────────────────────────────
  // START
  // ──────────────────────────────────────────────────────
  if (action === "start") {
    if (codegenProcess) {
      return NextResponse.json({ success: false, message: "Ya hay una grabación en curso" });
    }

    const target = (url || "https://app.enviatodo.com").trim();
    codegenOutput = `[${new Date().toISOString()}] Iniciando codegen → ${target}\n`;
    codegenOutput += `[INFO] Archivo de salida: ${SAFE_OUTPUT_FILE}\n`;
    codegenStartedAt = new Date().toISOString();
    codegenStatus = "starting";

    try {
      /**
       * SOLUCIÓN DEFINITIVA para Windows con rutas con espacios:
       *
       * - shell: true   → el shell del OS (cmd.exe en Win) resuelve npx
       * - array de args → Node.js pasa cada arg individualmente al shell,
       *                   que los comilla cuando es necesario
       * - detached: false → el proceso queda vinculado; no usar unref()
       * - SAFE_OUTPUT_FILE usa os.tmpdir() → ruta sin espacios garantizada
       *
       * NO usar: exec(), cmd.exe /c con string concatenado, ni detached: true
       */
      // --viewport-size → ventana grande para usar EnviaTodo con comodidad
      // --browser=chromium → forzar Chromium (evita problemas con otros browsers)
      codegenProcess = spawn(
        "npx",
        [
          "playwright", "codegen",
          "--browser=chromium",
          "--viewport-size=1920,1080",
          "--output", SAFE_OUTPUT_FILE,
          target,
        ],
        {
          shell: true,
          detached: false,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env },
          cwd: process.cwd(),
        }
      );

      codegenOutput += `[CMD] npx playwright codegen --browser=chromium --viewport-size=1920,1080 --output ${SAFE_OUTPUT_FILE} ${target}\n`;

      codegenProcess.stdout?.on("data", (d: Buffer) => {
        codegenOutput += d.toString();
        if (codegenStatus === "starting") codegenStatus = "running";
      });

      codegenProcess.stderr?.on("data", (d: Buffer) => {
        const text = d.toString();
        codegenOutput += text;
        if (codegenStatus === "starting") codegenStatus = "running";
      });

      codegenProcess.on("error", (err) => {
        codegenOutput += `\n[ERROR] ${err.message}\n`;
        codegenOutput += `Asegúrate de que Playwright está instalado:\n  npx playwright install chromium\n`;
        codegenStatus = "error";
        codegenProcess = null;
      });

      codegenProcess.on("close", (code) => {
        codegenOutput += `\n[${new Date().toISOString()}] Proceso terminado (código ${code})\n`;

        if (code !== 0 && code !== null && codegenStatus !== "stopped") {
          codegenStatus = "error";
          codegenOutput += `\n⚠️  El proceso terminó con error.\n`;
          codegenOutput += `Posibles causas:\n`;
          codegenOutput += `  1. Browser no instalado → ejecuta: npx playwright install chromium\n`;
          codegenOutput += `  2. Playwright no instalado → ejecuta: npm install @playwright/test\n`;
          codegenOutput += `  3. Revisar los mensajes de error arriba.\n`;
        } else if (codegenStatus !== "stopped") {
          codegenStatus = "stopped";
        }
        codegenProcess = null;
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      codegenOutput += `\n[ERROR AL INICIAR] ${msg}\n`;
      codegenStatus = "error";
      codegenProcess = null;
      return NextResponse.json({ success: false, message: `Error iniciando codegen: ${msg}` });
    }

    return NextResponse.json({
      success: true,
      status: codegenStatus,
      message: `Codegen iniciado → ${target}. Espera 3-5 segundos a que se abra Chrome.`,
    });
  }

  // ──────────────────────────────────────────────────────
  // STOP
  // ──────────────────────────────────────────────────────
  if (action === "stop") {
    if (codegenProcess) {
      try {
        if (process.platform === "win32") {
          // En Windows, kill() termina el proceso cmd.exe pero no necesariamente
          // los procesos hijos (el browser). Usamos taskkill para ser más agresivos.
          spawn("taskkill", ["/F", "/T", "/PID", String(codegenProcess.pid)], { shell: false });
        } else {
          codegenProcess.kill("SIGTERM");
        }
      } catch { /* proceso ya terminado */ }
      codegenProcess = null;
    }
    codegenStatus = "stopped";
    codegenOutput += `\n[${new Date().toISOString()}] Grabación detenida por el usuario.\n`;

    let code = "";
    try {
      if (fs.existsSync(SAFE_OUTPUT_FILE)) {
        code = fs.readFileSync(SAFE_OUTPUT_FILE, "utf-8");
      }
    } catch { code = ""; }

    return NextResponse.json({ success: true, code, output: codegenOutput, status: codegenStatus });
  }

  // ──────────────────────────────────────────────────────
  // STATUS — polling del cliente
  // ──────────────────────────────────────────────────────
  if (action === "status") {
    return NextResponse.json({
      running: !!codegenProcess,
      status: codegenStatus,
      output: codegenOutput,
      startedAt: codegenStartedAt,
    });
  }

  // ──────────────────────────────────────────────────────
  // READ — leer último código generado
  // ──────────────────────────────────────────────────────
  if (action === "read") {
    let code = "";
    try {
      if (fs.existsSync(SAFE_OUTPUT_FILE)) {
        code = fs.readFileSync(SAFE_OUTPUT_FILE, "utf-8");
      }
    } catch { code = ""; }
    return NextResponse.json({ success: true, code, output: codegenOutput });
  }

  // ──────────────────────────────────────────────────────
  // CLEAR — limpiar logs
  // ──────────────────────────────────────────────────────
  if (action === "clear") {
    codegenOutput = "";
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ success: false, message: "Acción inválida" }, { status: 400 });
}
