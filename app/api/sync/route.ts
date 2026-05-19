import { NextResponse } from "next/server";
import { syncShopifyOrders } from "@/services/syncService";
import { syncEnviaTodo } from "@/services/playwrightService";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { mode } = body as { mode?: string };

    if (mode === "enviatodo") {
      const result = await syncEnviaTodo();
      return NextResponse.json(result);
    }

    // Default: sync Shopify
    const result = await syncShopifyOrders();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
