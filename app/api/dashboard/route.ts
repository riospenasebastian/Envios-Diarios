import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    statusCounts,
    recentLogs,
    recentOrders,
    sepomexCount,
    syncesToday,
    ordersApprovedToday,
    ordersAppliedToday,
  ] = await Promise.all([
    prisma.order.groupBy({ by: ["status"], _count: { id: true } }),
    prisma.log.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { order: { select: { shopifyOrderNum: true } } },
    }),
    prisma.order.findMany({
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true, shopifyOrderNum: true, customerName: true,
        status: true, errorType: true, confidence: true, updatedAt: true,
        origCity: true, origState: true,
      },
    }),
    prisma.colonia.count(),
    prisma.syncSession.count({ where: { startedAt: { gte: todayStart } } }),
    prisma.order.count({ where: { approvedAt: { gte: todayStart } } }),
    prisma.order.count({ where: { appliedAt: { gte: todayStart } } }),
  ]);

  const counts: Record<string, number> = {};
  for (const row of statusCounts) counts[row.status] = row._count.id;

  const total = await prisma.order.count();

  // KPI: tiempo ahorrado estimado (3 min por pedido procesado manualmente)
  const processed = (counts.APPROVED ?? 0) + (counts.APPLIED ?? 0) + (counts.OK ?? 0);
  const minutosTotales = processed * 3;
  const tiempoAhorrado = minutosTotales >= 60
    ? `${Math.floor(minutosTotales / 60)}h ${minutosTotales % 60}m`
    : `${minutosTotales}m`;

  return NextResponse.json({
    total,
    pending: counts.PENDING ?? 0,
    analyzing: counts.ANALYZING ?? 0,
    correctable: counts.CORRECTABLE ?? 0,
    needsReview: counts.NEEDS_REVIEW ?? 0,
    critical: counts.CRITICAL ?? 0,
    approved: counts.APPROVED ?? 0,
    rejected: counts.REJECTED ?? 0,
    applied: counts.APPLIED ?? 0,
    ok: counts.OK ?? 0,
    // KPIs adicionales
    syncesToday,
    ordersApprovedToday,
    ordersAppliedToday,
    tiempoAhorrado,
    procesadosPct: total > 0 ? Math.round(((counts.APPROVED ?? 0) + (counts.APPLIED ?? 0) + (counts.OK ?? 0)) / total * 100) : 0,
    recentLogs,
    recentOrders,
    sepomexLoaded: sepomexCount > 0,
    sepomexCount,
  });
}
