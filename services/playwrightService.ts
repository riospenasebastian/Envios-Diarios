/**
 * playwrightService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Automatización Playwright ↔ EnviaTodo — completamente dinámica.
 *
 * SELECTORES CONFIRMADOS POR CODEGEN DEL USUARIO:
 * ─────────────────────────────────────────────────────────────────────────────
 * Login:
 *   email   → getByRole('textbox', { name: 'Correo electrónico' })
 *   pass    → getByRole('textbox', { name: 'Contraseña' })
 *   submit  → getByRole('button',  { name: 'Iniciar sesión' })
 *
 * Búsqueda de pedidos:
 *   buscador → getByPlaceholder('Buscar...')                         ← DINÁMICO
 *   resultado→ getByText(order.origAddress1)                         ← DINÁMICO
 *
 * Formulario de pedido (edit form):
 *   nombre   → getByRole('textbox',    { name: 'Nombre del contacto*' })
 *   calle    → getByRole('textbox',    { name: 'Calle*' })
 *   cp       → getByRole('spinbutton', { name: 'Código postal*' })
 *   referencia→ getByRole('textbox',   { name: 'Referencia*' })
 *   colonia  → getByTitle(order.sugColonia)                          ← DINÁMICO
 *   save1    → getByRole('button', { name: 'Guardar', exact: true })
 *   save2    → getByRole('button', { name: 'Guardar cambios' })
 *
 * REGLAS DE DISEÑO:
 *   - NUNCA hardcodear datos de cliente, dirección o colonia
 *   - SIEMPRE recibir datos desde el parámetro `order` de Prisma
 *   - Funciones separadas: ensureLoggedIn / navigateToOrders / searchOrder /
 *     openOrder / applyCorrections / saveChanges / validateSaved
 *   - Screenshots automáticos en cada paso en debugMode
 *   - Screenshots automáticos en TODOS los errores
 *   - bulkApplyCorrections() abre el browser UNA sola vez para todos los pedidos
 * ─────────────────────────────────────────────────────────────────────────────
 */

import path from "path";
import fs   from "fs";
import type { Page, BrowserContext, Browser } from "playwright";
import { getSettings } from "./settingsService";
import { log }         from "./loggerService";

// ─── PATHS ────────────────────────────────────────────────────────────────────
const SESSION_DIR     = path.join(process.cwd(), "playwright", "sessions");
const SESSION_FILE    = path.join(SESSION_DIR, "enviatodo_session.json");
const SCREENSHOTS_DIR = path.join(process.cwd(), "playwright", "screenshots");

// ─── TIPOS ────────────────────────────────────────────────────────────────────
export interface PlaywrightSession {
  browser: Browser;
  context: BrowserContext;
  page:    Page;
}

/** Correcciones aprobadas a aplicar en el formulario de EnviaTodo */
export interface ApplyCorrections {
  nombre?:    string;  // max 30 chars
  address1?:  string;  // max 42 chars → campo "Calle*"
  zip?:       string;  // CP → campo "Código postal*"
  colonia?:   string;  // colonia → getByTitle(colonia)
  reference?: string;  // max 25 chars → campo "Referencia*"
}

/** Datos del pedido que provienen de Prisma */
export interface BulkOrderInput {
  id:             string;
  shopifyOrderNum: string;
  customerName:   string;
  origAddress1:   string;   // usado para identificar el resultado en la búsqueda
  origAddress2?:  string | null;
  origCity:       string;
  origZip:        string;
  enviatodoId?:   string | null;
  sugAddress1?:   string | null;
  sugAddress2?:   string | null;
  sugCity?:       string | null;
  sugState?:      string | null;
  sugZip?:        string | null;
  sugColonia?:    string | null;
  sugReference?:  string | null;
}

export interface BulkApplyResult {
  orderId: string;
  success: boolean;
  message: string;
}

export type LogCallback           = (msg: string) => void;
export type OrderCompleteCallback = (result: BulkApplyResult) => Promise<void>;

// ─── DIRS ─────────────────────────────────────────────────────────────────────
function ensureDirs() {
  for (const d of [SESSION_DIR, SCREENSHOTS_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

// ─── SESSION ──────────────────────────────────────────────────────────────────
export function sessionExists(): boolean {
  return fs.existsSync(SESSION_FILE);
}

export async function resetSession(): Promise<void> {
  if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
  await log("[PLAYWRIGHT] RESET_SESSION", "Sesión eliminada", { level: "WARN" });
}

async function persistSession(context: BrowserContext): Promise<void> {
  ensureDirs();
  try {
    await context.storageState({ path: SESSION_FILE });
  } catch { /* ignorar */ }
}

// ─── SCREENSHOTS ──────────────────────────────────────────────────────────────
/**
 * Toma screenshot y devuelve la ruta.
 * En debugMode se toma en cada paso.
 * Siempre se toma en errores.
 */
async function snap(page: Page, label: string): Promise<string> {
  ensureDirs();
  const ts   = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(SCREENSHOTS_DIR, `${label}_${ts}.png`);
  try { await page.screenshot({ path: file, fullPage: true }); } catch { /* ignorar */ }
  return file;
}

// ─── OPEN / CLOSE SESSION ─────────────────────────────────────────────────────
export async function openEnviaTodoSession(headless?: boolean): Promise<PlaywrightSession> {
  ensureDirs();
  const { chromium } = await import("playwright");
  const settings     = await getSettings();
  const isHeadless   = headless ?? settings.playwrightHeadless === "true";
  const storage      = fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined;

  const browser = await chromium.launch({
    headless: isHeadless,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = await browser.newContext({
    storageState: storage,
    viewport:     { width: 1920, height: 1080 },
    locale:       "es-MX",
    userAgent:    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  return { browser, context, page };
}

export async function closeEnviaTodoSession(session: PlaywrightSession): Promise<void> {
  try { await persistSession(session.context); } catch { /* ignorar */ }
  try { await session.browser.close();         } catch { /* ignorar */ }
}

// ═════════════════════════════════════════════════════════════════════════════
// FUNCIONES SEPARADAS — cada una tiene una sola responsabilidad
// ═════════════════════════════════════════════════════════════════════════════

// ─── 1. ensureLoggedIn ────────────────────────────────────────────────────────
/**
 * Verifica si hay sesión activa. Si no, hace login con los selectores reales.
 *
 * Selectores CONFIRMADOS por codegen:
 *   email  → getByRole('textbox', { name: 'Correo electrónico' })
 *   pass   → getByRole('textbox', { name: 'Contraseña' })
 *   submit → getByRole('button', { name: 'Iniciar sesión' })
 */
export async function ensureLoggedIn(
  page:       Page,
  addLog?:    LogCallback,
  debugMode?: boolean
): Promise<boolean> {
  const settings = await getSettings();

  if (!settings.enviatodoEmail || !settings.enviatodoPassword) {
    addLog?.("❌ Credenciales no configuradas → ir a Configuración");
    return false;
  }

  addLog?.("[1/7] 🔐 Verificando sesión...");

  try {
    await page.goto(settings.enviatodoUrl, {
      waitUntil: "domcontentloaded",
      timeout:   60_000,
    });
    await page.waitForTimeout(1500);

    const url = page.url().toLowerCase();

    if (!url.includes("login") && !url.includes("sign-in")) {
      addLog?.("[1/7] ✅ Sesión activa reutilizada");
      if (debugMode) await snap(page, "01_session_active");
      return true;
    }

    addLog?.("[1/7] 🔑 Iniciando sesión...");

    // ── Selectores CONFIRMADOS ─────────────────────────────────────────────
    const emailInput = page.getByRole("textbox", { name: "Correo electrónico" });
    await emailInput.waitFor({ state: "visible", timeout: 15_000 });
    await emailInput.fill(settings.enviatodoEmail);
    await page.waitForTimeout(300);

    await page.getByRole("textbox", { name: "Contraseña" })
      .fill(settings.enviatodoPassword);
    await page.waitForTimeout(300);

    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    // Esperar que la URL deje de contener "login"
    await page.waitForFunction(
      () => !window.location.href.toLowerCase().includes("login"),
      { timeout: 20_000 }
    ).catch(() => null);

    await page.waitForTimeout(1500);

    const loggedIn = !page.url().toLowerCase().includes("login");
    if (loggedIn) {
      addLog?.("[1/7] ✅ Login exitoso");
      if (debugMode) await snap(page, "01_login_ok");
      return true;
    }

    const sc = await snap(page, "01_login_failed");
    addLog?.(`[1/7] ❌ Login falló — verifica credenciales [screenshot: ${sc}]`);
    return false;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const sc  = await snap(page, "01_login_error");
    addLog?.(`[1/7] ❌ Error login: ${msg} [screenshot: ${sc}]`);
    return false;
  }
}

// ─── 2. navigateToOrders ─────────────────────────────────────────────────────
/**
 * Navega a la sección de pedidos donde aparece el buscador.
 *
 * Detecta dónde está la app y navega correctamente sin asumir pantalla fija.
 * Condición de éxito: el buscador 'Buscar...' está visible.
 *
 * Selector CONFIRMADO por codegen: getByPlaceholder('Buscar...')
 */
export async function navigateToOrders(
  page:       Page,
  addLog?:    LogCallback,
  debugMode?: boolean
): Promise<boolean> {
  addLog?.("[2/7] 🗂️  Navegando a pedidos...");

  // Verificar si ya estamos en la sección correcta (buscador visible)
  const buscador = page.getByPlaceholder("Buscar...");
  if (await buscador.isVisible({ timeout: 2000 }).catch(() => false)) {
    addLog?.("[2/7] ✅ Ya en sección de pedidos");
    if (debugMode) await snap(page, "02_orders_ready");
    return true;
  }

  // Intentar navegar via sidebar / menú
  const navOptions = [
    page.getByRole("link",   { name: /pedidos/i    }),
    page.getByRole("link",   { name: /envíos/i     }),
    page.getByRole("link",   { name: /envios/i     }),
    page.getByRole("link",   { name: /órdenes/i    }),
    page.getByRole("link",   { name: /ordenes/i    }),
    page.getByRole("button", { name: /pedidos/i    }),
    page.locator('a[href*="pedido" i], a[href*="envio" i], a[href*="orden" i]').first(),
  ];

  for (const navEl of navOptions) {
    if (await navEl.isVisible({ timeout: 1500 }).catch(() => false)) {
      await navEl.click();
      await page.waitForTimeout(1500);

      if (await buscador.isVisible({ timeout: 3000 }).catch(() => false)) {
        addLog?.("[2/7] ✅ Sección de pedidos cargada");
        if (debugMode) await snap(page, "02_orders_nav_ok");
        return true;
      }
    }
  }

  // Último recurso: esperar que aparezca por sí solo
  addLog?.("[2/7] ⏳ Esperando buscador...");
  try {
    await buscador.waitFor({ state: "visible", timeout: 8_000 });
    addLog?.("[2/7] ✅ Buscador detectado");
    if (debugMode) await snap(page, "02_orders_wait_ok");
    return true;
  } catch {
    const sc = await snap(page, "02_orders_not_found");
    addLog?.(`[2/7] ❌ No se encontró la sección de pedidos [screenshot: ${sc}]`);
    return false;
  }
}

// ─── 3. searchOrder ───────────────────────────────────────────────────────────
/**
 * Busca el pedido por NOMBRE DEL DESTINATARIO en el buscador de EnviaTodo.
 *
 * Flujo CONFIRMADO por codegen:
 *   getByPlaceholder('Buscar...').fill('Luis Antonio Verdugo Espinoza')
 *
 * En la automatización DINÁMICA se reemplaza el nombre hardcodeado por:
 *   buscador.fill(order.customerName)   ← nombre real del pedido en Shopify
 *
 * Es el nombre que aparece en "Datos de envío" de Shopify (shipping_address.name).
 * Nunca se usa el número de orden, ID ni tracking.
 */
export async function searchOrder(
  page:       Page,
  order:      Pick<BulkOrderInput, "customerName" | "shopifyOrderNum">,
  addLog?:    LogCallback,
  debugMode?: boolean
): Promise<boolean> {
  addLog?.(`[3/7] 🔍 Buscando por nombre: "${order.customerName}"...`);

  try {
    const buscador = page.getByPlaceholder("Buscar...");
    await buscador.waitFor({ state: "visible", timeout: 8_000 });

    // Limpiar primero (por si hay una búsqueda anterior)
    await buscador.clear();
    await page.waitForTimeout(200);

    // ─── DINÁMICO: nombre del destinatario de Shopify (nunca hardcodeado) ────
    await buscador.fill(order.customerName);

    // Esperar a que los resultados carguen
    await page.waitForTimeout(1000);

    if (debugMode) await snap(page, `03_search_results_${order.shopifyOrderNum}`);
    addLog?.(`[3/7] ✅ Resultados cargados para "${order.customerName}"`);
    return true;

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const sc  = await snap(page, `03_search_error_${order.shopifyOrderNum}`);
    addLog?.(`[3/7] ❌ Error en búsqueda: ${msg} [screenshot: ${sc}]`);
    return false;
  }
}

// ─── 4. openOrder ─────────────────────────────────────────────────────────────
/**
 * Selecciona el pedido correcto de la lista de resultados y lo abre.
 *
 * Flujo CONFIRMADO por codegen (después de buscar por nombre):
 *   getByText('Privada Dr Enrique Cabrera').click()
 *   → EnviaTodo muestra la DIRECCIÓN de entrega como texto del resultado
 *   → ese texto es origAddress1 del pedido en Shopify
 *
 * Estrategias en orden de prioridad:
 *  0. Primer resultado visible (más simple — si la búsqueda es exacta, hay solo uno)
 *  1. Match por dirección completa (origAddress1) — como grabó el codegen
 *  2. Match por primeras palabras de la dirección (más tolerante)
 *  3. Match por nombre en filas/cards de la lista
 */
export async function openOrder(
  page:       Page,
  order:      Pick<BulkOrderInput, "origAddress1" | "customerName" | "shopifyOrderNum" | "origCity">,
  addLog?:    LogCallback,
  debugMode?: boolean
): Promise<boolean> {
  addLog?.(`[4/7] 📂 Abriendo resultado para "${order.customerName}"...`);

  // ── Estrategia 0: primer resultado (búsqueda exacta por nombre → 1 resultado) ──
  // Cuando se busca por nombre completo, normalmente hay un solo match.
  // Esperamos que aparezca algún elemento clickeable con la dirección del pedido.
  const resultCandidates = [
    // Filas de tabla (layout más común en EnviaTodo)
    page.locator("tbody tr").first(),
    page.locator("table tr").nth(1), // nth(1) salta el header
    // Cards / items de lista
    page.locator('[class*="order-item"], [class*="pedido-item"], [class*="shipment"]').first(),
    page.locator("ul li").first(),
  ];

  for (const candidate of resultCandidates) {
    if (await candidate.isVisible({ timeout: 1500 }).catch(() => false)) {
      // Verificar que el resultado corresponde al cliente buscado
      const text = ((await candidate.textContent().catch(() => "")) ?? "").toLowerCase();
      const nameWords = order.customerName.toLowerCase().split(/\s+/);
      const nameMatch = nameWords.filter((w) => w.length > 3).some((w) => text.includes(w));
      const addrMatch = text.includes(order.origAddress1.toLowerCase().slice(0, 10));

      if (nameMatch || addrMatch) {
        await candidate.click();
        await page.waitForTimeout(1500);
        addLog?.(`[4/7] ✅ Pedido abierto (primer resultado con match)`);
        if (debugMode) await snap(page, `04_order_first_result_${order.shopifyOrderNum}`);
        return true;
      }
    }
  }

  // ── Estrategia 1: getByText con origAddress1 — CONFIRMADO por codegen ────────
  // El codegen grabó: getByText('Privada Dr Enrique Cabrera').click()
  // → que es origAddress1 de ese pedido. Aquí lo usamos DINÁMICAMENTE.
  try {
    const el = page.getByText(order.origAddress1, { exact: false });
    if (await el.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await el.first().click();
      await page.waitForTimeout(1500);
      addLog?.(`[4/7] ✅ Pedido abierto (por dirección: "${order.origAddress1.slice(0, 30)}...")`);
      if (debugMode) await snap(page, `04_order_by_address_${order.shopifyOrderNum}`);
      return true;
    }
  } catch { /* continuar */ }

  // ── Estrategia 2: primeras palabras de la dirección ───────────────────────────
  const addressStart = order.origAddress1.split(/\s+/).slice(0, 4).join(" ");
  try {
    const el = page.getByText(addressStart, { exact: false }).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.click();
      await page.waitForTimeout(1500);
      addLog?.(`[4/7] ✅ Pedido abierto (dirección parcial: "${addressStart}")`);
      if (debugMode) await snap(page, `04_order_partial_${order.shopifyOrderNum}`);
      return true;
    }
  } catch { /* continuar */ }

  // ── Estrategia 3: cualquier fila / card que tenga el nombre ──────────────────
  for (const sel of [
    `tr:has-text("${order.customerName}")`,
    `li:has-text("${order.customerName}")`,
    `[class*="card"]:has-text("${order.customerName}")`,
    `[class*="row"]:has-text("${order.customerName}")`,
  ]) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1200 }).catch(() => false)) {
        await el.click();
        await page.waitForTimeout(1500);
        addLog?.(`[4/7] ✅ Pedido abierto (fila con nombre)`);
        if (debugMode) await snap(page, `04_order_by_name_row_${order.shopifyOrderNum}`);
        return true;
      }
    } catch { /* continuar */ }
  }

  const sc = await snap(page, `04_not_found_${order.shopifyOrderNum}`);
  addLog?.(`[4/7] ❌ No se encontró resultado para "${order.customerName}" [screenshot: ${sc}]`);
  return false;
}

// ─── 5. applyCorrections ──────────────────────────────────────────────────────
/**
 * Aplica todas las correcciones al formulario abierto.
 *
 * DINÁMICO: todos los valores vienen de `corrections`, NUNCA hardcodeados.
 * - nombre    → corrections.nombre    (max 30)
 * - address1  → corrections.address1  (max 42)
 * - zip       → corrections.zip       (antes que colonia — el CP actualiza el dropdown)
 * - colonia   → corrections.colonia   via selectColonia()
 * - reference → corrections.reference (max 25)
 */
export async function applyCorrections(
  page:        Page,
  corrections: ApplyCorrections,
  orderId:     string,
  addLog?:     LogCallback,
  debugMode?:  boolean
): Promise<{ success: boolean; message: string }> {
  addLog?.("[5/7] ✏️  Aplicando correcciones...");

  try {
    // Esperar que el formulario esté listo
    await page.waitForSelector(
      '[role="textbox"], input[name]',
      { timeout: 10_000 }
    ).catch(() => null);

    if (debugMode) await snap(page, `05_form_open_${orderId}`);

    // ── NOMBRE (max 30) ────────────────────────────────────────────────────
    if (corrections.nombre) {
      const valor = corrections.nombre.slice(0, 30);
      addLog?.(`   👤 Nombre → "${valor}"`);
      const input = page.getByRole("textbox", { name: "Nombre del contacto*" });
      await input.waitFor({ state: "visible", timeout: 5_000 });
      await input.fill(valor);
      await page.waitForTimeout(150);
    }

    // ── CALLE (max 42) ─────────────────────────────────────────────────────
    if (corrections.address1) {
      const valor = corrections.address1.slice(0, 42);
      addLog?.(`   🏠 Calle → "${valor}"`);
      const input = page.getByRole("textbox", { name: "Calle*" });
      await input.waitFor({ state: "visible", timeout: 5_000 });
      await input.fill(valor);
      await page.waitForTimeout(150);
    }

    // ── CP (ANTES que colonia — el dropdown de colonia depende del CP) ──────
    if (corrections.zip) {
      addLog?.(`   📮 CP → ${corrections.zip}`);
      const input = page.getByRole("spinbutton", { name: "Código postal*" });
      await input.waitFor({ state: "visible", timeout: 5_000 });
      // Limpiar y rellenar — triple clic para seleccionar todo primero
      await input.click({ clickCount: 3 });
      await input.fill(corrections.zip);
      // Disparar evento change/blur para que EnviaTodo recargue las colonias
      await input.press("Tab");
      // Esperar que el dropdown de colonias se actualice (mínimo 2.5s)
      addLog?.(`   ⏳ Esperando que se carguen las colonias del CP ${corrections.zip}...`);
      await page.waitForTimeout(2500);
    }

    // ── COLONIA (del dropdown dinámico) ────────────────────────────────────
    if (corrections.colonia) {
      const coloniaOk = await selectColonia(page, corrections.colonia, orderId, addLog, debugMode);
      if (!coloniaOk) {
        addLog?.(`   ⚠️ Colonia "${corrections.colonia}" no pudo seleccionarse automáticamente`);
      }
    }

    // ── REFERENCIA (max 25) ────────────────────────────────────────────────
    if (corrections.reference) {
      const valor = corrections.reference.slice(0, 25);
      addLog?.(`   📌 Referencia → "${valor}"`);
      const input = page.getByRole("textbox", { name: "Referencia*" });
      await input.waitFor({ state: "visible", timeout: 5_000 });
      await input.fill(valor);
      await page.waitForTimeout(150);
    }

    if (debugMode) await snap(page, `05_form_filled_${orderId}`);
    addLog?.("[5/7] ✅ Campos rellenados");
    return { success: true, message: "Correcciones aplicadas al formulario" };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const sc  = await snap(page, `05_form_error_${orderId}`);
    return { success: false, message: `Error en formulario: ${msg} [screenshot: ${sc}]` };
  }
}

// ─── Helpers para normalización de nombres de colonia ────────────────────────

/**
 * Quita acentos/diacríticos y puntos para comparación tolerante.
 * "Fracc. Ampliación" → "fracc ampliacion"
 */
function normColTitle(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // quitar acentos
    .replace(/\./g, "")                // quitar puntos
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Genera todas las variantes a probar al buscar la colonia en el DOM:
 * original, sin acentos, sin puntos, mayúsculas, primeras palabras, etc.
 */
function buildColoniaVariants(colonia: string): string[] {
  const variants = new Set<string>([colonia]);
  const noAcc   = colonia.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const noPer   = colonia.replace(/\./g, "");
  const noAccPer = noAcc.replace(/\./g, "");
  variants.add(noAcc);
  variants.add(noPer);
  variants.add(noAccPer);
  variants.add(colonia.toUpperCase());
  variants.add(noAcc.toUpperCase());
  variants.add(noAccPer.toUpperCase());
  // Primeras 3 palabras (útil para nombres largos)
  const words = noAccPer.split(/\s+/);
  if (words.length > 2) {
    variants.add(words.slice(0, 3).join(" "));
    variants.add(words.slice(0, 3).join(" ").toUpperCase());
  }
  return [...variants].filter((v) => v.length >= 3);
}

/**
 * Intenta abrir el dropdown de colonia haciendo clic en su trigger.
 * EnviaTodo puede usar: ng-select, mat-select, select nativo, o un input con panel.
 * Se prueba en orden de probabilidad — el primer que responda gana.
 */
async function openColoniaDropdown(
  page:    Page,
  addLog?: LogCallback
): Promise<boolean> {
  // Selectores probables del trigger (en orden de especificidad)
  const triggerSelectors = [
    // ng-select (Angular) — el más común en SPAs mexicanas de logística
    ".ng-select-container",
    "ng-select",
    // Angular Material select
    "mat-select",
    ".mat-select-trigger",
    // role combobox (accesibilidad)
    '[role="combobox"]',
    '[aria-haspopup="listbox"]',
    '[aria-haspopup="true"]',
    // Input de filtro dentro de un dropdown
    'input[placeholder*="Selecciona" i]',
    'input[placeholder*="colonia" i]',
    'input[placeholder*="asentamiento" i]',
    // Select nativo (último recurso — puede activar UI del OS en vez del custom)
    "select",
  ];

  for (const sel of triggerSelectors) {
    try {
      // Tomar el ÚLTIMO elemento con ese selector (la colonia suele estar al final del form)
      const el = page.locator(sel).last();
      if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
        await el.click({ force: false }).catch(() => null);
        await page.waitForTimeout(500);
        addLog?.(`   🔓 Dropdown colonia abierto (${sel})`);
        return true;
      }
    } catch { /* continuar */ }
  }

  // Fallback: Tab desde el campo CP para mover el foco al campo colonia
  try {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(400);
    addLog?.(`   🔓 Foco movido a campo colonia (Tab)`);
    return true;
  } catch { /* continuar */ }

  return false;
}

// ─── selectColonia (helper interno) ──────────────────────────────────────────
/**
 * Selecciona la colonia del dropdown dinámicamente.
 *
 * FLUJO:
 *  1. Abre el dropdown (click en trigger)
 *  2. Espera a que las opciones se carguen en el DOM
 *  3. Prueba múltiples variantes del nombre (original, sin acentos, sin puntos, mayúsculas)
 *  4. Fallback: escribe en campo de filtro
 *  5. Fallback: select nativo con comparación normalizada
 *
 * TOLERANCIAS:
 *  - Acentos: "Ampliación" ≡ "Ampliacion"
 *  - Puntos:  "Fracc."     ≡ "Fracc"
 *  - Mayúsculas: "INFONAVIT" ≡ "infonavit"
 *  - Prefijos: si el nombre es largo, prueba con las primeras N palabras
 */
async function selectColonia(
  page:       Page,
  colonia:    string,
  orderId:    string,
  addLog?:    LogCallback,
  debugMode?: boolean
): Promise<boolean> {
  addLog?.(`   🏘️ Seleccionando colonia "${colonia}"...`);
  if (debugMode) await snap(page, `colonia_before_${orderId}`);

  // ── FASE 1: Abrir el dropdown ──────────────────────────────────────────────
  await openColoniaDropdown(page, addLog);

  // ── FASE 2: Esperar a que aparezcan opciones con [title] en el DOM ─────────
  // Algunos dropdowns cargan sus opciones via XHR — esperamos hasta 4s
  const hasOptions = await page.waitForSelector('[title]', { timeout: 4_000 })
    .then(() => true)
    .catch(() => false);

  if (!hasOptions) {
    addLog?.(`   ⚠️ No se detectaron opciones [title] en el DOM — reintentando apertura`);
    // Segundo intento de apertura antes de rendirse
    await openColoniaDropdown(page, addLog);
    await page.waitForTimeout(1_500);
  }

  if (debugMode) await snap(page, `colonia_dropdown_open_${orderId}`);

  const variants = buildColoniaVariants(colonia);
  const normColonia = normColTitle(colonia);

  // ── FASE 3: Probar cada variante del nombre ────────────────────────────────
  for (const v of variants) {
    // 3a. getByTitle exacto
    try {
      const item = page.getByTitle(v, { exact: true });
      if (await item.first().isVisible({ timeout: 800 }).catch(() => false)) {
        await item.first().click();
        await page.waitForTimeout(400);
        addLog?.(`   ✅ Colonia seleccionada (title exacto: "${v}")`);
        return true;
      }
    } catch { /* continuar */ }

    // 3b. [title="v"] CSS locator
    try {
      const item = page.locator(`[title="${v}"]`).first();
      if (await item.isVisible({ timeout: 600 }).catch(() => false)) {
        await item.click();
        await page.waitForTimeout(400);
        addLog?.(`   ✅ Colonia seleccionada (CSS title="${v}")`);
        return true;
      }
    } catch { /* continuar */ }
  }

  // ── FASE 4: Comparación normalizada sobre TODOS los elementos [title] ──────
  // Para manejar acentos: obtenemos todos los [title] y comparamos con normColTitle()
  try {
    const allTitledEls = await page.locator("[title]").all();
    for (const el of allTitledEls) {
      const titleAttr = (await el.getAttribute("title").catch(() => "")) ?? "";
      if (!titleAttr) continue;
      const normTitle = normColTitle(titleAttr);
      if (
        normTitle === normColonia ||
        normTitle.includes(normColonia.slice(0, Math.min(normColonia.length, 18))) ||
        normColonia.includes(normTitle.slice(0, Math.min(normTitle.length, 18)))
      ) {
        if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
          await el.click();
          await page.waitForTimeout(400);
          addLog?.(`   ✅ Colonia seleccionada (normalizada: "${titleAttr}")`);
          return true;
        }
      }
    }
  } catch { /* continuar */ }

  // ── FASE 5: Escribir en campo de filtro ───────────────────────────────────
  const filterInputSelectors = [
    'input[placeholder*="colonia" i]',
    'input[placeholder*="asentamiento" i]',
    'input[placeholder*="fraccionamiento" i]',
    'input[placeholder*="Selecciona" i]',
    '.ng-input input',             // ng-select inner input
    '.mat-select-search-input',   // mat-select search
  ];
  for (const sel of filterInputSelectors) {
    const filterInput = page.locator(sel).first();
    if (await filterInput.isVisible({ timeout: 800 }).catch(() => false)) {
      // Escribir la primera palabra significativa (≥4 chars)
      const keyword = colonia.split(/\s+/).find((w) => w.length >= 4) ?? colonia.slice(0, 6);
      await filterInput.fill(keyword);
      await page.waitForTimeout(800);

      // Volver a intentar con los [title] disponibles tras filtrar
      const normKw = normColTitle(keyword);
      const filtered = await page.locator("[title]").all();
      for (const el of filtered) {
        const t = (await el.getAttribute("title").catch(() => "")) ?? "";
        if (normColTitle(t).includes(normKw) || normKw.includes(normColTitle(t).slice(0, 6))) {
          if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
            await el.click();
            await page.waitForTimeout(400);
            addLog?.(`   ✅ Colonia seleccionada (filtro → "${t}")`);
            return true;
          }
        }
      }
    }
  }

  // ── FASE 6: Select nativo — comparación normalizada ────────────────────────
  try {
    const selects = await page.locator("select").all();
    for (const selectEl of selects) {
      if (!(await selectEl.isVisible({ timeout: 500 }).catch(() => false))) continue;
      const options = await selectEl.locator("option").allTextContents();
      const match = options.find((o) => {
        const normO = normColTitle(o);
        return (
          normO === normColonia ||
          normO.includes(normColonia.slice(0, Math.min(normColonia.length, 15))) ||
          normColonia.includes(normO.slice(0, Math.min(normO.length, 15)))
        );
      });
      if (match) {
        await selectEl.selectOption({ label: match }).catch(() => null);
        await page.waitForTimeout(400);
        addLog?.(`   ✅ Colonia seleccionada (select nativo: "${match}")`);
        return true;
      }
    }
  } catch { /* continuar */ }

  const sc = await snap(page, `colonia_not_found_${orderId}`);
  addLog?.(`   ⚠️ Colonia "${colonia}" no encontrada — se continúa sin ella [screenshot: ${sc}]`);
  return false;
}

// ─── 6. saveChanges ───────────────────────────────────────────────────────────
/**
 * Guarda los cambios del formulario.
 *
 * Selectores CONFIRMADOS:
 *   Guardar        → getByRole('button', { name: 'Guardar', exact: true })
 *   Guardar cambios → getByRole('button', { name: 'Guardar cambios' })
 */
export async function saveChanges(
  page:       Page,
  orderId:    string,
  addLog?:    LogCallback,
  debugMode?: boolean
): Promise<{ success: boolean; message: string }> {
  addLog?.("[6/7] 💾 Guardando...");

  try {
    // Click "Guardar" (botón principal — exacto para evitar matches con "Guardar cambios")
    let savedPrimary = false;
    try {
      const btn = page.getByRole("button", { name: "Guardar", exact: true });
      await btn.waitFor({ state: "visible", timeout: 8_000 });
      await btn.click();
      await page.waitForTimeout(800);
      savedPrimary = true;
    } catch {
      // Fallback: cualquier botón que diga "Guardar" (sin exact)
      const btn = page.locator('button:has-text("Guardar")').first();
      if (await btn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await btn.click();
        await page.waitForTimeout(800);
        savedPrimary = true;
      }
    }

    if (!savedPrimary) {
      const sc = await snap(page, `06_save_btn_missing_${orderId}`);
      return { success: false, message: `Botón Guardar no encontrado [screenshot: ${sc}]` };
    }

    // Diálogo de confirmación "Guardar cambios" (si aparece)
    try {
      const confirmBtn = page.getByRole("button", { name: "Guardar cambios" });
      if (await confirmBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await confirmBtn.click();
        await page.waitForTimeout(1200);
        addLog?.("[6/7] ✅ Confirmación aceptada");
      }
    } catch { /* sin diálogo de confirmación — OK */ }

    if (debugMode) await snap(page, `06_saved_${orderId}`);
    addLog?.("[6/7] ✅ Guardado");
    return { success: true, message: "Guardado correctamente" };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const sc  = await snap(page, `06_save_error_${orderId}`);
    return { success: false, message: `Error al guardar: ${msg} [screenshot: ${sc}]` };
  }
}

// ─── 7. validateSaved ─────────────────────────────────────────────────────────
/**
 * Verifica que el guardado fue exitoso (no hay mensajes de error visibles).
 */
export async function validateSaved(
  page:       Page,
  orderId:    string,
  addLog?:    LogCallback,
  debugMode?: boolean
): Promise<{ success: boolean; message: string }> {
  addLog?.("[7/7] ✔️  Validando guardado...");

  await page.waitForTimeout(500);

  // Detectar errores visibles en la UI
  const errorSelectors = [
    '.error',
    '.alert-danger',
    '.alert-error',
    '[class*="error-msg"]',
    '[class*="has-error"]',
    '[class*="is-invalid"]',
  ];

  for (const sel of errorSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
        const text = ((await el.textContent().catch(() => "")) ?? "").trim();
        const sc   = await snap(page, `07_validation_error_${orderId}`);
        addLog?.(`[7/7] ❌ Error visible: "${text}" [screenshot: ${sc}]`);
        return { success: false, message: `Error al guardar: ${text}` };
      }
    } catch { /* continuar */ }
  }

  // Detectar mensaje de éxito (opcional)
  const successSelectors = [
    '.alert-success',
    '.success',
    '[class*="success"]',
    'text=guardado',
    'text=exitoso',
  ];
  let successMsg = "";
  for (const sel of successSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 800 }).catch(() => false)) {
        successMsg = ((await el.textContent().catch(() => "")) ?? "").trim();
        break;
      }
    } catch { /* continuar */ }
  }

  if (debugMode) await snap(page, `07_validated_${orderId}`);
  addLog?.(`[7/7] ✅ Guardado validado${successMsg ? ` — "${successMsg}"` : ""}`);
  return { success: true, message: "Correcciones guardadas en EnviaTodo" };
}

// ═════════════════════════════════════════════════════════════════════════════
// FLUJO COMPLETO POR PEDIDO
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Aplica correcciones a UN pedido usando una página ya abierta y logueada.
 * Para bulk: llamar desde bulkApplyCorrections() sin reabrir el browser.
 */
async function applyOneOrder(
  page:       Page,
  order:      BulkOrderInput,
  debugMode?: boolean,
  addLog?:    LogCallback
): Promise<BulkApplyResult> {
  /**
   * Solo se envían al formulario los campos que realmente cambian.
   * Si sugAddress1 es null → no se toca la Calle (ya está bien).
   * Si sugZip es null      → no se toca el CP (ya está bien).
   * etc.
   *
   * El nombre (customerName) siempre se envía para asegurar que
   * EnviaTodo tenga el nombre exacto de Shopify (máx 30 chars).
   */
  const corrections: ApplyCorrections = {
    // Nombre: siempre del campo de envío de Shopify (truncado a 30 si excede)
    nombre: order.customerName,

    // Dirección: solo si hay corrección sugerida
    address1:  order.sugAddress1  ?? undefined,

    // CP: solo si cambió
    zip: order.sugZip && order.sugZip !== order.origZip
      ? order.sugZip
      : undefined,

    // Colonia: solo si hay corrección sugerida
    colonia: order.sugColonia ?? undefined,

    // Referencia: solo si hay corrección sugerida
    reference: order.sugReference ?? undefined,
  };

  // Paso 2: navegar a pedidos (puede que ya estemos ahí)
  const onOrders = await navigateToOrders(page, addLog, debugMode);
  if (!onOrders) {
    return { orderId: order.id, success: false, message: "No se pudo navegar a la sección de pedidos" };
  }

  // Paso 3: buscar el pedido por nombre de cliente (DINÁMICO)
  const searched = await searchOrder(page, order, addLog, debugMode);
  if (!searched) {
    return { orderId: order.id, success: false, message: "Error en búsqueda de pedido" };
  }

  // Paso 4: abrir el pedido por dirección (DINÁMICO)
  const opened = await openOrder(page, order, addLog, debugMode);
  if (!opened) {
    return {
      orderId: order.id,
      success: false,
      message: `Pedido #${order.shopifyOrderNum} no encontrado en EnviaTodo`,
    };
  }

  // Paso 5: rellenar formulario con datos DINÁMICOS
  const filled = await applyCorrections(page, corrections, order.id, addLog, debugMode);
  if (!filled.success) {
    return { orderId: order.id, success: false, message: filled.message };
  }

  // Paso 6: guardar
  const saved = await saveChanges(page, order.id, addLog, debugMode);
  if (!saved.success) {
    return { orderId: order.id, success: false, message: saved.message };
  }

  // Paso 7: validar
  const validated = await validateSaved(page, order.id, addLog, debugMode);
  return { orderId: order.id, success: validated.success, message: validated.message };
}

// ═════════════════════════════════════════════════════════════════════════════
// PUNTO DE ENTRADA PRINCIPAL — applyCorrectionsToEnviaTodo (pedido único)
// ═════════════════════════════════════════════════════════════════════════════

export async function applyCorrectionsToEnviaTodo(
  orderId:     string,
  corrections: ApplyCorrections & {
    shopifyOrderNum?: string;
    customerName?:    string;
    origAddress1?:    string;
    origCity?:        string;
    origZip?:         string;
  },
  debugMode = false
): Promise<{ success: boolean; message: string }> {
  const logs: string[] = [];
  const addLog: LogCallback = (msg) => logs.push(msg);

  await log("[PLAYWRIGHT] APPLY_START", `Corrección pedido ${orderId}`, { level: "INFO", orderId });

  const session = await openEnviaTodoSession(false);

  try {
    // Paso 1
    const loggedIn = await ensureLoggedIn(session.page, addLog, debugMode);
    if (!loggedIn) {
      await closeEnviaTodoSession(session);
      return { success: false, message: "No se pudo iniciar sesión" };
    }

    const orderInput: BulkOrderInput = {
      id:             orderId,
      shopifyOrderNum: corrections.shopifyOrderNum ?? orderId,
      customerName:   corrections.customerName    ?? "",
      origAddress1:   corrections.origAddress1    ?? "",
      origCity:       corrections.origCity        ?? "",
      origZip:        corrections.origZip         ?? "",
      sugAddress1:    corrections.address1        ?? null,
      sugZip:         corrections.zip             ?? null,
      sugColonia:     corrections.colonia         ?? null,
      sugReference:   corrections.reference       ?? null,
    };

    const result = await applyOneOrder(session.page, orderInput, debugMode, addLog);

    if (debugMode && !result.success) {
      // En debug mode: no cerrar inmediatamente, esperar un poco para poder ver
      addLog?.("🐛 Debug mode: esperando 5s antes de cerrar...");
      await session.page.waitForTimeout(5_000);
    }

    await closeEnviaTodoSession(session);

    const logMsg = logs.join("\n");
    if (result.success) {
      await log("[PLAYWRIGHT] APPLY_SUCCESS", `Pedido ${orderId} aplicado\n${logMsg}`, { level: "SUCCESS", orderId });
    } else {
      await log("[PLAYWRIGHT] APPLY_FAIL", `Pedido ${orderId}: ${result.message}\n${logMsg}`, { level: "ERROR", orderId });
    }

    return { success: result.success, message: result.message };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const sc  = await snap(session.page, `apply_fatal_${orderId}`).catch(() => "");
    await closeEnviaTodoSession(session);
    await log("[PLAYWRIGHT] APPLY_ERROR", `${msg}\n${logs.join("\n")}`, { level: "ERROR", orderId });
    return { success: false, message: `Error inesperado: ${msg}${sc ? ` [screenshot: ${sc}]` : ""}` };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// BULK APPLY — browser NUEVO por pedido (aislamiento completo)
//
// Por qué browser por pedido en lugar de compartido:
//   - Si EnviaTodo se queda colgado en un pedido, se cierra ese Chromium
//     y el siguiente abre uno limpio. No hay estado sucio entre órdenes.
//   - El archivo de sesión en disco (SESSION_FILE) persiste entre instancias,
//     por lo que el login solo ocurre la primera vez (o si expira la sesión).
//   - Si la sesión expiró, se re-login automáticamente con ensureLoggedIn().
// ═════════════════════════════════════════════════════════════════════════════

export async function bulkApplyCorrections(
  orders:            BulkOrderInput[],
  onLog?:            LogCallback,
  onOrderComplete?:  OrderCompleteCallback,
  debugMode         = false,
  headless?:         boolean   // undefined → leer de settings; true/false → forzar
): Promise<BulkApplyResult[]> {
  if (orders.length === 0) return [];

  const results: BulkApplyResult[] = [];
  await log("[PLAYWRIGHT] BULK_START", `Bulk: ${orders.length} pedidos (browser por pedido)`, { level: "INFO" });

  for (const order of orders) {
    onLog?.(`\n📦 #${order.shopifyOrderNum} · ${order.customerName}`);
    onLog?.(`   🌐 Abriendo navegador${headless === false ? " (visible)" : " (segundo plano)"}...`);

    // Abrir browser FRESCO para este pedido — usa sesión guardada si existe
    const session = await openEnviaTodoSession(headless);
    let result: BulkApplyResult;

    try {
      // Login (reutiliza sesión del archivo si aún es válida)
      const loggedIn = await ensureLoggedIn(session.page, onLog, debugMode);
      if (!loggedIn) {
        await closeEnviaTodoSession(session);
        result = {
          orderId: order.id,
          success: false,
          message: "No se pudo iniciar sesión en EnviaTodo",
        };
      } else {
        result = await applyOneOrder(session.page, order, debugMode, onLog);

        if (debugMode && !result.success) {
          onLog?.(`   🐛 Debug: esperando 5s antes de cerrar...`);
          await session.page.waitForTimeout(5_000);
        }

        // Guardar sesión actualizada al cerrar (para siguiente pedido)
        await closeEnviaTodoSession(session);
      }

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const sc  = await snap(session.page, `bulk_exc_${order.shopifyOrderNum}`).catch(() => "");
      // Cerrar aunque haya error — esto evita browsers huérfanos
      await closeEnviaTodoSession(session).catch(() => null);
      result = {
        orderId: order.id,
        success: false,
        message: `Excepción: ${msg}${sc ? ` [screenshot: ${sc}]` : ""}`,
      };
      onLog?.(`   ❌ ${result.message}`);
    }

    results.push(result);

    // Actualizar DB en tiempo real
    if (onOrderComplete) {
      await onOrderComplete(result).catch((e) => {
        onLog?.(`   ⚠️ Error DB: ${e instanceof Error ? e.message : String(e)}`);
      });
    }

    onLog?.(result.success ? `   ✅ OK` : `   ❌ Error: ${result.message}`);
  }

  const ok  = results.filter((r) =>  r.success).length;
  const err = results.filter((r) => !r.success).length;
  onLog?.(`\n📊 Resumen: ✅ ${ok} exitosos  ❌ ${err} errores  📦 ${results.length} total`);

  await log(
    "[PLAYWRIGHT] BULK_DONE",
    `Bulk: ${ok}/${orders.length} exitosos, ${err} errores`,
    { level: err === 0 ? "SUCCESS" : "WARN" }
  );

  return results;
}

// ═════════════════════════════════════════════════════════════════════════════
// SYNC TIENDA (botón manual "Sincronizar Shopify → EnviaTodo")
// ═════════════════════════════════════════════════════════════════════════════

export async function syncEnviaTodoStore(addLog?: LogCallback): Promise<{ success: boolean; message: string }> {
  addLog?.("🔄 Iniciando sincronización manual...");
  const session = await openEnviaTodoSession(false);

  try {
    const loggedIn = await ensureLoggedIn(session.page, addLog);
    if (!loggedIn) throw new Error("No se pudo iniciar sesión");

    // Navegar a Tiendas (selector CONFIRMADO por codegen)
    addLog?.("🏪 Navegando a Tiendas...");
    const tiendasLink = session.page.getByRole("link", { name: /tiendas/i });
    await tiendasLink.waitFor({ state: "visible", timeout: 10_000 });
    await tiendasLink.click();
    await session.page.waitForTimeout(2000);

    // Clic en la tienda (el codegen grabó clic en "Calle 20 de noviembre")
    addLog?.("🏬 Seleccionando tienda...");
    const storeRow = session.page.getByText(/Calle 20 de noviembre/i).first();

    if (await storeRow.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await storeRow.click();
    } else {
      // Fallback: primera fila de tienda
      await session.page
        .locator('[class*="store"], [class*="tienda"], table tr:nth-child(2)')
        .first()
        .click()
        .catch(() => null);
    }
    await session.page.waitForTimeout(1500);

    // Clic en Sincronizar
    addLog?.("⚡ Sincronizando...");
    const syncBtn = session.page.getByRole("button", { name: /sincronizar/i });
    await syncBtn.waitFor({ state: "visible", timeout: 8_000 });
    await syncBtn.click();

    addLog?.("⏳ Esperando resultado...");
    await session.page.waitForTimeout(8_000);

    const hasError = await session.page
      .locator(".error, .alert-danger")
      .isVisible()
      .catch(() => false);

    await closeEnviaTodoSession(session);

    if (!hasError) {
      addLog?.("✅ Sincronización completada");
      await log("[PLAYWRIGHT] SYNC_DONE", "Sync completada", { level: "SUCCESS" });
      return { success: true, message: "Sincronización completada" };
    }
    return { success: false, message: "Sincronización con errores — revisa EnviaTodo" };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await snap(session.page, "sync_error").catch(() => "");
    await closeEnviaTodoSession(session);
    await log("[PLAYWRIGHT] SYNC_ERROR", msg, { level: "ERROR" });
    return { success: false, message: `Error de sync: ${msg}` };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// COMPAT — funciones legacy que el resto del código usa sin cambios
// ═════════════════════════════════════════════════════════════════════════════
export async function launchBrowser(headless?: boolean) {
  const s = await openEnviaTodoSession(headless);
  return { browser: s.browser, context: s.context };
}

export async function saveSession(context: BrowserContext) {
  await persistSession(context);
  await log("[PLAYWRIGHT] SAVE_SESSION", "Sesión guardada", { level: "SUCCESS" });
}

/** @deprecated usar syncEnviaTodoStore() */
export async function syncEnviaTodo(): Promise<{ success: boolean; message: string }> {
  return syncEnviaTodoStore();
}

export async function loginEnviaTodo(): Promise<{ success: boolean; message: string }> {
  const session = await openEnviaTodoSession(false);
  try {
    const page: Page = session.page;
    const ok = await ensureLoggedIn(page);
    await closeEnviaTodoSession(session);
    return { success: ok, message: ok ? "Login exitoso — sesión guardada" : "Login falló" };
  } catch (err) {
    await closeEnviaTodoSession(session);
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: msg };
  }
}
