import { test, expect } from '@playwright/test';

test.use({
  viewport: {
    height: 1080,
    width: 1920
  }
});

test('test', async ({ page }) => {
  await page.goto('https://app.enviatodo.com/#Login');
  await page.getByRole('textbox', { name: 'Correo electrónico' }).click();
  await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('riospenasebastian@gmail.com');
  await page.getByRole('textbox', { name: 'Contraseña' }).click();
  await page.getByRole('textbox', { name: 'Contraseña' }).fill('Envios@Henric21');
  await page.getByRole('textbox', { name: 'Contraseña' }).dblclick();
  await page.getByRole('textbox', { name: 'Contraseña' }).press('ControlOrMeta+c');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.goto('https://app.enviatodo.com/#NewOrder');
  await page.getByRole('link', { name: ' Tiendas' }).click();
  await page.getByPlaceholder('Buscar...').click();
  await page.getByText('Calle 20 de noviembre #').click();
  await page.getByRole('textbox', { name: 'Nombre del contacto*' }).click();
  await page.getByRole('textbox', { name: 'Calle*' }).click();
  await page.getByRole('spinbutton', { name: 'Código postal*' }).click();
  await page.getByTitle('San Salvador Tizatlalli').click();
  await page.getByTitle('San Salvador Tizatlalli').click();
  await page.getByRole('textbox', { name: 'Referencia*' }).click();
  await page.getByRole('textbox', { name: 'Referencia*' }).click();
  await page.getByTitle('San Salvador Tizatlalli').click();
  await page.getByRole('treeitem', { name: 'San Salvador Tizatlalli' }).click();
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
});