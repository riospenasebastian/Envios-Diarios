/**
 * playwrightService.ts
 * Automatización Playwright ↔ EnviaTodo — versión limpia y estable.
 *
 * Reglas principales:
 * - Arranca con sesión/cache si existe, y si no hace login.
 * - Navega directo a #ShopOrder, sin abrir/cerrar menús repetidamente.
 * - Busca por nombre solo para filtrar, pero abre únicamente por DESTINO/origAddress1.
 * - Nunca toca ORIGEN ni abre por nombre/primera fila.
 * - Valida el nombre del popup antes de tocar campos.
 * - Solo recorta el nombre a 30 caracteres si el popup corresponde al mismo cliente.
 * - Al seleccionar colonia: abre dropdown, escribe colonia y hace clic real en opción exacta.
 * - No escribe Municipio/Ciudad manualmente.
 * - No toma screenshots.
 */

import path from "path";
import fs from "fs";
import type { Page, BrowserContext, Browser, Locator } from "playwright";
import { getSettings } from "./settingsService";
import { log } from "./loggerService";

// ─── PATHS ────────────────────────────────────────────────────────────────────
const SESSION_DIR = path.join(process.cwd(), "playwright", "sessions");
const SESSION_FILE = path.join(SESSION_DIR, "enviatodo_session.json");
const SCREENSHOTS_DIR = path.join(process.cwd(), "playwright", "screenshots");
const SERVICE_FILE = path.join(process.cwd(), "services", "playwrightService.ts");

function activeFlowPath(): string {
  return process.env.PLAYWRIGHT_ACTIVE_FLOW_PATH ?? SERVICE_FILE;
}

const ROOT_URL = "https://app.enviatodo.com/#";
const LOGIN_URL = "https://app.enviatodo.com/#Login";
const SHOP_ORDER_URL = "https://app.enviatodo.com/#ShopOrder";

// ─── TIPOS ────────────────────────────────────────────────────────────────────
export interface PlaywrightSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export interface ApplyCorrections {
  nombre?: string;
  address1?: string;
  zip?: string;
  colonia?: string;
  reference?: string;
}

export interface BulkOrderInput {
  id: string;
  shopifyOrderNum: string;
  customerName: string;
  origAddress1: string;
  origAddress2?: string | null;
  origCity: string;
  origZip: string;
  enviatodoId?: string | null;
  sugAddress1?: string | null;
  sugAddress2?: string | null;
  sugCity?: string | null;
  sugState?: string | null;
  sugZip?: string | null;
  sugColonia?: string | null;
  sugReference?: string | null;
}

export interface BulkApplyResult {
  orderId: string;
  success: boolean;
  message: string;
  shopifyOrderNum?: string;
  customerName?: string;
  coloniaWarning?: string;
}

export type LogCallback = (msg: string) => void;
export type OrderCompleteCallback = (result: BulkApplyResult) => Promise<void>;

// ─── DIRS / SESSION ───────────────────────────────────────────────────────────
function ensureDirs() {
  for (const d of [SESSION_DIR, SCREENSHOTS_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

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
  } catch {
    // Ignorar errores al guardar sesión.
  }
}

// Screenshots deshabilitados por rendimiento.
async function snap(_page: Page, label: string): Promise<string> {
  return `[screenshots deshabilitados: ${label}]`;
}

// ─── OPEN / CLOSE SESSION ─────────────────────────────────────────────────────
export async function openEnviaTodoSession(headless?: boolean): Promise<PlaywrightSession> {
  ensureDirs();
  const { chromium } = await import("playwright");
  const settings = await getSettings();
  const isHeadless = headless ?? settings.playwrightHeadless === "true";
  const storage = fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined;

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
    viewport: { width: 1920, height: 1080 },
    locale: "es-MX",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  return { browser, context, page };
}

export async function closeEnviaTodoSession(session: PlaywrightSession): Promise<void> {
  try {
    await persistSession(session.context);
  } catch {
    // Ignorar.
  }
  try {
    await session.browser.close();
  } catch {
    // Ignorar.
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// HELPERS GENERALES
// ═════════════════════════════════════════════════════════════════════════════
function norm(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function waitForBlockingOverlaysGone(
  page: Page,
  addLog?: LogCallback,
  timeout = 20_000
): Promise<void> {
  const start = Date.now();
  let logged = false;

  while (Date.now() - start < timeout) {
    const visible = await page
      .locator(
        "#modalLoading.show, #modalLoading[aria-modal='true'], .modalLoading.show, .et-loader-modal-content, .swal2-container.swal2-shown"
      )
      .first()
      .isVisible({ timeout: 250 })
      .catch(() => false);

    if (!visible) return;

    if (!logged) {
      addLog?.("[WAIT] Esperando que desaparezcan loaders/modales de EnviaTodo...");
      logged = true;
    }

    // Si es SweetAlert con botón visible, cerrarla.
    const swalConfirm = page.locator(".swal2-confirm").first();
    if (await swalConfirm.isVisible({ timeout: 200 }).catch(() => false)) {
      await swalConfirm.click().catch(() => {});
    }

    await page.waitForTimeout(300);
  }
}

async function isLoginFormVisible(page: Page, timeout = 2_000): Promise<boolean> {
  return (
    (await page.getByRole("textbox", { name: "Correo electrónico" }).isVisible({ timeout }).catch(() => false)) ||
    (await page.getByRole("textbox", { name: "Contraseña" }).isVisible({ timeout }).catch(() => false)) ||
    (await page.getByRole("button", { name: "Iniciar sesión" }).isVisible({ timeout }).catch(() => false))
  );
}

async function isAppVisible(page: Page, timeout = 3_000): Promise<boolean> {
  return await page
    .getByText(/Dashboard|Órdenes|Ordenes|Cotizador|Crear orden|Sincronizar órdenes|Configurar Órdenes/i)
    .isVisible({ timeout })
    .catch(() => false);
}

async function isShopOrderReady(page: Page, timeout = 10_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ready =
      (await page.getByText(/Sincronizar órdenes/i).isVisible({ timeout: 500 }).catch(() => false)) ||
      (await page.getByText(/Configurar Órdenes/i).isVisible({ timeout: 500 }).catch(() => false)) ||
      (await page.locator('input[type="search"][aria-controls="settings_table"]').first().isVisible({ timeout: 500 }).catch(() => false)) ||
      (await page.locator("#stores_save_changes_button").isVisible({ timeout: 500 }).catch(() => false));

    if (ready) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function waitForAnyMount(page: Page, addLog?: LogCallback, label = "montaje", timeout = 18_000): Promise<"app" | "login" | "shop" | "none"> {
  addLog?.(`[1/7] ⏳ Esperando ${label}...`);
  const start = Date.now();

  while (Date.now() - start < timeout) {
    await waitForBlockingOverlaysGone(page, addLog, 1_500).catch(() => {});

    if (await isShopOrderReady(page, 500)) return "shop";
    if (await isAppVisible(page, 500)) return "app";
    if (await isLoginFormVisible(page, 500)) return "login";

    await page.waitForTimeout(500);
  }

  return "none";
}

async function getLoginErrorText(page: Page): Promise<string> {
  const selectors = [
    ".alert-danger",
    ".alert-error",
    ".error",
    "[class*='error']",
    "[class*='danger']",
    ".invalid-feedback",
    ".swal2-container",
  ];

  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
      const text = ((await el.textContent().catch(() => "")) ?? "").trim();
      if (text) return text.replace(/\s+/g, " ");
    }
  }
  return "";
}

async function isAddressModalOpen(page: Page): Promise<boolean> {
  return await page
    .getByText(/Información de la dirección/i)
    .isVisible({ timeout: 800 })
    .catch(() => false);
}

async function ensureAddressModalOpen(page: Page, addLog?: LogCallback, label = "formulario"): Promise<boolean> {
  const open = await isAddressModalOpen(page);
  if (!open) addLog?.(`[SAFE] ❌ El popup de dirección se cerró o no está activo: ${label}`);
  return open;
}

async function safeFillInsideAddressModal(
  page: Page,
  locator: Locator,
  value: string,
  label: string,
  addLog?: LogCallback
): Promise<boolean> {
  if (!(await ensureAddressModalOpen(page, addLog, label))) return false;

  await locator.waitFor({ state: "visible", timeout: 8_000 });
  const currentValue = await locator.inputValue().catch(() => "");

  if ((currentValue ?? "").trim() === value.trim()) {
    addLog?.(`   ↪️ ${label} ya estaba igual, no se rellena`);
    return true;
  }

  await locator.click({ clickCount: 3 });
  await page.waitForTimeout(120);

  if (!(await ensureAddressModalOpen(page, addLog, label))) return false;

  await locator.fill(value);
  await page.waitForTimeout(150);

  return await ensureAddressModalOpen(page, addLog, label);
}


function normalizePersonName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-ZñÑ0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function validateAndTruncateNameOnlyIfSameCustomer(
  page: Page,
  expectedName: string | undefined,
  addLog?: LogCallback
): Promise<{ success: boolean; message: string }> {
  const expectedFull = (expectedName ?? "").trim();

  if (!expectedFull) {
    return { success: false, message: "SEGURIDAD: No hay nombre esperado para validar el popup" };
  }

  if (!(await ensureAddressModalOpen(page, addLog, "validar nombre"))) {
    return { success: false, message: "El popup se cerró antes de validar el nombre" };
  }

  const input = page.getByRole("textbox", { name: "Nombre del contacto*" });
  await input.waitFor({ state: "visible", timeout: 8_000 });

  const currentName = ((await input.inputValue().catch(() => "")) ?? "").trim();

  if (!currentName) {
    return {
      success: false,
      message: `SEGURIDAD: El campo Nombre del contacto está vacío. Esperado="${expectedFull}". No se modifica nada.`,
    };
  }

  const expected30 = expectedFull.slice(0, 30).trim();
  const currentNorm = normalizePersonName(currentName);
  const expectedNorm = normalizePersonName(expectedFull);
  const expected30Norm = normalizePersonName(expected30);

  const sameFullName = currentNorm === expectedNorm;
  const sameTruncatedName = currentNorm === expected30Norm;
  const currentIsSafePrefix =
    currentName.length <= 30 &&
    currentNorm.length >= Math.min(10, expectedNorm.length) &&
    expectedNorm.startsWith(currentNorm);

  if (!sameFullName && !sameTruncatedName && !currentIsSafePrefix) {
    return {
      success: false,
      message:
        `SEGURIDAD: El nombre del popup no coincide con el pedido esperado. ` +
        `Esperado="${expectedFull}" / En popup="${currentName}". No se modifica nada.`,
    };
  }

  if (expectedFull.length <= 30) {
    addLog?.(`   🔒 Nombre validado y no requiere recorte: "${currentName}"`);
    return { success: true, message: "Nombre validado" };
  }

  if (sameTruncatedName) {
    addLog?.(`   🔒 Nombre ya está recortado correctamente: "${currentName}"`);
    return { success: true, message: "Nombre ya recortado" };
  }

  addLog?.(`   ✂️ Recortando nombre validado a 30 caracteres: "${expected30}"`);

  const ok = await safeFillInsideAddressModal(
    page,
    input,
    expected30,
    "Nombre del contacto",
    addLog
  );

  if (!ok) {
    return { success: false, message: "El popup se cerró al recortar el nombre" };
  }

  return { success: true, message: "Nombre recortado de forma segura" };
}

function destinationMatchesExpected(destinoText: string, expectedAddress: string): boolean {
  const destinoNorm = norm(destinoText);
  const expectedNorm = norm(expectedAddress);

  if (!destinoNorm || !expectedNorm || expectedNorm.length < 6) return false;

  if (destinoNorm.includes(expectedNorm)) return true;

  const expectedStart = expectedNorm.slice(0, Math.min(22, expectedNorm.length));
  if (expectedStart.length >= 10 && destinoNorm.includes(expectedStart)) return true;

  const expectedTokens = expectedNorm.split(/\s+/).filter((t) => t.length >= 3 || /\d/.test(t));
  if (expectedTokens.length === 0) return false;

  const matched = expectedTokens.filter((t) => destinoNorm.includes(t)).length;
  const ratio = matched / expectedTokens.length;

  // Exigir coincidencia fuerte de destino. No se usa nombre para abrir.
  return matched >= 3 && ratio >= 0.75;
}

async function getVisibleErrorText(page: Page): Promise<string> {
  const selectors = [
    ".alert-danger",
    ".alert-error",
    ".error",
    "[class*='error']",
    "[class*='danger']",
    "[class*='invalid']",
    ".invalid-feedback",
  ];

  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
      const txt = ((await el.textContent().catch(() => "")) ?? "").trim().replace(/\s+/g, " ");
      if (txt) return txt;
    }
  }
  return "";
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. LOGIN
// ═════════════════════════════════════════════════════════════════════════════
export async function ensureLoggedIn(
  page: Page,
  addLog?: LogCallback,
  debugMode = false
): Promise<boolean> {
  const settings = await getSettings();

  addLog?.("[1/7] 🔐 Verificando sesión...");
  addLog?.(`[1/7] Email configurado: ${settings.enviatodoEmail ? settings.enviatodoEmail : "(vacío)"}`);
  addLog?.(`[1/7] Password configurada: ${settings.enviatodoPassword ? "sí" : "no"}`);

  if (!settings.enviatodoEmail || !settings.enviatodoPassword) {
    addLog?.("❌ Credenciales no configuradas → ir a Configuración");
    return false;
  }

  async function fillLoginForm(): Promise<boolean> {
    const emailInput = page.getByRole("textbox", { name: "Correo electrónico" });
    const passInput = page.getByRole("textbox", { name: "Contraseña" });
    const loginBtn = page.getByRole("button", { name: "Iniciar sesión" });

    await emailInput.waitFor({ state: "visible", timeout: 20_000 });
    await emailInput.click({ clickCount: 3 });
    await emailInput.fill(settings.enviatodoEmail!);

    await passInput.waitFor({ state: "visible", timeout: 20_000 });
    await passInput.click({ clickCount: 3 });
    await passInput.fill(settings.enviatodoPassword!);

    await emailInput.evaluate((el) => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }).catch(() => {});

    await passInput.evaluate((el) => {
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur", { bubbles: true }));
    }).catch(() => {});

    await page.waitForTimeout(500);
    await loginBtn.waitFor({ state: "visible", timeout: 15_000 });

    for (let i = 1; i <= 8; i++) {
      const visible = await loginBtn.isVisible().catch(() => false);
      const disabled = await loginBtn.isDisabled().catch(() => false);
      addLog?.(`[1/7] Estado botón login intento ${i}/8 → visible=${visible}, disabled=${disabled}`);
      if (visible && !disabled) break;
      await page.waitForTimeout(400);
    }

    if (await loginBtn.isDisabled().catch(() => false)) {
      addLog?.("[1/7] ❌ El botón Iniciar sesión sigue deshabilitado");
      return false;
    }

    addLog?.("[1/7] 🖱️ Clic en Iniciar sesión...");
    await loginBtn.click({ force: false }).catch(async () => {
      addLog?.("[1/7] ⚠️ Clic normal falló. Intentando Enter...");
      await passInput.press("Enter");
    });

    return true;
  }

  async function waitForLoginResult(): Promise<boolean> {
    addLog?.("[1/7] ⏳ Esperando resultado real del login...");
    const start = Date.now();
    const timeout = 45_000;

    while (Date.now() - start < timeout) {
      await waitForBlockingOverlaysGone(page, addLog, 2_000).catch(() => {});

      if ((await isShopOrderReady(page, 500)) || (await isAppVisible(page, 800))) {
        addLog?.("[1/7] ✅ App detectada después del login");
        await persistSession(page.context()).catch(() => {});
        return true;
      }

      const loginStillVisible = await isLoginFormVisible(page, 500);
      if (!loginStillVisible) {
        await page.waitForTimeout(1200);
        if ((await isShopOrderReady(page, 1000)) || (await isAppVisible(page, 1500)) || !page.url().toLowerCase().includes("login")) {
          addLog?.("[1/7] ✅ Login aparentemente exitoso; formulario desapareció");
          await persistSession(page.context()).catch(() => {});
          return true;
        }
      }

      const errorText = await getLoginErrorText(page);
      if (errorText) {
        addLog?.(`[1/7] ❌ Error visible de login: ${errorText}`);
        return false;
      }

      await page.waitForTimeout(700);
    }

    addLog?.("[1/7] ❌ Login falló por timeout");
    return false;
  }

  try {
    await page.goto(ROOT_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const rootState = await waitForAnyMount(page, addLog, "montaje (raíz #)", 10_000);

    if (rootState === "shop" || rootState === "app") {
      addLog?.("[1/7] ✅ Sesión activa reutilizada");
      return true;
    }

    if (rootState === "login") {
      addLog?.("[1/7] 🔑 Formulario de login detectado. Iniciando sesión...");
      if (!(await fillLoginForm())) return false;
      return await waitForLoginResult();
    }

    addLog?.("[1/7] ⏳ No veo app ni login en raíz. Probando sesión cacheada en #ShopOrder...");
    await page.goto(SHOP_ORDER_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const shopState = await waitForAnyMount(page, addLog, "montaje (#ShopOrder)", 12_000);

    if (shopState === "shop" || shopState === "app") {
      addLog?.("[1/7] ✅ Sesión activa reutilizada en #ShopOrder");
      return true;
    }

    if (shopState === "login") {
      addLog?.("[1/7] 🔑 Login detectado desde #ShopOrder. Iniciando sesión...");
      if (!(await fillLoginForm())) return false;
      return await waitForLoginResult();
    }

    addLog?.("[1/7] ⏳ No veo app ni login. Abriendo #Login...");
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    let loginState = await waitForAnyMount(page, addLog, "montaje (#Login)", 18_000);

    if (loginState === "none") {
      addLog?.("[1/7] ⚠️ #Login no montó. Recargando #Login una vez...");
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
      loginState = await waitForAnyMount(page, addLog, "montaje (#Login reload)", 18_000);
    }

    if (loginState === "login") {
      addLog?.("[1/7] 🔑 Formulario de login detectado desde #Login. Iniciando sesión...");
      if (!(await fillLoginForm())) return false;
      return await waitForLoginResult();
    }

    if (loginState === "shop" || loginState === "app") {
      addLog?.("[1/7] ✅ Sesión activa reutilizada después de #Login");
      return true;
    }

    addLog?.("[1/7] ⚠️ No se detectó app ni login, pero se continúa para validar en #ShopOrder");
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog?.(`[1/7] ❌ Error login: ${msg}`);
    return false;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. NAVEGAR DIRECTO A TIENDAS
// ═════════════════════════════════════════════════════════════════════════════
export async function navigateToOrders(
  page: Page,
  addLog?: LogCallback,
  debugMode = false
): Promise<boolean> {
  addLog?.("[2/7] 🗂️ Navegando directo a Órdenes > Tiendas...");

  try {
    if (await isShopOrderReady(page, 2500)) {
      await waitForBlockingOverlaysGone(page, addLog, 15_000);
      addLog?.("[2/7] ✅ Ya está en Órdenes > Tiendas");
      return true;
    }

    addLog?.("[2/7] Abriendo ruta directa #ShopOrder...");
    await page.goto(SHOP_ORDER_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForBlockingOverlaysGone(page, addLog, 20_000);

    if (await isShopOrderReady(page, 20_000)) {
      await waitForBlockingOverlaysGone(page, addLog, 15_000);
      addLog?.("[2/7] ✅ Órdenes > Tiendas cargado por ruta directa");
      return true;
    }

    addLog?.("[2/7] ⚠️ #ShopOrder no montó. Recargando una vez...");
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    await waitForBlockingOverlaysGone(page, addLog, 20_000);

    if (await isShopOrderReady(page, 20_000)) {
      await waitForBlockingOverlaysGone(page, addLog, 15_000);
      addLog?.("[2/7] ✅ Órdenes > Tiendas cargado después de reload");
      return true;
    }

    addLog?.(`[2/7] ❌ No se encontró la sección Tiendas [url: ${page.url()}] [activeFlow: ${activeFlowPath()}]`);
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog?.(`[2/7] ❌ Error navegando a Tiendas: ${msg}`);
    return false;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. BUSCAR PEDIDO
// ═════════════════════════════════════════════════════════════════════════════
export async function searchOrder(
  page: Page,
  order: Pick<BulkOrderInput, "customerName" | "shopifyOrderNum">,
  addLog?: LogCallback,
  debugMode = false
): Promise<boolean> {
  addLog?.(`[3/7] 🔍 Buscando por nombre: "${order.customerName}"...`);

  try {
    await waitForBlockingOverlaysGone(page, addLog, 20_000);

    let buscador = page.locator('input[type="search"][aria-controls="settings_table"]').first();
    if (!(await buscador.isVisible({ timeout: 5_000 }).catch(() => false))) {
      const buscadores = page.getByPlaceholder("Buscar...");
      const count = await buscadores.count();
      if (count === 0) {
        addLog?.("[3/7] ❌ No se encontró ningún buscador");
        return false;
      }
      buscador = buscadores.nth(count - 1);
    }

    await buscador.waitFor({ state: "visible", timeout: 12_000 });
    await waitForBlockingOverlaysGone(page, addLog, 20_000);

    await buscador.click({ timeout: 10_000 });
    await buscador.fill("");
    await page.waitForTimeout(150);
    await buscador.fill(order.customerName);

    addLog?.(`[3/7] ⏳ Esperando resultados para "${order.customerName}"...`);
    await page.waitForTimeout(700);
    await waitForBlockingOverlaysGone(page, addLog, 10_000);

    const visibleRows = await page.locator("tbody tr:visible").count().catch(() => 0);
    addLog?.(`[3/7] ✅ Resultados cargados para "${order.customerName}" (${visibleRows} fila/s visibles)`);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog?.(`[3/7] ❌ Error en búsqueda: ${msg}`);
    return false;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. ABRIR SOLO DESTINO
// ═════════════════════════════════════════════════════════════════════════════
export async function openOrder(
  page: Page,
  order: Pick<BulkOrderInput, "origAddress1" | "customerName" | "shopifyOrderNum" | "origCity">,
  addLog?: LogCallback,
  debugMode = false
): Promise<boolean> {
  addLog?.(`[4/7] 📂 Abriendo SOLO DESTINO para "${order.customerName}"...`);

  if (!order.origAddress1 || !order.origAddress1.trim()) {
    addLog?.("[4/7] ❌ SEGURIDAD: El pedido no tiene origAddress1 para validar DESTINO. No se modifica.");
    return false;
  }

  async function clickAndValidate(locator: Locator, label: string): Promise<boolean> {
    if (!(await locator.isVisible({ timeout: 2500 }).catch(() => false))) return false;

    addLog?.(`[4/7] Intentando abrir SOLO DESTINO con: ${label}`);
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.click({ force: false });

    const opened = await page
      .getByText(/Información de la dirección/i)
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);

    if (!opened) {
      addLog?.(`[4/7] ⚠️ Clic en "${label}" no abrió formulario`);
      return false;
    }

    await page.waitForTimeout(700);

    if (await isAddressModalOpen(page)) {
      addLog?.(`[4/7] ✅ Formulario de DESTINO abierto correctamente (${label})`);
      return true;
    }

    addLog?.(`[4/7] ⚠️ El formulario abrió pero se cerró inmediatamente (${label})`);
    return false;
  }

  await page.waitForTimeout(400);

  const tables = page.locator("table");
  const tableCount = await tables.count().catch(() => 0);

  if (tableCount === 0) {
    addLog?.("[4/7] ❌ No se encontró tabla de pedidos");
    return false;
  }

  type Candidate = {
    tableIndex: number;
    rowIndex: number;
    row: Locator;
    destinoCell: Locator;
    destinoText: string;
    origenText: string;
  };

  const candidates: Candidate[] = [];

  for (let t = 0; t < tableCount; t++) {
    const table = tables.nth(t);
    if (!(await table.isVisible({ timeout: 1000 }).catch(() => false))) continue;

    const headers = table.locator("thead tr th, thead tr td, tr:first-child th, tr:first-child td");
    const headerCount = await headers.count().catch(() => 0);
    if (headerCount === 0) continue;

    let destinoIndex = -1;
    let origenIndex = -1;

    for (let i = 0; i < headerCount; i++) {
      const headerText = norm((await headers.nth(i).textContent().catch(() => "")) ?? "");
      if (headerText.includes("destino")) destinoIndex = i;
      if (headerText.includes("origen")) origenIndex = i;
    }

    addLog?.(`[4/7] Tabla ${t + 1}: columna Origen=${origenIndex}, Destino=${destinoIndex}`);

    if (destinoIndex === -1) continue;
    if (origenIndex !== -1 && origenIndex === destinoIndex) continue;

    const rows = table.locator("tbody tr");
    const rowCount = await rows.count().catch(() => 0);

    for (let r = 0; r < rowCount; r++) {
      const row = rows.nth(r);
      if (!(await row.isVisible({ timeout: 500 }).catch(() => false))) continue;

      const cells = row.locator("td, th");
      const cellCount = await cells.count().catch(() => 0);
      if (destinoIndex >= cellCount) continue;

      const destinoCell = cells.nth(destinoIndex);
      const destinoText = ((await destinoCell.textContent().catch(() => "")) ?? "").trim();
      const origenText = origenIndex >= 0 && origenIndex < cellCount
        ? (((await cells.nth(origenIndex).textContent().catch(() => "")) ?? "").trim())
        : "";

      // REGLA CRÍTICA: abrir pedido SOLO si la celda DESTINO coincide con origAddress1.
      // El nombre del cliente NO autoriza abrir fila, porque puede haber nombres duplicados o parecidos.
      const destinoMatch = destinationMatchesExpected(destinoText, order.origAddress1);

      if (!destinoMatch) continue;
      if (!destinoText || destinoText.length < 4) continue;
      if (origenText && norm(origenText) === norm(destinoText)) continue;

      candidates.push({
        tableIndex: t,
        rowIndex: r,
        row,
        destinoCell,
        destinoText,
        origenText,
      });
    }
  }

  if (candidates.length === 0) {
    addLog?.(
      `[4/7] ❌ SEGURIDAD: No encontré ninguna fila cuyo DESTINO coincida con origAddress1="${order.origAddress1}". No se modifica.`
    );
    return false;
  }

  if (candidates.length > 1) {
    addLog?.(`[4/7] ❌ SEGURIDAD: Hay ${candidates.length} filas con destino similar. No se modifica para evitar tocar un pedido equivocado.`);
    candidates.slice(0, 5).forEach((c, i) => {
      addLog?.(`   Candidato ${i + 1}: "${c.destinoText.slice(0, 100)}"`);
    });
    return false;
  }

  const candidate = candidates[0];

  addLog?.(`[4/7] Fila segura encontrada por DESTINO exacto/fuerte.`);
  addLog?.(`[4/7] Origen detectado: "${candidate.origenText.slice(0, 80)}"`);
  addLog?.(`[4/7] Destino detectado: "${candidate.destinoText.slice(0, 100)}"`);

  const clickable = candidate.destinoCell.locator("a, button, [role='button']").first();
  if (await clickable.isVisible({ timeout: 800 }).catch(() => false)) {
    if (await clickAndValidate(clickable, `link/botón dentro de DESTINO: ${candidate.destinoText.slice(0, 70)}`)) return true;
  }

  if (await clickAndValidate(candidate.destinoCell, `celda DESTINO: ${candidate.destinoText.slice(0, 70)}`)) return true;

  addLog?.("[4/7] ❌ La celda Destino coincidió, pero no abrió el formulario. No intentaré Origen ni fila completa.");
  return false;
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. APLICAR CORRECCIONES
// ═════════════════════════════════════════════════════════════════════════════
export async function applyCorrections(
  page: Page,
  corrections: ApplyCorrections,
  orderId: string,
  addLog?: LogCallback,
  debugMode = false
): Promise<{ success: boolean; message: string; coloniaWarning?: string }> {
  addLog?.("[5/7] ✏️  Aplicando correcciones...");

  try {
    if (!(await ensureAddressModalOpen(page, addLog, "inicio applyCorrections"))) {
      return { success: false, message: "El popup de dirección no está abierto" };
    }

    if (corrections.nombre) {
      addLog?.(`   🔒 Validando nombre del contacto antes de modificar campos...`);
      const nameCheck = await validateAndTruncateNameOnlyIfSameCustomer(page, corrections.nombre, addLog);

      if (!nameCheck.success) {
        return { success: false, message: nameCheck.message };
      }
    }

    if (corrections.address1) {
      const valor = corrections.address1.slice(0, 42);
      addLog?.(`   🏠 Calle → "${valor}"`);
      const ok = await safeFillInsideAddressModal(
        page,
        page.getByRole("textbox", { name: "Calle*" }),
        valor,
        "Calle",
        addLog
      );
      if (!ok) return { success: false, message: "El popup se cerró al escribir calle" };
    }

    if (corrections.zip) {
      addLog?.(`   📮 CP → ${corrections.zip}`);
      const ok = await safeFillInsideAddressModal(
        page,
        page.getByRole("spinbutton", { name: "Código postal*" }),
        corrections.zip,
        "Código postal",
        addLog
      );
      if (!ok) return { success: false, message: "El popup se cerró al escribir código postal" };

      await page.keyboard.press("Tab").catch(() => {});
      await page.waitForTimeout(1200);
      if (!(await ensureAddressModalOpen(page, addLog, "después de CP"))) {
        return { success: false, message: "El popup se cerró después de escribir código postal" };
      }
    }

    let coloniaWarning: string | undefined;
    if (corrections.colonia) {
      const ok = await selectColonia(page, corrections.colonia, orderId, addLog, false);
      if (!ok) {
        return {
          success: false,
          message: `No se pudo seleccionar la colonia exacta "${corrections.colonia}". No se guardó el pedido.`,
        };
      }
    }

    if (corrections.reference) {
      const valor = corrections.reference.slice(0, 25);
      addLog?.(`   📌 Referencia → "${valor}"`);
      const ok = await safeFillInsideAddressModal(
        page,
        page.getByRole("textbox", { name: "Referencia*" }),
        valor,
        "Referencia",
        addLog
      );
      if (!ok) return { success: false, message: "El popup se cerró al escribir referencia", coloniaWarning };
    }

    addLog?.("[5/7] ✅ Campos rellenados");
    return { success: true, message: "Correcciones aplicadas al formulario", coloniaWarning };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Error en formulario: ${msg}` };
  }
}

// ─── COLONIA: buscar, hacer clic real y confirmar selección ──────────────────
async function selectColonia(
  page: Page,
  colonia: string,
  orderId: string,
  addLog?: LogCallback,
  debugMode = false
): Promise<boolean> {
  const coloniaLimpia = colonia.trim();

  if (!coloniaLimpia) {
    addLog?.("   ⚠️ Colonia vacía, se omite");
    return false;
  }

  addLog?.(`   🏘️ Seleccionando colonia "${coloniaLimpia}"...`);

  const objetivo = norm(coloniaLimpia);

  async function isModalOpen(): Promise<boolean> {
    return await page
      .locator("#general_modal.modal.show, #general_modal.show, .modal.show")
      .filter({ hasText: /Información de la dirección/i })
      .last()
      .isVisible({ timeout: 1000 })
      .catch(() => false);
  }

  async function isDropdownOpen(): Promise<boolean> {
    return await page
      .locator(".ng-dropdown-panel, [role='listbox'], .dropdown-menu, .select2-results")
      .last()
      .isVisible({ timeout: 800 })
      .catch(() => false);
  }

  async function openColoniaDropdown(): Promise<boolean> {
    if (!(await isModalOpen())) {
      addLog?.("   ❌ El popup no está abierto antes de seleccionar colonia");
      return false;
    }

    // 1) Intento por DOM: buscar el control junto al label Colonia dentro del modal.
    const openedByDom = await page.evaluate(() => {
      const modal =
        document.querySelector("#general_modal.modal.show") ||
        document.querySelector("#general_modal.show") ||
        document.querySelector(".modal.show");

      if (!modal) return false;

      const clean = (txt: string) => txt.replace(/\s+/g, " ").trim().toLowerCase();

      const labels = Array.from(modal.querySelectorAll("label, span, div"))
        .filter((el) => clean(el.textContent || "").startsWith("colonia"));

      for (const label of labels) {
        let container: Element | null =
          label.closest(".form-group") ||
          label.closest(".col-md-6") ||
          label.closest(".col-md-12") ||
          label.closest(".row") ||
          label.parentElement;

        for (let i = 0; i < 5 && container; i++) {
          const trigger =
            container.querySelector("ng-select") ||
            container.querySelector(".ng-select-container") ||
            container.querySelector("[role='combobox']") ||
            container.querySelector("[aria-haspopup='listbox']");

          if (trigger) {
            (trigger as HTMLElement).click();
            return true;
          }

          container = container.parentElement;
        }
      }

      return false;
    });

    if (openedByDom) {
      await page.waitForTimeout(600);
      if (await isDropdownOpen()) {
        addLog?.("   🔓 Dropdown Colonia abierto por label/ng-select");
        return true;
      }
    }

    // 2) Fallback visual: clic debajo del label Colonia.
    const label = page.getByText(/^Colonia/i).last();
    const box = await label.boundingBox().catch(() => null);

    if (box) {
      await page.mouse.click(box.x + 160, box.y + 38);
      await page.waitForTimeout(700);
      if (await isDropdownOpen()) {
        addLog?.("   🔓 Dropdown Colonia abierto por coordenada del label");
        return true;
      }
    }

    // 3) Último fallback: último ng-select visible dentro del modal.
    const trigger = page
      .locator("#general_modal ng-select, #general_modal .ng-select-container, .modal.show ng-select, .modal.show .ng-select-container")
      .last();

    if (await trigger.isVisible({ timeout: 1000 }).catch(() => false)) {
      await trigger.click();
      await page.waitForTimeout(700);
      if (await isDropdownOpen()) {
        addLog?.("   🔓 Dropdown Colonia abierto por último ng-select");
        return true;
      }
    }

    addLog?.("   ❌ No se pudo abrir el dropdown de Colonia");
    return false;
  }

  async function getDropdownSearchInput(): Promise<Locator | null> {
    const candidates = [
      page.locator(".ng-dropdown-panel .ng-input input").last(),
      page.locator(".ng-select-opened .ng-input input").last(),
      page.locator("[role='listbox'] input").last(),
      page.locator(".dropdown-menu input").last(),
      page.locator("input[type='search']").last(),
    ];

    for (const input of candidates) {
      if (await input.isVisible({ timeout: 1000 }).catch(() => false)) {
        return input;
      }
    }

    return null;
  }

  async function findExactOption(): Promise<Locator | null> {
    const options = page.locator(
      ".ng-dropdown-panel .ng-option:not(.ng-option-disabled), " +
      ".ng-dropdown-panel [role='option'], " +
      "[role='listbox'] [role='option'], " +
      ".dropdown-menu li, " +
      ".select2-results__option"
    );

    const count = await options.count().catch(() => 0);

    for (let i = 0; i < count; i++) {
      const option = options.nth(i);
      const text = ((await option.textContent().catch(() => "")) ?? "").trim();
      if (!text) continue;

      if (norm(text) === objetivo) {
        return option;
      }
    }

    return null;
  }

  async function confirmSelection(): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < 6000) {
      if (!(await isModalOpen())) {
        addLog?.("   ❌ El popup se cerró durante la selección de colonia");
        return false;
      }

      const dropdownOpen = await isDropdownOpen();

      const selectedTextVisible = await page
        .locator("#general_modal, .modal.show")
        .getByText(coloniaLimpia, { exact: true })
        .last()
        .isVisible({ timeout: 300 })
        .catch(() => false);

      // Confirmación fuerte: dropdown cerrado + texto seleccionado visible en modal.
      if (!dropdownOpen && selectedTextVisible) {
        return true;
      }

      await page.waitForTimeout(300);
    }

    return false;
  }

  async function waitMunicipioAutoFill(): Promise<boolean> {
    // No se edita Municipio/Ciudad manualmente. Solo se espera que EnviaTodo lo llene.
    const start = Date.now();

    while (Date.now() - start < 8000) {
      const fields = [
        page.getByRole("textbox", { name: /Municipio \/ Ciudad/i }),
        page.getByRole("textbox", { name: /Municipio/i }),
        page.getByRole("textbox", { name: /Ciudad/i }),
        page.locator("#general_modal input[placeholder*='Municipio' i]").first(),
        page.locator("#general_modal input[placeholder*='Ciudad' i]").first(),
        page.locator("#general_modal input[name*='city' i]").first(),
        page.locator("#general_modal input[name*='municipio' i]").first(),
      ];

      for (const field of fields) {
        if (await field.isVisible({ timeout: 300 }).catch(() => false)) {
          const value = await field.inputValue().catch(() => "");
          if ((value ?? "").trim().length > 0) {
            addLog?.(`   ✅ Municipio / Ciudad autollenado: "${value.trim()}"`);
            return true;
          }
        }
      }

      await page.waitForTimeout(400);
    }

    addLog?.("   ⚠️ Municipio / Ciudad no se autollenó; la colonia probablemente no quedó seleccionada");
    return false;
  }

  try {
    for (let intento = 1; intento <= 2; intento++) {
      addLog?.(`   🔁 Intento colonia ${intento}/2`);

      if (!(await openColoniaDropdown())) {
        continue;
      }

      if (!(await isModalOpen())) {
        addLog?.("   ❌ El popup se cerró después de abrir colonia");
        return false;
      }

      const input = await getDropdownSearchInput();

      if (input) {
        addLog?.(`   🔎 Escribiendo colonia en buscador: "${coloniaLimpia}"`);
        await input.click({ clickCount: 3 }).catch(() => {});
        await input.fill("");
        await page.waitForTimeout(200);
        await input.fill(coloniaLimpia);
        await page.waitForTimeout(1000);
      } else {
        addLog?.("   ⚠️ No encontré input interno del dropdown, escribiendo por teclado");
        await page.keyboard.type(coloniaLimpia, { delay: 25 });
        await page.waitForTimeout(1000);
      }

      const option = await findExactOption();

      if (!option) {
        addLog?.(`   ⚠️ No apareció opción exacta para "${coloniaLimpia}"`);
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(400);
        continue;
      }

      const optionText = ((await option.textContent().catch(() => "")) ?? "").trim();
      addLog?.(`   🎯 Opción exacta encontrada: "${optionText}"`);

      await option.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(200);

      // 1) Clic Playwright sobre la opción exacta.
      await option.click({ force: true }).catch(() => {
        addLog?.("   ⚠️ Click Playwright sobre opción falló; se intentará por coordenadas");
      });

      await page.waitForTimeout(900);

      if (await confirmSelection()) {
        addLog?.(`   ✅ Colonia seleccionada correctamente: "${coloniaLimpia}"`);
        const municipioOk = await waitMunicipioAutoFill();
        if (!municipioOk) return false;
        return true;
      }

      // 2) Clic por coordenadas exactas sobre la opción.
      const box = await option.boundingBox().catch(() => null);
      if (box) {
        addLog?.("   🖱️ Intentando clic por coordenadas sobre la opción exacta");
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(900);

        if (await confirmSelection()) {
          addLog?.(`   ✅ Colonia seleccionada correctamente por coordenadas: "${coloniaLimpia}"`);
          const municipioOk = await waitMunicipioAutoFill();
          if (!municipioOk) return false;
          return true;
        }
      }

      // 3) Enter: algunos ng-select seleccionan la opción filtrada con Enter.
      addLog?.("   ⌨️ Intentando seleccionar con Enter");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(900);

      if (await confirmSelection()) {
        addLog?.(`   ✅ Colonia seleccionada correctamente con Enter: "${coloniaLimpia}"`);
        const municipioOk = await waitMunicipioAutoFill();
        if (!municipioOk) return false;
        return true;
      }

      addLog?.("   ⚠️ No se confirmó selección de colonia en este intento");
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(500);
    }

    addLog?.(`   ⚠️ No se pudo seleccionar la colonia exacta: "${coloniaLimpia}"`);
    return false;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog?.(`   ❌ Error seleccionando colonia: ${msg}`);
    return false;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 6. GUARDAR
// ═════════════════════════════════════════════════════════════════════════════
export async function saveChanges(
  page: Page,
  orderId: string,
  addLog?: LogCallback,
  debugMode = false
): Promise<{ success: boolean; message: string }> {
  addLog?.("[6/7] 💾 Guardando cambios...");

  async function isGeneralModalOpen(): Promise<boolean> {
    return await page
      .locator("#general_modal.modal.show, #general_modal.show, .modal.show:has-text('Información de la dirección')")
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
  }

  async function waitForGeneralModalClosed(timeout = 12_000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (!(await isGeneralModalOpen())) return true;
      await page.waitForTimeout(350);
    }
    return !(await isGeneralModalOpen());
  }

  try {
    await page.keyboard.press("Tab").catch(() => {});
    await page.waitForTimeout(250);

    // Cerrar popup con Guardar. Si no cierra, no avanzar al botón principal.
    for (let intento = 1; intento <= 3; intento++) {
      addLog?.(`[6/7] Intento ${intento}/3 para cerrar popup con Guardar...`);

      const guardarPopup = page.getByRole("button", { name: "Guardar", exact: true });
      await guardarPopup.waitFor({ state: "visible", timeout: 10_000 });
      await guardarPopup.scrollIntoViewIfNeeded().catch(() => {});

      if (await guardarPopup.isDisabled().catch(() => false)) {
        return { success: false, message: "El botón Guardar del popup está deshabilitado" };
      }

      await guardarPopup.click({ force: false });
      addLog?.("[6/7] ✅ Clic en Guardar del popup");

      const closed = await waitForGeneralModalClosed(12_000);
      if (closed) {
        addLog?.("[6/7] ✅ Popup cerrado correctamente");
        break;
      }

      const errorText = await getVisibleErrorText(page);
      if (errorText) {
        return { success: false, message: `El popup no cerró porque muestra error: ${errorText}` };
      }

      if (intento === 3) {
        return { success: false, message: "El popup no cerró después de intentar Guardar 3 veces" };
      }
    }

    await waitForBlockingOverlaysGone(page, addLog, 15_000);

    addLog?.("[6/7] 💾 Buscando botón Guardar cambios principal...");
    const guardarCambios = page.locator("#stores_save_changes_button");
    await guardarCambios.waitFor({ state: "visible", timeout: 15_000 });
    await guardarCambios.scrollIntoViewIfNeeded().catch(() => {});

    for (let i = 1; i <= 8; i++) {
      const visible = await guardarCambios.isVisible().catch(() => false);
      const disabled = await guardarCambios.isDisabled().catch(() => false);
      const className = await guardarCambios.getAttribute("class").catch(() => "");
      addLog?.(`[6/7] Estado Guardar cambios intento ${i}/8 → visible=${visible}, disabled=${disabled}, class="${className ?? ""}"`);
      if (visible && !disabled) break;
      await page.waitForTimeout(500);
    }

    if (await guardarCambios.isDisabled().catch(() => false)) {
      return { success: false, message: "El botón Guardar cambios nunca se habilitó" };
    }

    // Confirmar otra vez que no hay modal tapando.
    const modalStillOpen = await isGeneralModalOpen();
    if (modalStillOpen) {
      return { success: false, message: "El popup sigue abierto y bloquea Guardar cambios" };
    }

    addLog?.("[6/7] 🖱️ Haciendo clic en Guardar cambios...");
    await guardarCambios.click({ force: false, timeout: 10_000 });
    addLog?.("[6/7] ✅ Clic en Guardar cambios realizado");

    await page.waitForTimeout(700);
    await waitForBlockingOverlaysGone(page, addLog, 25_000);
    await page.waitForTimeout(3_000);

    addLog?.("[6/7] ✅ Guardado completo: popup + Guardar cambios + espera final");
    return { success: true, message: "Guardado completo en EnviaTodo" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Error al guardar: ${msg}` };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 7. VALIDACIÓN RÁPIDA
// ═════════════════════════════════════════════════════════════════════════════
export async function validateSaved(
  page: Page,
  orderId: string,
  addLog?: LogCallback,
  debugMode = false
): Promise<{ success: boolean; message: string }> {
  addLog?.("[7/7] ✔️ Validación rápida del guardado...");

  const errorText = await getVisibleErrorText(page);
  if (errorText) {
    addLog?.(`[7/7] ❌ Error visible después de guardar: ${errorText}`);
    return { success: false, message: `Error visible después de guardar: ${errorText}` };
  }

  addLog?.("[7/7] ✅ Validación rápida OK — sin errores visibles");
  return { success: true, message: "Correcciones guardadas en EnviaTodo" };
}

// ═════════════════════════════════════════════════════════════════════════════
// FLUJO COMPLETO POR PEDIDO
// ═════════════════════════════════════════════════════════════════════════════
async function applyOneOrder(
  page: Page,
  order: BulkOrderInput,
  debugMode = false,
  addLog?: LogCallback
): Promise<BulkApplyResult> {
  const corrections: ApplyCorrections = {
    // Nombre se usa SOLO para validar que el popup corresponde al mismo cliente
    // y recortarlo a 30 caracteres si es necesario. Nunca se copia sobre un popup distinto.
    nombre: order.customerName,
    address1: order.sugAddress1 ?? undefined,
    zip: order.sugZip && order.sugZip !== order.origZip ? order.sugZip : undefined,
    colonia: order.sugColonia ?? undefined,
    reference: order.sugReference ?? undefined,
  };

  const onOrders = await navigateToOrders(page, addLog, false);
  if (!onOrders) {
    return {
      orderId: order.id,
      shopifyOrderNum: order.shopifyOrderNum,
      customerName: order.customerName,
      success: false,
      message: "No se pudo navegar a la sección de pedidos",
    };
  }

  const searched = await searchOrder(page, order, addLog, false);
  if (!searched) {
    return {
      orderId: order.id,
      shopifyOrderNum: order.shopifyOrderNum,
      customerName: order.customerName,
      success: false,
      message: "Error en búsqueda de pedido",
    };
  }

  const opened = await openOrder(page, order, addLog, false);
  if (!opened) {
    return {
      orderId: order.id,
      shopifyOrderNum: order.shopifyOrderNum,
      customerName: order.customerName,
      success: false,
      message: `Pedido #${order.shopifyOrderNum} no encontrado o destino no abrió`,
    };
  }

  const filled = await applyCorrections(page, corrections, order.id, addLog, false);
  if (!filled.success) {
    return {
      orderId: order.id,
      shopifyOrderNum: order.shopifyOrderNum,
      customerName: order.customerName,
      success: false,
      message: filled.message,
      coloniaWarning: filled.coloniaWarning,
    };
  }

  const saved = await saveChanges(page, order.id, addLog, false);
  if (!saved.success) {
    return {
      orderId: order.id,
      shopifyOrderNum: order.shopifyOrderNum,
      customerName: order.customerName,
      success: false,
      message: saved.message,
      coloniaWarning: filled.coloniaWarning,
    };
  }

  const validated = await validateSaved(page, order.id, addLog, false);
  return {
    orderId: order.id,
    shopifyOrderNum: order.shopifyOrderNum,
    customerName: order.customerName,
    success: validated.success,
    message: validated.message,
    coloniaWarning: filled.coloniaWarning,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// PEDIDO ÚNICO
// ═════════════════════════════════════════════════════════════════════════════
export async function applyCorrectionsToEnviaTodo(
  orderId: string,
  corrections: ApplyCorrections & {
    shopifyOrderNum?: string;
    customerName?: string;
    origAddress1?: string;
    origCity?: string;
    origZip?: string;
  },
  debugMode = false
): Promise<{ success: boolean; message: string }> {
  const logs: string[] = [];
  const addLog: LogCallback = (msg) => logs.push(msg);

  await log("[PLAYWRIGHT] APPLY_START", `Corrección pedido ${orderId}`, { level: "INFO", orderId });

  const session = await openEnviaTodoSession(false);

  try {
    const loggedIn = await ensureLoggedIn(session.page, addLog, false);
    if (!loggedIn) {
      await closeEnviaTodoSession(session);
      return { success: false, message: "No se pudo iniciar sesión" };
    }

    const orderInput: BulkOrderInput = {
      id: orderId,
      shopifyOrderNum: corrections.shopifyOrderNum ?? orderId,
      customerName: corrections.customerName ?? "",
      origAddress1: corrections.origAddress1 ?? "",
      origCity: corrections.origCity ?? "",
      origZip: corrections.origZip ?? "",
      sugAddress1: corrections.address1 ?? null,
      sugZip: corrections.zip ?? null,
      sugColonia: corrections.colonia ?? null,
      sugReference: corrections.reference ?? null,
    };

    const result = await applyOneOrder(session.page, orderInput, false, addLog);

    if (result.success) {
      await session.page.waitForTimeout(3_000);
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
    await closeEnviaTodoSession(session);
    await log("[PLAYWRIGHT] APPLY_ERROR", `${msg}\n${logs.join("\n")}`, { level: "ERROR", orderId });
    return { success: false, message: `Error inesperado: ${msg}` };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// BULK APPLY — browser por pedido
// ═════════════════════════════════════════════════════════════════════════════
export async function bulkApplyCorrections(
  orders: BulkOrderInput[],
  onLog?: LogCallback,
  onOrderComplete?: OrderCompleteCallback,
  debugMode = false,
  headless?: boolean
): Promise<BulkApplyResult[]> {
  if (orders.length === 0) return [];

  const results: BulkApplyResult[] = [];
  await log("[PLAYWRIGHT] BULK_START", `Bulk: ${orders.length} pedidos`, { level: "INFO" });

  for (const order of orders) {
    onLog?.(`\n📦 #${order.shopifyOrderNum} · ${order.customerName}`);
    onLog?.(`   🌐 Abriendo navegador${headless === false ? " (visible)" : " (segundo plano)"}...`);

    const session = await openEnviaTodoSession(headless);
    let result: BulkApplyResult;

    try {
      const loggedIn = await ensureLoggedIn(session.page, onLog, false);

      if (!loggedIn) {
        result = {
          orderId: order.id,
          shopifyOrderNum: order.shopifyOrderNum,
          customerName: order.customerName,
          success: false,
          message: "No se pudo iniciar sesión en EnviaTodo",
        };
      } else {
        result = await applyOneOrder(session.page, order, false, onLog);

        if (result.success) {
          onLog?.("   ⏳ Esperando cierre seguro antes de cerrar navegador...");
          await session.page.waitForTimeout(3_000);
        }
      }

      await closeEnviaTodoSession(session);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await closeEnviaTodoSession(session).catch(() => null);
      result = {
        orderId: order.id,
        shopifyOrderNum: order.shopifyOrderNum,
        customerName: order.customerName,
        success: false,
        message: `Excepción: ${msg}`,
      };
      onLog?.(`   ❌ ${result.message}`);
    }

    results.push(result);

    if (onOrderComplete) {
      await onOrderComplete(result).catch((e) => {
        onLog?.(`   ⚠️ Error DB: ${e instanceof Error ? e.message : String(e)}`);
      });
    }

    onLog?.(result.success ? "   ✅ OK" : `   ❌ Error: ${result.message}`);
  }

  const ok = results.filter((r) => r.success).length;
  const err = results.filter((r) => !r.success).length;
  const failed = results.filter((r) => !r.success);
  const coloniaWarnings = results.filter((r) => r.success && r.coloniaWarning);

  onLog?.(`\n📊 Resumen: ✅ ${ok} exitosos  ❌ ${err} errores  📦 ${results.length} total`);

  if (failed.length > 0) {
    onLog?.("\n❌ Pedidos que fallaron:");
    for (const r of failed) {
      onLog?.(`   - #${r.shopifyOrderNum ?? r.orderId} · ${r.customerName ?? "Sin nombre"}: ${r.message}`);
    }
  }

  if (coloniaWarnings.length > 0) {
    onLog?.("\n⚠️ Pedidos guardados, pero la colonia NO se pudo seleccionar y se dejó como estaba:");
    for (const r of coloniaWarnings) {
      onLog?.(`   - #${r.shopifyOrderNum ?? r.orderId} · ${r.customerName ?? "Sin nombre"}: ${r.coloniaWarning}`);
    }
  }

  await log(
    "[PLAYWRIGHT] BULK_DONE",
    `Bulk: ${ok}/${orders.length} exitosos, ${err} errores`,
    { level: err === 0 ? "SUCCESS" : "WARN" }
  );

  return results;
}

// ═════════════════════════════════════════════════════════════════════════════
// SYNC TIENDA
// ═════════════════════════════════════════════════════════════════════════════
export async function syncEnviaTodoStore(addLog?: LogCallback): Promise<{ success: boolean; message: string }> {
  addLog?.("🔄 Iniciando sincronización manual...");
  const session = await openEnviaTodoSession(false);

  try {
    const loggedIn = await ensureLoggedIn(session.page, addLog, false);
    if (!loggedIn) throw new Error("No se pudo iniciar sesión");

    const onOrders = await navigateToOrders(session.page, addLog, false);
    if (!onOrders) throw new Error("No se pudo abrir Tiendas");

    addLog?.("⚡ Sincronizando...");
    const syncBtn = session.page.getByRole("button", { name: /sincronizar/i });
    await syncBtn.waitFor({ state: "visible", timeout: 8_000 });
    await syncBtn.click();

    await waitForBlockingOverlaysGone(session.page, addLog, 30_000);
    await closeEnviaTodoSession(session);

    addLog?.("✅ Sincronización completada");
    await log("[PLAYWRIGHT] SYNC_DONE", "Sync completada", { level: "SUCCESS" });
    return { success: true, message: "Sincronización completada" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await closeEnviaTodoSession(session);
    await log("[PLAYWRIGHT] SYNC_ERROR", msg, { level: "ERROR" });
    return { success: false, message: `Error de sync: ${msg}` };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// COMPAT LEGACY
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
    const ok = await ensureLoggedIn(session.page);
    await closeEnviaTodoSession(session);
    return { success: ok, message: ok ? "Login exitoso — sesión guardada" : "Login falló" };
  } catch (err) {
    await closeEnviaTodoSession(session);
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, message: msg };
  }
}
