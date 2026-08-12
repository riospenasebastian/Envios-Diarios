import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// ─────────────────────────────────────────────────────────────────────────────
// Red de seguridad de schema
// ─────────────────────────────────────────────────────────────────────────────
// El proyecto no usa `prisma migrate` (no hay prisma/migrations), así que la
// base del contenedor Docker se queda sin las columnas nuevas y todo falla con
// "The column ... does not exist in the current database".
//
// `scripts/ensure-schema.js` cubre el arranque vía `npm run dev|start`, pero si
// la imagen ejecuta `next start` directo ese script nunca corre. Esto sí corre
// siempre, porque pasa por aquí cualquier acceso a la base.
//
// SEGURIDAD: solo AGREGA columnas nullable. Nunca borra, renombra ni cambia
// tipos, y nunca lanza: si algo falla lo registra y la app sigue.
//
// Al agregar una columna nullable nueva al schema, añadirla también aquí y en
// EXPECTED_COLUMNS de scripts/ensure-schema.js.
const EXPECTED_COLUMNS: Array<{ table: string; column: string; type: string }> = [
  { table: "Order", column: "noteAddressJson", type: "TEXT" },
];

async function applyMissingColumns(): Promise<void> {
  for (const { table, column, type } of EXPECTED_COLUMNS) {
    try {
      const columnas = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `PRAGMA table_info("${table}")`
      );

      // Tabla inexistente o base vacía: eso le toca a `prisma db push`.
      if (!Array.isArray(columnas) || columnas.length === 0) continue;
      if (columnas.some((c) => c.name === column)) continue;

      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${table}" ADD COLUMN "${column}" ${type}`
      );
      console.log(`[schema] Columna agregada: ${table}.${column} (${type})`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[schema] No se pudo revisar ${table}.${column}: ${msg}`);
    }
  }
}

let schemaReady: Promise<void> | null = null;

/**
 * Garantiza que las columnas opcionales existan antes de tocar la base.
 * Memoizada: el trabajo real ocurre una sola vez por proceso.
 */
export function ensureSchemaReady(): Promise<void> {
  if (!schemaReady) schemaReady = applyMissingColumns();
  return schemaReady;
}

// Arranque anticipado, para que normalmente ya esté lista en la primera
// petición. Se omite durante `next build`, que no necesita tocar la base.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  void ensureSchemaReady();
}
