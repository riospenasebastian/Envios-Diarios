import { NextResponse } from "next/server";
import { loginEnviaTodo, resetSession, sessionExists } from "@/services/playwrightService";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action } = body as { action: string };

    switch (action) {
      case "login":
        return NextResponse.json(await loginEnviaTodo());

      case "reset":
        await resetSession();
        return NextResponse.json({ success: true, message: "Sesión eliminada" });

      case "status":
        return NextResponse.json({ success: true, hasSession: sessionExists() });

      default:
        return NextResponse.json({ success: false, message: "Acción inválida" }, { status: 400 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
