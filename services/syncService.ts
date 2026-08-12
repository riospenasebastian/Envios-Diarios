import { prisma, ensureSchemaReady } from "@/lib/prisma";
import {
  fetchShopifyOrders,
  buildShopifyOrderLink,
  buildShopifyMapLink,
  extractCustomerName,
} from "./shopifyService";
import { extractCartFormData } from "./shopifyNoteService";
import { validateAddress } from "./validationService";
import { applyValidationResult } from "./correctionService";
import { log } from "./loggerService";
import { getSettings } from "./settingsService";
import type { ShopifyOrder } from "@/types";

export async function syncShopifyOrders(): Promise<{
  total: number;
  newOrders: number;
  updated: number;
  errors: number;
}> {
  // Antes de escribir nada: asegurar que la base tenga las columnas nuevas.
  // Sin esto, en un contenedor sin migrar fallan TODOS los pedidos del sync.
  await ensureSchemaReady();

  const settings = await getSettings();
  const session = await prisma.syncSession.create({ data: { status: "RUNNING" } });

  let newOrders = 0;
  let updated = 0;
  let errors = 0;

  try {
    await log("[SYNC] SHOPIFY_START", "Iniciando sincronización con Shopify", { level: "INFO" });

    // ── Cargar historial permanente de pedidos ya aplicados ──────────────────
    // Los shopifyIds en AppliedHistory nunca vuelven a procesarse,
    // aunque el cliente vuelva a comprar el mismo día.
    const appliedHistoryIds = await prisma.appliedHistory
      .findMany({ select: { shopifyId: true } })
      .then((rows) => new Set(rows.map((r) => r.shopifyId)));

    if (appliedHistoryIds.size > 0) {
      await log(
        "[SYNC] SKIP_APPLIED",
        `${appliedHistoryIds.size} pedidos en historial permanente — se omitirán`,
        { level: "INFO" }
      );
    }

    // ── Ventana activa: solo pedidos de los últimos 4 días ───────────────────
    // Todo lo que sea más antiguo no tiene sentido en la app: o ya fue enviado
    // (→ AppliedHistory lo registra) o ya no es accionable.
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);

    // ── Helper: borrar hijos antes de Orders (FK constraint SQLite) ───────────
    async function deleteOrdersWithChildren(orderIds: string[]) {
      if (orderIds.length === 0) return 0;
      await prisma.correction.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.log.deleteMany({ where: { orderId: { in: orderIds } } });
      const { count } = await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
      return count;
    }

    // ── LIMPIEZA 1: eliminar TODOS los pedidos con más de 4 días ─────────────
    // Bug anterior: solo borraba PENDING/ANALYZING → acumulaba pedidos de 100-200 días.
    // Ahora borramos CUALQUIER estado. AppliedHistory es el registro permanente;
    // los registros Order son solo de trabajo activo.
    const oldOrders = await prisma.order.findMany({
      where: { shopifyCreatedAt: { lt: fourDaysAgo } },
      select: { id: true },
    });
    const deletedOld = await deleteOrdersWithChildren(oldOrders.map((o) => o.id));
    if (deletedOld > 0) {
      await log(
        "[SYNC] CLEANUP_OLD",
        `${deletedOld} pedidos con más de 4 días eliminados (cualquier estado)`,
        { level: "INFO" }
      );
    }

    // Filtros: pagados + sin fulfillment + últimos 4 días + más recientes primero
    const orders = await fetchShopifyOrders({
      limit: 250,
      created_at_min: fourDaysAgo.toISOString(),
    });

    // ── LIMPIEZA 2: eliminar pedidos que Shopify ya no devuelve ───────────────
    // Si un pedido local NO aparece en la respuesta de Shopify → ya tiene guía
    // asignada (fulfilled) o fue cancelado. En ambos casos hay que borrarlo.
    // Bug anterior: APPLIED estaba excluido → pedidos con guía nunca se borraban.
    const incomingShopifyIds = new Set(orders.map((o) => String(o.id)));

    const localActive = await prisma.order.findMany({
      where: { shopifyCreatedAt: { gte: fourDaysAgo } },
      select: { id: true, shopifyId: true, shopifyOrderNum: true },
    });

    const toRemove = localActive.filter((r) => !incomingShopifyIds.has(r.shopifyId));
    if (toRemove.length > 0) {
      await deleteOrdersWithChildren(toRemove.map((r) => r.id));
      await log(
        "[SYNC] CLEANUP_FULFILLED",
        `${toRemove.length} pedidos con guía/cancelados en Shopify eliminados: ${toRemove.map((r) => `#${r.shopifyOrderNum}`).join(", ")}`,
        { level: "INFO" }
      );
    }

    await log(
      "[SYNC] SHOPIFY_FETCH",
      `${orders.length} pedidos (pagados, sin guía, últimos 4 días) de Shopify`,
      { level: "INFO" }
    );

    for (const shopifyOrder of orders) {
      // Saltar pedidos que ya están en el historial permanente de aplicados
      if (appliedHistoryIds.has(String(shopifyOrder.id))) {
        await log(
          "[SYNC] SKIP_APPLIED_ORDER",
          `Pedido #${shopifyOrder.order_number} ya en historial — omitido`,
          { level: "INFO" }
        );
        continue;
      }

      try {
        const isNew = await processShopifyOrder(shopifyOrder, settings.shopifyStoreUrl);
        if (isNew) newOrders++;
        else updated++;
      } catch (err) {
        errors++;
        await log(
          "[SYNC] ORDER_ERROR",
          `Error procesando pedido ${shopifyOrder.order_number}: ${err instanceof Error ? err.message : String(err)}`,
          { level: "ERROR" }
        );
      }
    }

    await prisma.syncSession.update({
      where: { id: session.id },
      data: { status: "DONE", finishedAt: new Date(), ordersFound: orders.length, ordersNew: newOrders },
    });

    await log(
      "[SYNC] SHOPIFY_DONE",
      `Sync completa — ${newOrders} nuevos, ${updated} actualizados, ${errors} errores`,
      { level: "SUCCESS" }
    );

    return { total: orders.length, newOrders, updated, errors };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await prisma.syncSession.update({
      where: { id: session.id },
      data: { status: "ERROR", finishedAt: new Date(), errorMsg: msg },
    });
    await log("[SYNC] SHOPIFY_ERROR", `Error crítico en sincronización: ${msg}`, { level: "ERROR" });
    throw error;
  }
}

/** Retorna true si fue un pedido nuevo, false si fue actualización */
async function processShopifyOrder(
  shopifyOrder: ShopifyOrder,
  storeUrl: string
): Promise<boolean> {
  const shopifyId = String(shopifyOrder.id);
  const sa = shopifyOrder.shipping_address;
  if (!sa) return false;

  const customerName = extractCustomerName(shopifyOrder);
  const shopifyLink = buildShopifyOrderLink(storeUrl, shopifyId);

  // El mapLink es el link de Google Maps de la dirección tal como lo genera Shopify
  const mapLink = buildShopifyMapLink(sa);

  // Colonia detectada de address2 (campo donde Shopify suele poner la colonia en MX)
  const originalColonia =
    sa.address2 && sa.address2.trim().length > 2 ? sa.address2.trim() : null;

  const existing = await prisma.order.findUnique({ where: { shopifyId } });

  let orderId: string;
  let isNew = false;

  if (existing) {
    const upd = await prisma.order.update({
      where: { shopifyId },
      data: {
        customerName,
        customerPhone: shopifyOrder.customer?.phone ?? sa.phone ?? null,
        customerEmail: shopifyOrder.customer?.email ?? null,
        origAddress1: sa.address1 ?? "",
        origAddress2: sa.address2 ?? null,
        origCity: sa.city ?? "",
        origState: sa.province ?? "",
        origZip: sa.zip ?? "",
        origCountry: sa.country ?? "MX",
        originalColonia,
        shopifyLink,
        mapLink,
        shopifyCreatedAt: new Date(shopifyOrder.created_at),
        syncedAt: new Date(),
      },
    });
    orderId = upd.id;
  } else {
    isNew = true;
    const created = await prisma.order.create({
      data: {
        shopifyId,
        shopifyOrderNum: String(shopifyOrder.order_number),
        customerName,
        customerPhone: shopifyOrder.customer?.phone ?? sa.phone ?? null,
        customerEmail: shopifyOrder.customer?.email ?? null,
        origAddress1: sa.address1 ?? "",
        origAddress2: sa.address2 ?? null,
        origCity: sa.city ?? "",
        origState: sa.province ?? "",
        origZip: sa.zip ?? "",
        origCountry: sa.country ?? "MX",
        originalColonia,
        shopifyLink,
        mapLink,
        shopifyCreatedAt: new Date(shopifyOrder.created_at),
        status: "ANALYZING",
      },
    });
    orderId = created.id;
  }

  // ── Datos del formulario obligatorio del carrito (notas del pedido) ────────
  // Si vienen completos son la fuente preferente para colonia y CP.
  // Si no, validateAddress usa la lógica de siempre.
  const cartForm = extractCartFormData(shopifyOrder);

  if (cartForm.status === "found") {
    await log(
      "[SYNC] NOTE_CART_FORM",
      `Pedido #${shopifyOrder.order_number} · fuente: shopify_note/cart_form → ` +
        `${cartForm.data.estado} / ${cartForm.data.municipio} / ` +
        `${cartForm.data.colonia} / CP ${cartForm.data.cp}`,
      { level: "INFO", orderId }
    );
  } else {
    await log(
      "[SYNC] NOTE_CART_FORM",
      `Pedido #${shopifyOrder.order_number} · fuente: lógica actual — ${cartForm.reason}`,
      { level: "INFO", orderId }
    );
  }

  // Validar dirección (siempre, para capturar cambios)
  try {
    const result = await validateAddress(
      sa,
      customerName,
      cartForm.status === "found" ? cartForm.data : null
    );
    await applyValidationResult(orderId, result);
  } catch (err) {
    await log(
      "[VALIDATION] ERROR",
      `Error validando pedido ${shopifyOrder.order_number}: ${err instanceof Error ? err.message : String(err)}`,
      { level: "ERROR", orderId }
    );
    await prisma.order.update({
      where: { id: orderId },
      data: { status: "NEEDS_REVIEW", errorDetails: "Error en validación automática" },
    });
  }

  return isNew;
}
