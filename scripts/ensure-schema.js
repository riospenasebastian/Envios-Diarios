/**
 * ensure-schema.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Aplica columnas nuevas y OPCIONALES que falten en la base de datos.
 *
 * Por qué existe: este proyecto no usa `prisma migrate` (no hay carpeta
 * `prisma/migrations`), solo `prisma db push` corrido a mano. En local eso
 * funciona, pero en Docker la base del contenedor se queda sin las columnas
 * nuevas y el sync falla con:
 *
 *   The column `main.Order.noteAddressJson` does not exist in the current database
 *
 * Este script corre antes de arrancar la app y cierra ese hueco.
 *
 * REGLAS DE SEGURIDAD:
 *  - Solo AGREGA columnas nullable. Nunca borra, renombra ni cambia tipos.
 *  - Es idempotente: si la columna ya existe, no hace nada.
 *  - NUNCA aborta el arranque. Pase lo que pase termina con código 0; si algo
 *    falla lo deja escrito en el log y deja que la app arranque igual.
 *
 * Solo usa @prisma/client (dependencia de runtime), así que funciona también
 * en imágenes que instalan sin devDependencies y no tienen el CLI de Prisma.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Columnas opcionales que la app espera. Al agregar una columna nullable nueva
// al schema, añádela también aquí para que los despliegues la reciban solos.
const EXPECTED_COLUMNS = [
  { table: "Order", column: "noteAddressJson", type: "TEXT" },
];

async function main() {
  let PrismaClient;
  try {
    ({ PrismaClient } = require("@prisma/client"));
  } catch {
    console.log("[ensure-schema] @prisma/client no disponible — se omite");
    return;
  }

  const prisma = new PrismaClient();

  try {
    for (const { table, column, type } of EXPECTED_COLUMNS) {
      let columnas;
      try {
        columnas = await prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
      } catch (err) {
        console.log(`[ensure-schema] No se pudo leer la tabla ${table}: ${err.message}`);
        continue;
      }

      if (!Array.isArray(columnas) || columnas.length === 0) {
        // Base vacía o tabla inexistente: es trabajo de `prisma db push`,
        // no de este script.
        console.log(
          `[ensure-schema] La tabla ${table} no existe todavía — corre "npx prisma db push"`
        );
        continue;
      }

      const existe = columnas.some((c) => c.name === column);
      if (existe) {
        console.log(`[ensure-schema] ${table}.${column} ya existe`);
        continue;
      }

      await prisma.$executeRawUnsafe(
        `ALTER TABLE "${table}" ADD COLUMN "${column}" ${type}`
      );
      console.log(`[ensure-schema] ✅ Columna agregada: ${table}.${column} (${type})`);
    }
  } catch (err) {
    console.log(`[ensure-schema] Error no fatal: ${err.message}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main()
  .catch((err) => {
    console.log(`[ensure-schema] Error no fatal: ${err.message}`);
  })
  .finally(() => {
    // Nunca bloquear el arranque de la app.
    process.exit(0);
  });
