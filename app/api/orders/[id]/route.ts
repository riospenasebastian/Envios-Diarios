import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { approveOrder, rejectOrder, manualEditOrder, revalidateOrder } from "@/services/correctionService";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { corrections: { orderBy: { createdAt: "desc" } }, logs: { orderBy: { createdAt: "desc" }, take: 20 } },
  });

  if (!order) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  return NextResponse.json(order);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { action, reason, fields } = body as {
      action: "approve" | "reject" | "edit" | "revalidate";
      reason?: string;
      fields?: Record<string, string>;
    };

    switch (action) {
      case "approve":
        await approveOrder(id);
        break;
      case "reject":
        await rejectOrder(id, reason);
        break;
      case "edit":
        await manualEditOrder(id, fields ?? {});
        break;
      case "revalidate":
        await revalidateOrder(id);
        break;
      default:
        return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
    }

    const updated = await prisma.order.findUnique({ where: { id } });
    return NextResponse.json({ success: true, order: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
