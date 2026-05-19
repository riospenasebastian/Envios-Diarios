import { getSettings } from "./settingsService";
import type { ShopifyOrder, ShopifyAddress } from "@/types";

interface ShopifyOrdersResponse {
  orders: ShopifyOrder[];
}

function buildShopifyUrl(storeUrl: string, endpoint: string, apiVersion: string): string {
  const base = storeUrl.replace(/\/$/, "").replace(/^https?:\/\//, "");
  return `https://${base}/admin/api/${apiVersion}/${endpoint}`;
}

/**
 * Obtiene pedidos de Shopify.
 * Filtra: pagados + sin fulfillment (listos para envío).
 * Ordenados: más recientes primero.
 */
export async function fetchShopifyOrders(options?: {
  limit?: number;
  created_at_min?: string;
}): Promise<ShopifyOrder[]> {
  const settings = await getSettings();

  if (!settings.shopifyStoreUrl || !settings.shopifyAccessToken) {
    throw new Error("Configuración de Shopify incompleta. Ve a Configuración → Shopify.");
  }

  const params = new URLSearchParams({
    limit: String(options?.limit ?? 250),
    status: "open",
    financial_status: "paid",          // ✅ Solo pedidos PAGADOS
    fulfillment_status: "unfulfilled", // ✅ Sin fulfillment (sin guía)
    order: "created_at DESC",          // Más recientes primero
  });

  if (options?.created_at_min) {
    params.set("created_at_min", options.created_at_min);
  }

  const url = buildShopifyUrl(
    settings.shopifyStoreUrl,
    `orders.json?${params.toString()}`,
    settings.shopifyApiVersion || "2024-07"
  );

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-Shopify-Access-Token": settings.shopifyAccessToken,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Shopify API error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data: ShopifyOrdersResponse = await response.json();
  return data.orders ?? [];
}

export function buildShopifyOrderLink(storeUrl: string, orderId: string): string {
  const base = storeUrl.replace(/\/$/, "").replace(/^https?:\/\//, "");
  return `https://${base}/admin/orders/${orderId}`;
}

/**
 * Construye el link de mapa usando el mismo formato que usa Shopify admin.
 * NO genera geocoding. Solo forma la URL con la dirección proporcionada.
 */
export function buildShopifyMapLink(address: ShopifyAddress): string {
  const parts = [
    address.address1,
    address.city,
    address.province,
    address.zip,
    address.country || "MX",
  ].filter(Boolean);
  const query = encodeURIComponent(parts.join(", "));
  return `https://maps.google.com/maps?q=${query}`;
}

export function extractCustomerName(order: ShopifyOrder): string {
  // Preferir nombre de shipping_address (como aparece en la guía)
  const sa = order.shipping_address as ShopifyAddress & { name?: string; first_name?: string; last_name?: string };
  if (sa?.name && sa.name.trim()) return sa.name.trim();
  if (sa?.first_name || sa?.last_name) {
    return `${sa.first_name ?? ""} ${sa.last_name ?? ""}`.trim();
  }
  if (order.customer) {
    const { first_name, last_name } = order.customer;
    return `${first_name ?? ""} ${last_name ?? ""}`.trim();
  }
  return "Sin nombre";
}
