import { prisma } from "@/lib/prisma";
import type { AppSettings } from "@/types";

const DEFAULTS: AppSettings = {
  shopifyStoreUrl: "",
  shopifyAccessToken: "",
  shopifyApiVersion: "2024-07",
  enviatodoEmail: "",
  enviatodoPassword: "",
  enviatodoUrl: "https://app.enviatodo.com",
  maxNombreChars: "30",
  maxDireccionChars: "42",
  palabrasReferencia:
    "dept,departamento,torre,interior,apto,apartamento,piso,referencia,frente a,entre calles,local",
  playwrightHeadless: "false",
};

export async function getSetting(key: keyof AppSettings): Promise<string> {
  const setting = await prisma.setting.findUnique({ where: { key } });
  return setting?.value ?? DEFAULTS[key] ?? "";
}

export async function getSettings(): Promise<AppSettings> {
  const settings = await prisma.setting.findMany();
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;

  return {
    shopifyStoreUrl: map.shopifyStoreUrl ?? DEFAULTS.shopifyStoreUrl,
    shopifyAccessToken: map.shopifyAccessToken ?? map.shopifyAdminToken ?? DEFAULTS.shopifyAccessToken,
    shopifyApiVersion: map.shopifyApiVersion ?? DEFAULTS.shopifyApiVersion,
    enviatodoEmail: map.enviatodoEmail ?? DEFAULTS.enviatodoEmail,
    enviatodoPassword: map.enviatodoPassword ?? DEFAULTS.enviatodoPassword,
    enviatodoUrl: map.enviatodoUrl ?? DEFAULTS.enviatodoUrl,
    maxNombreChars: map.maxNombreChars ?? DEFAULTS.maxNombreChars,
    maxDireccionChars: map.maxDireccionChars ?? DEFAULTS.maxDireccionChars,
    palabrasReferencia: map.palabrasReferencia ?? DEFAULTS.palabrasReferencia,
    playwrightHeadless: map.playwrightHeadless ?? DEFAULTS.playwrightHeadless,
  };
}

export async function saveSettings(data: Partial<AppSettings>): Promise<void> {
  const ops = Object.entries(data).map(([key, value]) =>
    prisma.setting.upsert({
      where: { key },
      create: { key, value: value ?? "" },
      update: { value: value ?? "" },
    })
  );
  await prisma.$transaction(ops);
}
