import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/services/settingsService";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json({
    ...settings,
    // Enmascarar secretos — nunca enviar al cliente
    shopifyAccessToken: settings.shopifyAccessToken ? "••••••••" : "",
    enviatodoPassword: settings.enviatodoPassword ? "••••••••" : "",
    // Indicadores de si el secreto existe
    _hasShopifyToken: !!settings.shopifyAccessToken,
    _hasEnviatodoPassword: !!settings.enviatodoPassword,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const toSave: Record<string, string> = {};

    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string" && value !== "••••••••") {
        toSave[key] = value;
      }
    }

    await saveSettings(toSave);
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
