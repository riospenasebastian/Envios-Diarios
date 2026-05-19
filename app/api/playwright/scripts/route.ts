/**
 * /api/playwright/scripts
 * Gestión de scripts Playwright guardados en playwright/scripts/
 *
 * Acciones: list | read | save | delete | parse
 */
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const SCRIPTS_DIR = path.join(process.cwd(), "playwright", "scripts");

if (!fs.existsSync(SCRIPTS_DIR)) {
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
}

// ─────────────────────────────────────────────────────────
// Parser de pasos legibles a partir de código TypeScript
// Soporta tanto el estilo antiguo (page.click) como el nuevo
// (page.locator, page.getByRole, page.getByLabel, etc.)
// ─────────────────────────────────────────────────────────

function cleanSelector(sel: string): string {
  const m = (r: RegExp) => sel.match(r)?.[1];

  const hasText = m(/has-text\(['"`]([^'"`]+)['"`]\)/);
  if (hasText) return `"${hasText}"`;

  const btnText = m(/button:has-text\(['"`]([^'"`]+)['"`]\)/);
  if (btnText) return `botón "${btnText}"`;

  const ph = m(/\[placeholder=['"`]([^'"`]+)['"`]\]/);
  if (ph) return `campo "${ph}"`;

  const aria = m(/\[aria-label=['"`]([^'"`]+)['"`]\]/);
  if (aria) return `"${aria}"`;

  const name = m(/\[name=['"`]([^'"`]+)['"`]\]/);
  if (name) return `campo ${name}`;

  const id = m(/^#([\w-]+)$/);
  if (id) return `#${id}`;

  const textEq = m(/^text=['"`]?([^'"`]+)['"`]?$/);
  if (textEq) return `"${textEq}"`;

  return sel.length > 40 ? sel.slice(0, 37) + "…" : sel;
}

function parseSteps(code: string): string[] {
  const steps: string[] = [];

  for (const rawLine of code.split("\n")) {
    const t = rawLine.trim();
    if (!t || t.startsWith("//") || t.startsWith("*") ||
      t.startsWith("import") || t.startsWith("const ") ||
      t.startsWith("interface") || t.startsWith("async function") ||
      t.startsWith("export") || t.startsWith("test(") ||
      t.startsWith("}")) continue;

    // ── Navegación ──────────────────────────────────────
    const goto = t.match(/\.goto\(['"`]([^'"`]+)['"`]/);
    if (goto) {
      const url = goto[1];
      steps.push(`🌐 Navegar a: ${url.length > 55 ? url.slice(0, 52) + "…" : url}`);
      continue;
    }

    // ── getByRole ────────────────────────────────────────
    const byRole = t.match(/\.getByRole\(['"`]([^'"`]+)['"`][^)]*(?:name:\s*['"`]([^'"`]+)['"`])?[^)]*\)\.(\w+)\((?:['"`]([^'"`]*)['"`])?\)/);
    if (byRole) {
      const role = byRole[1];
      const roleName = byRole[2];
      const action = byRole[3];
      const value = byRole[4];
      const label = roleName ? `"${roleName}"` : role;
      if (action === "click") { steps.push(`👆 Clic en: ${label}`); continue; }
      if (action === "fill") { steps.push(`✏️ Escribir "${value ?? ""}" en ${label}`); continue; }
    }

    // ── getByLabel ───────────────────────────────────────
    const byLabel = t.match(/\.getByLabel\(['"`]([^'"`]+)['"`]\)\.(\w+)\((?:['"`]([^'"`]*)['"`])?\)/);
    if (byLabel) {
      const lbl = byLabel[1], action = byLabel[2], val = byLabel[3];
      if (action === "fill") { steps.push(`✏️ Escribir "${val ?? ""}" en campo "${lbl}"`); continue; }
      if (action === "click") { steps.push(`👆 Clic en: "${lbl}"`); continue; }
    }

    // ── getByPlaceholder ─────────────────────────────────
    const byPh = t.match(/\.getByPlaceholder\(['"`]([^'"`]+)['"`]\)\.(\w+)\((?:['"`]([^'"`]*)['"`])?\)/);
    if (byPh) {
      const ph = byPh[1], action = byPh[2], val = byPh[3];
      if (action === "fill") { steps.push(`✏️ Escribir "${val ?? ""}" en "${ph}"`); continue; }
      if (action === "click") { steps.push(`👆 Clic en: "${ph}"`); continue; }
    }

    // ── getByText ────────────────────────────────────────
    const byText = t.match(/\.getByText\(['"`]([^'"`]+)['"`]\)\.(\w+)\(/);
    if (byText) {
      if (byText[2] === "click") { steps.push(`👆 Clic en texto: "${byText[1]}"`); continue; }
    }

    // ── locator → fill ───────────────────────────────────
    const locFill = t.match(/\.locator\(['"`]([^'"`]+)['"`]\)\.fill\(['"`]([^'"`]*)['"`]/);
    if (locFill) {
      steps.push(`✏️ Escribir "${locFill[2]}" en ${cleanSelector(locFill[1])}`);
      continue;
    }

    // ── locator → click ──────────────────────────────────
    const locClick = t.match(/\.locator\(['"`]([^'"`]+)['"`]\)\.click\(/);
    if (locClick) {
      steps.push(`👆 Clic en: ${cleanSelector(locClick[1])}`);
      continue;
    }

    // ── locator → selectOption ───────────────────────────
    const locSelect = t.match(/\.locator\(['"`]([^'"`]+)['"`]\)\.selectOption\(['"`]([^'"`]*)['"`]/);
    if (locSelect) {
      steps.push(`📋 Seleccionar "${locSelect[2]}" en ${cleanSelector(locSelect[1])}`);
      continue;
    }

    // ── page.fill (estilo antiguo) ───────────────────────
    const fill = t.match(/page\.fill\(['"`]([^'"`]+)['"`],\s*['"`]([^'"`]*)['"`]/);
    if (fill) {
      const val = fill[2];
      steps.push(`✏️ Escribir "${val.length > 25 ? val.slice(0, 22) + "…" : val}" en ${cleanSelector(fill[1])}`);
      continue;
    }

    // ── page.click (estilo antiguo) ──────────────────────
    const click = t.match(/page\.click\(['"`]([^'"`]+)['"`]/);
    if (click) {
      steps.push(`👆 Clic en: ${cleanSelector(click[1])}`);
      continue;
    }

    // ── selectOption ─────────────────────────────────────
    const select = t.match(/\.selectOption\(['"`]([^'"`]*?)['"`]\)/);
    if (select) {
      steps.push(`📋 Seleccionar: "${select[1]}"`);
      continue;
    }

    // ── waitForURL ────────────────────────────────────────
    const waitUrl = t.match(/\.waitForURL\(['"`]([^'"`]+)['"`]/);
    if (waitUrl) {
      steps.push(`⏳ Esperar URL: ${waitUrl[1].slice(0, 50)}`);
      continue;
    }

    // ── waitForSelector ───────────────────────────────────
    const waitSel = t.match(/\.waitForSelector\(['"`]([^'"`]+)['"`]/);
    if (waitSel) {
      steps.push(`⏳ Esperar elemento: ${cleanSelector(waitSel[1])}`);
      continue;
    }

    // ── waitForTimeout ────────────────────────────────────
    const waitMs = t.match(/\.waitForTimeout\((\d+)\)/);
    if (waitMs) {
      const ms = parseInt(waitMs[1]);
      const d = ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
      steps.push(`⏱️ Esperar ${d}`);
      continue;
    }

    // ── press ─────────────────────────────────────────────
    const press = t.match(/\.press\(['"`][^'"`]+['"`],\s*['"`]([^'"`]+)['"`]/);
    if (press) {
      steps.push(`⌨️ Tecla: ${press[1]}`);
      continue;
    }

    // ── check / uncheck ───────────────────────────────────
    const chk = t.match(/\.(check|uncheck)\(['"`]([^'"`]+)['"`]/);
    if (chk) {
      const lbl = chk[1] === "check" ? "✅ Marcar" : "☐ Desmarcar";
      steps.push(`${lbl}: ${cleanSelector(chk[2])}`);
      continue;
    }
  }

  return steps;
}

// ─────────────────────────────────────────────────────────
// Ruta principal
// ─────────────────────────────────────────────────────────

interface ScriptMeta {
  name: string;
  size: number;
  lastModified: string;
  stepCount: number;
  steps: string[];      // preview (first 5)
  isTemplate: boolean;
}

function safePath(name: string): string | null {
  const clean = path.basename(name); // strips any directory component
  const full = path.join(SCRIPTS_DIR, clean);
  return full.startsWith(SCRIPTS_DIR) ? full : null;
}

export async function POST(request: Request) {
  const body = await request.json();
  const { action, name, code } = body as { action: string; name?: string; code?: string };

  // ── LIST ─────────────────────────────────────────────
  if (action === "list") {
    try {
      const files = fs.readdirSync(SCRIPTS_DIR)
        .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
        .map((file): ScriptMeta => {
          const fp = path.join(SCRIPTS_DIR, file);
          const stat = fs.statSync(fp);
          const content = fs.readFileSync(fp, "utf-8");
          const steps = parseSteps(content);
          return {
            name: file,
            size: stat.size,
            lastModified: stat.mtime.toISOString(),
            stepCount: steps.length,
            steps: steps.slice(0, 5),
            isTemplate:
              content.includes("FLUJO PENDIENTE") ||
              content.includes("debe grabarse") ||
              content.includes("debe ajustarse") ||
              content.includes("AQUÍ DEBE GRABARSE"),
          };
        })
        .sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

      return NextResponse.json({ success: true, scripts: files });
    } catch (err) {
      return NextResponse.json({ success: false, error: String(err) });
    }
  }

  // ── READ ─────────────────────────────────────────────
  if (action === "read") {
    if (!name) return NextResponse.json({ success: false, error: "Nombre requerido" });
    const fp = safePath(name);
    if (!fp) return NextResponse.json({ success: false, error: "Ruta inválida" });
    try {
      const content = fs.readFileSync(fp, "utf-8");
      const steps = parseSteps(content);
      const stat = fs.statSync(fp);
      return NextResponse.json({
        success: true,
        code: content,
        steps,
        lastModified: stat.mtime.toISOString(),
        size: stat.size,
      });
    } catch (err) {
      return NextResponse.json({ success: false, error: String(err) });
    }
  }

  // ── SAVE ─────────────────────────────────────────────
  if (action === "save") {
    if (!name || !code) return NextResponse.json({ success: false, error: "Nombre y código requeridos" });
    const baseName = name
      .replace(/[^a-zA-Z0-9_\-]/g, "_")
      .replace(/\.ts$/, "")
      .slice(0, 60) + ".ts";
    const fp = path.join(SCRIPTS_DIR, baseName);
    try {
      fs.writeFileSync(fp, code, "utf-8");
      const steps = parseSteps(code);
      return NextResponse.json({ success: true, name: baseName, stepCount: steps.length });
    } catch (err) {
      return NextResponse.json({ success: false, error: String(err) });
    }
  }

  // ── DELETE ────────────────────────────────────────────
  if (action === "delete") {
    if (!name) return NextResponse.json({ success: false, error: "Nombre requerido" });
    const fp = safePath(name);
    if (!fp) return NextResponse.json({ success: false, error: "Ruta inválida" });
    try {
      fs.unlinkSync(fp);
      return NextResponse.json({ success: true });
    } catch (err) {
      return NextResponse.json({ success: false, error: String(err) });
    }
  }

  // ── PARSE (sin guardar) ───────────────────────────────
  if (action === "parse") {
    if (!code) return NextResponse.json({ success: false, error: "Código requerido" });
    return NextResponse.json({ success: true, steps: parseSteps(code) });
  }

  return NextResponse.json({ success: false, error: "Acción inválida" }, { status: 400 });
}
