# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: flujo_20260527_1236.ts >> flujo enviatodo ordenes tiendas
- Location: flujo_20260527_1236.ts:300:5

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/Dashboard|Órdenes|Cotizador|Crear orden/i)
Expected: visible
Error: strict mode violation: getByText(/Dashboard|Órdenes|Cotizador|Crear orden/i) resolved to 4 elements:
    1) <span>Dashboard</span> aka getByRole('link', { name: ' Dashboard' })
    2) <span>Cotizador</span> aka getByRole('link', { name: ' Cotizador' })
    3) <span>Órdenes</span> aka getByRole('link', { name: ' Órdenes' })
    4) <button class="et-btn et-lg-btn et-main-btn et-create-order">Crear orden</button> aka getByRole('button', { name: 'Crear orden' })

Call log:
  - Expect "toBeVisible" with timeout 30000ms
  - waiting for getByText(/Dashboard|Órdenes|Cotizador|Crear orden/i)

```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]:
      - complementary [ref=e5]:
        - link "Enviatodo" [ref=e8] [cursor=pointer]:
          - /url: "#MyKPI"
          - img "Enviatodo" [ref=e9]
        - list [ref=e11]:
          - listitem [ref=e12]:
            - link " Dashboard" [ref=e13] [cursor=pointer]:
              - /url: "#MyKPI"
              - generic [ref=e14]: 
              - generic [ref=e15]: Dashboard
          - listitem [ref=e16]:
            - link " Cotizador" [ref=e17] [cursor=pointer]:
              - /url: "#"
              - generic [ref=e18]: 
              - generic [ref=e19]: Cotizador
            - text:  
          - listitem [ref=e20]:
            - link " Órdenes" [ref=e21] [cursor=pointer]:
              - /url: "#"
              - generic [ref=e22]: 
              - generic [ref=e23]: Órdenes
            - text:   
          - listitem [ref=e24]:
            - link " Envíos" [ref=e25] [cursor=pointer]:
              - /url: "#SearchShipping"
              - generic [ref=e26]: 
              - generic [ref=e27]: Envíos
          - listitem [ref=e28]:
            - link " Estados de cuenta" [ref=e29] [cursor=pointer]:
              - /url: "#"
              - generic [ref=e30]: 
              - generic [ref=e31]: Estados de cuenta
            - text:    
          - listitem [ref=e32]:
            - link " Configuración" [ref=e33] [cursor=pointer]:
              - /url: "#"
              - generic [ref=e34]: 
              - generic [ref=e35]: Configuración
            - text:        
          - listitem [ref=e36]:
            - button " Cerrar sesión" [ref=e37] [cursor=pointer]:
              - generic [ref=e38]: 
              - generic [ref=e39]: Cerrar sesión
      - banner [ref=e42]:
        - generic [ref=e43]:
          - button "Crear orden" [ref=e45] [cursor=pointer]
          - generic [ref=e46]:
            - generic [ref=e48]: $
            - button "+" [ref=e50] [cursor=pointer]:
              - generic [ref=e51]: +
          - button "" [ref=e53] [cursor=pointer]:
            - generic [ref=e54]: 
          - button "" [ref=e56] [cursor=pointer]:
            - generic [ref=e57]: 
          - generic [ref=e59] [cursor=pointer]: S
          - text: 
    - generic:
      - generic:     
    - text:       
  - text:  
  - region "Chat Widget" [ref=e62]:
    - iframe [ref=e63]:
      - button "Abrir live chat" [ref=f8e5]:
        - img [ref=f8e8]
        - img [ref=f8e15]
```

# Test source

```ts
  13  | 
  14  | const TEXTO_BUSQUEDA_PEDIDO = 'Edgar Garcia Granados';
  15  | const TEXTO_DESTINO = 'Oriente l07 3370 BPHO1';
  16  | const COLONIA_OBJETIVO = 'San Salvador Tizatlalli';
  17  | 
  18  | // ============================
  19  | // HELPERS
  20  | // ============================
  21  | 
  22  | async function esperarCarga(page: Page) {
  23  |   await page.waitForLoadState('domcontentloaded').catch(() => {});
  24  |   await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  25  | }
  26  | 
  27  | async function diagnostico(page: Page, etiqueta: string) {
  28  |   const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  29  | 
  30  |   console.log('');
  31  |   console.log('=====================================');
  32  |   console.log(`DIAGNÓSTICO: ${etiqueta}`);
  33  |   console.log('URL:', page.url());
  34  |   console.log('Crear orden:', await page.getByText(/Crear orden/i).isVisible().catch(() => false));
  35  |   console.log('Órdenes:', await page.getByText('Órdenes', { exact: true }).isVisible().catch(() => false));
  36  |   console.log('Tiendas:', await page.getByText('Tiendas', { exact: true }).isVisible().catch(() => false));
  37  |   console.log('Sincronizar órdenes:', await page.getByText(/Sincronizar órdenes/i).isVisible().catch(() => false));
  38  |   console.log('Configurar Órdenes:', await page.getByText(/Configurar Órdenes/i).isVisible().catch(() => false));
  39  |   console.log('Cantidad Buscar:', await page.getByPlaceholder('Buscar...').count().catch(() => 0));
  40  |   console.log('=====================================');
  41  |   console.log('');
  42  | 
  43  |   await page.screenshot({
  44  |     path: `screenshots/${etiqueta}_${timestamp}.png`,
  45  |     fullPage: true
  46  |   }).catch(() => {});
  47  | }
  48  | 
  49  | async function clickMenuLateralPorTexto(page: Page, texto: string) {
  50  |   const clicked = await page.evaluate((textoBuscado) => {
  51  |     const limpiar = (txt: string) =>
  52  |       txt
  53  |         .replace(/\s+/g, ' ')
  54  |         .trim()
  55  |         .toLowerCase();
  56  | 
  57  |     const objetivo = limpiar(textoBuscado);
  58  | 
  59  |     const candidatos = Array.from(
  60  |       document.querySelectorAll('a, button, div, span, li')
  61  |     ).filter((el) => {
  62  |       const rect = el.getBoundingClientRect();
  63  |       const texto = limpiar(el.textContent || '');
  64  | 
  65  |       return (
  66  |         texto === objetivo &&
  67  |         rect.width > 0 &&
  68  |         rect.height > 0 &&
  69  |         rect.left < 280
  70  |       );
  71  |     });
  72  | 
  73  |     const elemento = candidatos[0];
  74  | 
  75  |     if (elemento) {
  76  |       (elemento as HTMLElement).click();
  77  |       return true;
  78  |     }
  79  | 
  80  |     return false;
  81  |   }, texto);
  82  | 
  83  |   if (!clicked) {
  84  |     throw new Error(`No se pudo hacer clic en el menú lateral: ${texto}`);
  85  |   }
  86  | }
  87  | 
  88  | async function asegurarLogin(page: Page) {
  89  |   await page.goto('https://app.enviatodo.com/#NewOrder', {
  90  |     waitUntil: 'domcontentloaded'
  91  |   });
  92  | 
  93  |   await esperarCarga(page);
  94  | 
  95  |   const emailVisible = await page
  96  |     .getByRole('textbox', { name: 'Correo electrónico' })
  97  |     .isVisible({ timeout: 5000 })
  98  |     .catch(() => false);
  99  | 
  100 |   if (emailVisible) {
  101 |     console.log('Login detectado. Iniciando sesión...');
  102 | 
  103 |     await page.getByRole('textbox', { name: 'Correo electrónico' }).click();
  104 |     await page.getByRole('textbox', { name: 'Correo electrónico' }).fill('riospenasebastian@gmail.com');
  105 | 
  106 |     await page.getByRole('textbox', { name: 'Contraseña' }).click();
  107 |     await page.getByRole('textbox', { name: 'Contraseña' }).fill('Envios@Henric21');
  108 | 
  109 |     await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  110 | 
  111 |     await esperarCarga(page);
  112 | 
> 113 |     await expect(page.getByText(/Dashboard|Órdenes|Cotizador|Crear orden/i)).toBeVisible({
      |                                                                              ^ Error: expect(locator).toBeVisible() failed
  114 |       timeout: 30000
  115 |     });
  116 |   } else {
  117 |     console.log('Sesión reutilizable detectada. No hizo falta login.');
  118 |   }
  119 | 
  120 |   await diagnostico(page, '01_despues_login_o_sesion');
  121 | }
  122 | 
  123 | async function irAOrdenesTiendas(page: Page) {
  124 |   for (let intento = 1; intento <= 5; intento++) {
  125 |     console.log(`Intentando ir a Órdenes > Tiendas. Intento ${intento}/5`);
  126 | 
  127 |     await diagnostico(page, `02_antes_ordenes_intento_${intento}`);
  128 | 
  129 |     // Esperar que exista el menú lateral
  130 |     await expect(page.getByText(/Dashboard|Órdenes|Cotizador/i)).toBeVisible({
  131 |       timeout: 30000
  132 |     });
  133 | 
  134 |     // 1. Clic en Órdenes para abrir el desplegable
  135 |     console.log('Clic en Órdenes para abrir desplegable...');
  136 |     await clickMenuLateralPorTexto(page, 'Órdenes');
  137 | 
  138 |     // 2. Esperar que aparezca Tiendas en el submenú
  139 |     await expect(page.getByText('Tiendas', { exact: true })).toBeVisible({
  140 |       timeout: 15000
  141 |     });
  142 | 
  143 |     await page.waitForTimeout(700);
  144 | 
  145 |     // 3. Clic en Tiendas
  146 |     console.log('Clic en Tiendas...');
  147 |     await clickMenuLateralPorTexto(page, 'Tiendas');
  148 | 
  149 |     // 4. Esperar carga real de la sección Tiendas
  150 |     await esperarCarga(page);
  151 | 
  152 |     await diagnostico(page, `03_despues_click_tiendas_intento_${intento}`);
  153 | 
  154 |     const cargoTiendas =
  155 |       await page.getByText(/Sincronizar órdenes/i).isVisible({ timeout: 12000 }).catch(() => false) ||
  156 |       await page.getByText(/Configurar Órdenes/i).isVisible({ timeout: 12000 }).catch(() => false) ||
  157 |       await page.getByRole('button', { name: /Sincronizar/i }).isVisible({ timeout: 12000 }).catch(() => false) ||
  158 |       await page.getByRole('button', { name: /Asignar paquete/i }).isVisible({ timeout: 12000 }).catch(() => false);
  159 | 
  160 |     if (cargoTiendas) {
  161 |       console.log('Tiendas cargó correctamente.');
  162 |       return;
  163 |     }
  164 | 
  165 |     console.log('Tiendas aún no cargó. Reintentando...');
  166 |     await page.waitForTimeout(1500);
  167 |   }
  168 | 
  169 |   await diagnostico(page, 'ERROR_no_cargo_tiendas');
  170 | 
  171 |   throw new Error('No se pudo cargar Órdenes > Tiendas.');
  172 | }
  173 | 
  174 | async function buscarPedido(page: Page, textoBusqueda: string) {
  175 |   await diagnostico(page, '04_antes_buscar_pedido');
  176 | 
  177 |   const buscadores = page.getByPlaceholder('Buscar...');
  178 |   const totalBuscadores = await buscadores.count();
  179 | 
  180 |   console.log('Cantidad de buscadores encontrados:', totalBuscadores);
  181 | 
  182 |   if (totalBuscadores === 0) {
  183 |     throw new Error('No se encontró el buscador Buscar...');
  184 |   }
  185 | 
  186 |   // En Tiendas suele haber 2 buscadores:
  187 |   // - uno arriba en sincronizar órdenes
  188 |   // - otro en la tabla de configurar órdenes
  189 |   // El de la tabla normalmente es el último.
  190 |   const buscadorPedidos = buscadores.nth(totalBuscadores - 1);
  191 | 
  192 |   await expect(buscadorPedidos).toBeVisible({ timeout: 20000 });
  193 |   await buscadorPedidos.click();
  194 |   await buscadorPedidos.fill('');
  195 |   await page.waitForTimeout(300);
  196 |   await buscadorPedidos.fill(textoBusqueda);
  197 | 
  198 |   await page.waitForTimeout(1500);
  199 | 
  200 |   await diagnostico(page, '05_despues_buscar_pedido');
  201 | 
  202 |   await expect(page.getByText(textoBusqueda, { exact: false }).first()).toBeVisible({
  203 |     timeout: 15000
  204 |   });
  205 | }
  206 | 
  207 | async function abrirDestino(page: Page, textoDestino: string) {
  208 |   const destino = page.getByText(textoDestino, { exact: false }).first();
  209 | 
  210 |   if (await destino.isVisible({ timeout: 15000 }).catch(() => false)) {
  211 |     await destino.click();
  212 |     await page.waitForTimeout(1000);
  213 |     return;
```