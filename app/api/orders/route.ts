import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = parseInt(searchParams.get("limit") ?? "50");
  const skip = (page - 1) * limit;

  const errorType = searchParams.get("errorType");
  const where: Record<string, unknown> = {};

  if (status && status !== "ALL") where.status = status;
  if (errorType) where.errorType = errorType;

  if (search) {
    where.OR = [
      { customerName: { contains: search } },
      { shopifyOrderNum: { contains: search } },
      { origCity: { contains: search } },
      { origZip: { contains: search } },
      { origAddress1: { contains: search } },
      { detectedColonia: { contains: search } },
    ];
  }

  const [orders, total, approvedCount] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      skip,
      take: limit,
    }),
    prisma.order.count({ where }),
    prisma.order.count({ where: { status: "APPROVED" } }),
  ]);

  return NextResponse.json({ orders, total, page, limit, pages: Math.ceil(total / limit), approvedCount });
}
