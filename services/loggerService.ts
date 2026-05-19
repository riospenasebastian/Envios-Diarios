import { prisma } from "@/lib/prisma";
import type { LogLevel } from "@/types";

export async function log(
  action: string,
  message: string,
  options?: {
    level?: LogLevel;
    orderId?: string;
    details?: string | object;
  }
) {
  const level = options?.level ?? "INFO";
  const details: string | null =
    options?.details && typeof options.details === "object"
      ? JSON.stringify(options.details)
      : typeof options?.details === "string"
        ? options.details
        : null;

  try {
    await prisma.log.create({
      data: {
        action,
        message,
        level,
        orderId: options?.orderId ?? null,
        details: details ?? null,
      },
    });
  } catch {
    // Silenciar errores de logging para no romper flujos principales
  }

  const prefix =
    level === "ERROR" ? "❌" : level === "WARN" ? "⚠️" : level === "SUCCESS" ? "✅" : "ℹ️";
  console.log(`[${level}] ${prefix} ${action}: ${message}`);
}

export async function getLogs(limit = 100, orderId?: string) {
  return prisma.log.findMany({
    where: orderId ? { orderId } : {},
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { order: { select: { shopifyOrderNum: true, customerName: true } } },
  });
}
