import { prisma } from "@/lib/prisma";
import { log } from "./loggerService";
import type { ValidationResult } from "@/types";

export async function applyValidationResult(
  orderId: string,
  result: ValidationResult
): Promise<void> {
  const { errorType, confidence, suggestedAddress, detectedColonia, errorDetails } = result;

  let status: string;
  if (errorType === "OK") {
    status = "OK";
  } else if (errorType === "DIRECCION_INVALIDA") {
    status = "CRITICAL";
  } else if (errorType === "SIN_COLONIA_CP_INCORRECTO" && confidence === "CRITICA") {
    status = "CRITICAL";
  } else if (confidence === "ALTA" || confidence === "MEDIA") {
    status = "CORRECTABLE";
  } else {
    status = "NEEDS_REVIEW";
  }

  // Serializar colonias sugeridas para el picker de UI
  const sugColoniasJson = result.coloniasSugeridas && result.coloniasSugeridas.length > 0
    ? JSON.stringify(result.coloniasSugeridas)
    : null;

  await prisma.order.update({
    where: { id: orderId },
    data: {
      errorType: errorType ?? null,
      confidence,
      errorDetails: errorDetails ?? null,
      validationNotes: result.notes ?? null,
      detectedColonia: detectedColonia ?? null,
      sugAddress1: suggestedAddress?.address1 ?? null,
      sugAddress2: suggestedAddress?.address2 ?? null,
      sugCity: suggestedAddress?.city ?? null,
      sugState: suggestedAddress?.state ?? null,
      sugZip: suggestedAddress?.zip ?? null,
      sugColonia: suggestedAddress?.colonia ?? null,
      sugReference: suggestedAddress?.reference ?? null,
      sugColoniasJson,
      status,
    },
  });
}

export async function approveOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Pedido no encontrado");
  if (order.status === "APPLIED") throw new Error("Este pedido ya fue aplicado");

  await prisma.order.update({
    where: { id: orderId },
    data: { status: "APPROVED", approvedAt: new Date(), rejectedAt: null, rejectedReason: null },
  });

  // Registrar correcciones aplicadas
  const corrections: { field: string; oldValue: string | null; newValue: string | null }[] = [];
  if (order.sugZip && order.sugZip !== order.origZip) {
    corrections.push({ field: "cp", oldValue: order.origZip, newValue: order.sugZip });
  }
  if (order.sugColonia && order.sugColonia !== order.originalColonia) {
    corrections.push({ field: "colonia", oldValue: order.originalColonia, newValue: order.sugColonia });
  }
  if (order.sugAddress1 && order.sugAddress1 !== order.origAddress1) {
    corrections.push({ field: "address1", oldValue: order.origAddress1, newValue: order.sugAddress1 });
  }

  if (corrections.length > 0) {
    await prisma.correction.createMany({
      data: corrections.map((c) => ({
        orderId,
        field: c.field,
        oldValue: c.oldValue,
        newValue: c.newValue,
        source: "system",
        confidence: order.confidence,
      })),
    });
  }

  await log("APPROVE_ORDER", `Pedido #${order.shopifyOrderNum} aprobado`, {
    level: "SUCCESS",
    orderId,
    details: { corrections: corrections.length },
  });
}

export async function rejectOrder(orderId: string, reason?: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Pedido no encontrado");

  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: "REJECTED",
      rejectedAt: new Date(),
      rejectedReason: reason ?? null,
      approvedAt: null,
    },
  });

  await log("REJECT_ORDER", `Pedido #${order.shopifyOrderNum} rechazado`, {
    level: "WARN",
    orderId,
    details: { reason },
  });
}

export async function manualEditOrder(
  orderId: string,
  fields: {
    sugAddress1?: string;
    sugAddress2?: string;
    sugCity?: string;
    sugState?: string;
    sugZip?: string;
    sugColonia?: string;
    sugReference?: string;
  }
): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error("Pedido no encontrado");

  await prisma.order.update({
    where: { id: orderId },
    data: { ...fields, status: "CORRECTABLE" },
  });

  // Registrar correcciones manuales
  const corrections = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([field, newValue]) => ({
      orderId,
      field,
      oldValue: (order as Record<string, unknown>)[field] as string | null,
      newValue: newValue as string,
      source: "manual",
    }));

  if (corrections.length > 0) {
    await prisma.correction.createMany({ data: corrections });
  }

  await log("MANUAL_EDIT", `Pedido #${order.shopifyOrderNum} editado manualmente`, {
    level: "INFO",
    orderId,
    details: fields,
  });
}

export async function revalidateOrder(orderId: string): Promise<void> {
  await prisma.order.update({
    where: { id: orderId },
    data: {
      status: "PENDING",
      errorType: null,
      confidence: "UNKNOWN",
      errorDetails: null,
      sugAddress1: null,
      sugAddress2: null,
      sugCity: null,
      sugState: null,
      sugZip: null,
      sugColonia: null,
      sugReference: null,
      sugColoniasJson: null,
      detectedColonia: null,
    },
  });

  await log("REVALIDATE", `Pedido ${orderId} marcado para revalidar`, {
    level: "INFO",
    orderId,
  });
}
