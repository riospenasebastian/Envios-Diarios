/**
 * Script de setup inicial:
 * - Crea directorios necesarios
 * - Genera la base de datos
 * - Instala browsers de Playwright
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const dirs = [
  "database",
  "playwright/sessions",
  "playwright/scripts",
  "logs",
];

console.log("EnvíosSaaS — Setup inicial\n");

// Crear directorios
for (const dir of dirs) {
  const full = path.join(process.cwd(), dir);
  if (!fs.existsSync(full)) {
    fs.mkdirSync(full, { recursive: true });
    console.log(`  ✓ Directorio creado: ${dir}`);
  } else {
    console.log(`  · Ya existe: ${dir}`);
  }
}

// Crear .env.local si no existe
const envFile = path.join(process.cwd(), ".env.local");
if (!fs.existsSync(envFile)) {
  fs.writeFileSync(
    envFile,
    `DATABASE_URL="file:./database/envios.db"\nNODE_ENV="development"\nNEXT_PUBLIC_APP_URL="http://localhost:3000"\n`
  );
  console.log("  ✓ .env.local creado");
}

// Prisma generate + push
console.log("\nGenerando base de datos...");
try {
  execSync("npx prisma generate", { stdio: "inherit" });
  execSync("npx prisma db push", { stdio: "inherit" });
  console.log("  ✓ Base de datos lista");
} catch {
  console.error("  ✗ Error con Prisma. Asegúrate de tener DATABASE_URL en .env.local");
}

// Playwright browsers
console.log("\nInstalando Chromium para Playwright...");
try {
  execSync("npx playwright install chromium", { stdio: "inherit" });
  console.log("  ✓ Chromium instalado");
} catch {
  console.error("  ✗ Error instalando Playwright");
}

console.log(`
✅ Setup completo.

Próximos pasos:
  1. npm run dev
  2. Abre http://localhost:3000/settings
  3. Configura Shopify y EnviaTodo
  4. Sube el archivo Excel SEPOMEX
  5. Graba el flujo de EnviaTodo: npm run playwright:codegen
  6. Vuelve al Dashboard y sincroniza pedidos
`);
