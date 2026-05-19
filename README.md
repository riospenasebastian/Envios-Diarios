# EnvíosSaaS — Automatización Logística

Sistema interno de automatización logística entre **Shopify** y **EnviaTodo**, enfocado en validación y corrección semiautomática de direcciones de envíos en México.

## Stack

- **Next.js 14** (App Router)
- **React 18** + **TypeScript**
- **TailwindCSS** (dark mode)
- **SQLite** + **Prisma ORM**
- **Playwright** para automatización de EnviaTodo
- **Fuse.js** para fuzzy matching de colonias

---

## Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Setup inicial (crea DB, instala Playwright)
npx ts-node scripts/setup.ts

# O manualmente:
npx prisma db push
npx playwright install chromium

# 3. Arrancar
npm run dev
```

Abre: **http://localhost:3000**

---

## Configuración inicial

1. Ir a **http://localhost:3000/settings**
2. Configurar **Shopify**: URL de tienda + Admin API Token
3. Configurar **EnviaTodo**: email + contraseña
4. Subir el archivo **Excel SEPOMEX** (base de colonias/CPs)
5. En la sección Playwright, dar clic en **"Iniciar sesión EnviaTodo"**

---

## Flujo de trabajo diario

### 1. Sincronizar pedidos

```
Dashboard → botón "Sincronizar pedidos"
```

El sistema:
- Obtiene pedidos sin fulfillment de Shopify
- Analiza cada dirección contra la base SEPOMEX
- Detecta 6 tipos de errores
- Asigna niveles de confianza: ALTA / MEDIA / BAJA / CRÍTICA

### 2. Revisar correcciones

```
Pedidos → filtrar por "Corregibles"
```

Por cada pedido:
- Ver comparación lado a lado (original vs sugerido)
- **Aprobar** → el pedido queda listo para aplicar
- **Editar** → modificar manualmente las sugerencias
- **Rechazar** → descartar con motivo opcional

### 3. Aplicar en EnviaTodo

```
Correcciones → pedido aprobado → "Aplicar en EnviaTodo"
```

Playwright abre EnviaTodo y aplica los cambios.
**Shopify NUNCA se modifica.**

---

## Grabar flujo EnviaTodo con Codegen

```bash
npm run playwright:codegen
```

Esto abre un navegador donde puedes grabar clics y acciones.
El código generado debe pegarse en `playwright/scripts/`.

---

## Tipos de errores detectados

| Error | Descripción |
|-------|-------------|
| `CP_INCORRECTO` | Colonia detectada, CP no corresponde → se sugiere CP correcto |
| `COLONIA_MAL_ESCRITA` | Fuzzy match con base SEPOMEX |
| `SIN_COLONIA` | No se detectó colonia en la dirección |
| `SIN_COLONIA_CP_INCORRECTO` | Sin colonia y CP inválido → CRÍTICO |
| `DIRECCION_INVALIDA` | Email, texto vacío, dirección sin sentido |
| `DIRECCION_LARGA` | Supera los 42 chars de EnviaTodo → se divide inteligentemente |

---

## Estructura del proyecto

```
app/                   # Next.js App Router
  api/                 # API Routes
  page.tsx             # Dashboard
  orders/              # Tabla de pedidos
  corrections/[id]/    # Detalle de corrección
  settings/            # Configuración
  logs/                # Logs del sistema

services/              # Lógica de negocio
  shopifyService.ts    # API de Shopify
  sepomexService.ts    # Base SEPOMEX + Fuse.js
  validationService.ts # Motor de validación
  correctionService.ts # Aprobación/rechazo
  playwrightService.ts # Automatización EnviaTodo
  syncService.ts       # Orquestador de sincronización
  loggerService.ts     # Sistema de logs

playwright/
  scripts/             # Scripts de automatización
  sessions/            # Cookies guardadas (gitignored)

prisma/
  schema.prisma        # Esquema de base de datos

database/              # SQLite (gitignored)
```

---

## Variables de entorno

Ver `.env.local`. Todas las credenciales se configuran desde la UI en `/settings`.
