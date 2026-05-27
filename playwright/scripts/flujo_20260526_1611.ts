import { test, expect, Page } from '@playwright/test';

test.use({
  viewport: {
    height: 1080,
    width: 1920
  }
});

// Aquí debes poner la colonia que viene desde tu base de datos
const COLONIA_OBJETIVO = 'San Salvador Tizatlalli';

function normalizarTexto(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function seleccionarColonia(page: Page, coloniaObjetivo: string) {
  const coloniaLimpia = coloniaObjetivo.trim();

  if (!coloniaLimpia) {
    throw new Error('La colonia viene vacía desde la base de datos.');
  }

  // Esperar a que el campo de colonia exista en pantalla
  await expect(page.getByText(/Colonia/i)).toBeVisible({ timeout: 20000 });

  // Buscar visualmente el label "Colonia"
  const labelColonia = page.getByText(/Colonia/i).last();
  const box = await labelColonia.boundingBox();

  if (!box) {
    throw new Error('No se pudo ubicar el campo Colonia visualmente.');
  }

  // Clic sobre el dropdown de Colonia.
  // Según tu captura, el dropdown está justo debajo del texto "Colonia".
  await page.mouse.click(box.x + 120, box.y + 35);

  // Esperar a que abra el dropdown
  await page.waitForTimeout(500);

  // Intentar escribir en el buscador interno del dropdown si existe
  const buscadoresDropdown = page.locator(
    'input[type="search"], .dropdown-menu input, .select2-search__field, [role="listbox"] input'
  );

  if (await buscadoresDropdown.first().isVisible().catch(() => false)) {
    await buscadoresDropdown.first().click();
    await buscadoresDropdown.first().fill(coloniaLimpia);
    await page.waitForTimeout(500);
  }

  // Buscar opción exacta por texto visible
  const opcionPorTexto = page
    .getByText(coloniaLimpia, { exact: true })
    .last();

  if (await opcionPorTexto.isVisible().catch(() => false)) {
    await opcionPorTexto.click();
    await page.waitForTimeout(500);
    return;
  }

  // Plan B: buscar dentro del DOM normalizando acentos, mayúsculas y espacios
  const seleccionada = await page.evaluate((coloniaBuscada) => {
    const normalizar = (texto: string) =>
      texto
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

    const objetivo = normalizar(coloniaBuscada);

    const posiblesOpciones = Array.from(
      document.querySelectorAll(
        '[role="option"], [role="treeitem"], li, div, span, a'
      )
    ).filter((el) => {
      const rect = el.getBoundingClientRect();
      const texto = el.textContent || '';

      return (
        rect.width > 0 &&
        rect.height > 0 &&
        texto.trim().length > 0
      );
    });

    const opcionExacta = posiblesOpciones.find((el) => {
      const texto = normalizar(el.textContent || '');
      return texto === objetivo;
    });

    if (opcionExacta) {
      (opcionExacta as HTMLElement).click();
      return true;
    }

    return false;
  }, coloniaLimpia);

  if (!seleccionada) {
    throw new Error(`No se encontró la colonia exacta: "${coloniaLimpia}"`);
  }

  await page.waitForTimeout(500);
}

test('test', async ({ page }) => {
  await page.goto('https://app.enviatodo.com/#Login', {
    waitUntil: 'domcontentloaded'
  });

  await expect(page.getByRole('textbox', { name: 'Correo electrónico' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('textbox', { name: 'Correo electrónico' }).click();

  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('riospenasebastian@gmail.com');

  await expect(page.getByRole('textbox', { name: 'Contraseña' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('textbox', { name: 'Contraseña' }).click();

  await page.getByRole('textbox', { name: 'Contraseña' }).fill('Envios@Henric21');

  // Mantengo estos pasos porque estaban en tu flujo original
  await page.getByRole('textbox', { name: 'Contraseña' }).dblclick();

  await page.getByRole('textbox', { name: 'Contraseña' }).press('ControlOrMeta+c');

  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled({ timeout: 20000 });
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  // Esperar a que el login procese
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1000);

  await page.goto('https://app.enviatodo.com/#NewOrder', {
    waitUntil: 'domcontentloaded'
  });

  await expect(page.getByRole('link', { name: ' Tiendas' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('link', { name: ' Tiendas' }).click();

  await expect(page.getByPlaceholder('Buscar...')).toBeVisible({ timeout: 20000 });
  await page.getByPlaceholder('Buscar...').click();

  await expect(page.getByText('Calle 20 de noviembre #')).toBeVisible({ timeout: 20000 });
  await page.getByText('Calle 20 de noviembre #').click();

  await expect(page.getByRole('textbox', { name: 'Nombre del contacto*' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('textbox', { name: 'Nombre del contacto*' }).click();

  await expect(page.getByRole('textbox', { name: 'Calle*' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('textbox', { name: 'Calle*' }).click();

  await expect(page.getByRole('spinbutton', { name: 'Código postal*' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('spinbutton', { name: 'Código postal*' }).click();

  // Espera corta para que EnviaTodo cargue las colonias del código postal
  await page.waitForTimeout(800);

  // Seleccionar la colonia correcta según la base de datos
  await seleccionarColonia(page, COLONIA_OBJETIVO);

  await expect(page.getByRole('textbox', { name: 'Referencia*' })).toBeVisible({ timeout: 20000 });
  await page.getByRole('textbox', { name: 'Referencia*' }).click();

  await page.getByRole('textbox', { name: 'Referencia*' }).click();

  // Por seguridad, validar que la colonia realmente quedó seleccionada antes de guardar
  await expect(page.getByText(COLONIA_OBJETIVO, { exact: true })).toBeVisible({ timeout: 10000 });

  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled({ timeout: 20000 });
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeEnabled({ timeout: 20000 });
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
});