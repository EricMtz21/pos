# POS Offline

Punto de venta de escritorio que funciona **sin conexión a internet**. Pensado para
un mostrador real: vender es rápido, se opera con el teclado y los datos viven en un
archivo local que puedes respaldar copiando y pegar.

![Pantalla de ventas](docs/ventas.png)

## Características

- **Venta en segundos.** Escaneas, cobras, imprimes: `F2` → escanear → `F12` → cobrar.
  El lector de código de barras USB funciona sin instalar nada.
- **Funciona sin internet.** Toda la operación es local; no hay servidor ni cuenta que crear.
- **Inventario** con precios, costos, márgenes, categorías y alertas de stock bajo.
- **Métodos de pago:** efectivo (con cálculo de cambio), débito, crédito, transferencia y
  pago mixto.
- **Comisiones de tarjeta configurables por tramos**, con el porcentaje que baja según el
  volumen acumulado del mes. Al cobrar ves cuánto recibe realmente el negocio.
- **Ticket** para impresora térmica de 58 u 80 mm, o exportado a PDF.
- **Reportes por rango de fechas** con desglose por método de pago, productos más vendidos
  y exportación a Excel.
- **Corte de caja** con arqueo: compara lo que debería haber en el cajón contra lo que
  contaste y registra la diferencia.
- **Modo claro y oscuro**, con acento configurable.

## Cómo funcionan los precios

El precio que capturas es **el que paga el cliente, con IVA incluido**. A partir de él
el sistema deriva el precio sin IVA y el margen sobre el costo de compra:

| Campo | Significado |
|---|---|
| Precio al público | Lo que cobras. Incluye IVA. |
| Sin IVA | Calculado a partir del precio y la tasa. |
| Costo | Lo que te costó el producto. |
| Margen | Sobre el precio **sin IVA**: el impuesto no es ganancia. |

Todo el dinero se guarda y se calcula en centavos enteros, no en decimales flotantes,
para que los totales no arrastren errores de redondeo.

## Atajos de teclado

Cada botón muestra su atajo. `F1` abre la lista completa desde cualquier pantalla.

| Tecla | Acción |
|---|---|
| `F1` | Ayuda: lista de atajos |
| `F2` | Nueva venta / enfocar el escáner |
| `F3` | Buscar producto |
| `F8` | Cancelar la venta en curso |
| `F12` | Cobrar |
| `Ctrl+N` | Nuevo producto |
| `Ctrl+P` | Reimprimir el último ticket |
| `Ctrl+I` | Ir a Inventario |
| `Ctrl+R` | Ir a Reportes |
| `Ctrl+B` | Corte de caja |
| `Ctrl+E` | Exportar el reporte a Excel |
| `Ctrl+,` | Ir a Ajustes |
| `Ctrl+D` | Alternar modo claro/oscuro |
| `+` / `-` | Cambiar la cantidad del artículo seleccionado |
| `Supr` | Quitar el artículo del carrito |
| `Esc` | Cerrar o cancelar |

## Inventario

![Inventario](docs/inventario.png)

Alta de productos manual o por código de barras, búsqueda y filtros, ajustes de stock
con motivo registrado, y baja lógica: un producto desactivado desaparece de la venta
pero las ventas anteriores lo conservan.

## Reportes y corte de caja

![Reportes](docs/reportes.png)

Los reportes se filtran por rango de fechas y separan lo que vendiste de lo que
**realmente recibes**: cada método de pago muestra su bruto, su comisión y su neto.
Un pago mixto se reparte correctamente entre efectivo y tarjeta.

El corte de caja calcula cuánto debería haber en el cajón (fondo inicial + ventas en
efectivo) y lo compara con lo que contaste, registrando el sobrante o el faltante.
Cada corte guarda además un respaldo automático de la base de datos.

La exportación a Excel genera un libro con seis hojas: resumen, ventas por día,
métodos de pago, productos, detalle de ventas y cortes de caja. Los importes van en
pesos con formato de moneda, listos para usar en fórmulas.

## Instalación para desarrollo

Requiere **Node.js 22.12 o superior**.

```bash
git clone https://github.com/EricMtz21/pos.git
cd pos
npm install
npm run dev
```

Para arrancar con datos de ejemplo (ocho productos, dos de ellos con stock bajo):

```bash
# Windows (PowerShell)
$env:POS_SEED=1; npm run dev

# macOS y Linux
POS_SEED=1 npm run dev
```

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Arranca la app con recarga en caliente |
| `npm run build` | Compila a `out/` |
| `npm test` | Pruebas de la lógica de negocio y la capa de datos |
| `npm run smoke` | Prueba de interfaz: maneja el inventario en la app real |
| `npm run smoke:sales` | Prueba de interfaz: flujo completo de venta |
| `npm run smoke:reports` | Prueba de interfaz: reportes, corte de caja y exportación |

## Dónde viven los datos

La base de datos SQLite se guarda **fuera** del paquete de la aplicación, en la carpeta
de datos del usuario:

| Sistema | Ruta |
|---|---|
| Windows | `%APPDATA%\pos-offline\pos.sqlite` |
| macOS | `~/Library/Application Support/pos-offline/pos.sqlite` |
| Linux | `~/.config/pos-offline/pos.sqlite` |

Esto significa que **actualizar la aplicación no borra la información**. El esquema se
migra solo al arrancar, y antes de cada migración se guarda un respaldo automático en
la subcarpeta `backups/`.

Para mover el negocio a otra computadora basta copiar ese archivo `.sqlite`.

La variable de entorno `POS_DATA_DIR` permite apuntar los datos a otra carpeta, útil
para pruebas o para una instalación portable.

## Estructura

```
src/
├─ main/            Proceso principal (Node)
│  ├─ db/           Conexión, migraciones, respaldos y repositorios
│  ├─ ipc/          Puente con la interfaz
│  ├─ export-excel.js
│  └─ ticket-print.js
├─ preload/         API segura expuesta a la interfaz
├─ renderer/        Interfaz (HTML, CSS y JS sin framework)
│  ├─ views/        Ventas, inventario, reportes, ajustes
│  ├─ shortcuts/    Infraestructura de atajos
│  ├─ styles/       Temas y componentes
│  └─ icons/        Iconos locales
└─ shared/
   └─ business/     Cálculo de totales, comisiones y ticket (funciones puras)
```

Los cálculos de dinero viven en `shared/business` como funciones puras, para que la
pantalla de cobro y el guardado de la venta usen exactamente la misma aritmética. El
proceso principal siempre recalcula al guardar: nunca confía en lo que le manda la interfaz.

## Estado

Funcionando: ventas, inventario, comisiones de tarjeta, ticket e impresión, reportes
con exportación a Excel y corte de caja.

En camino: pantalla de ajustes, cancelaciones y devoluciones, roles de usuario y
actualizaciones automáticas.

## Tecnologías

Electron · Vite · SQLite (better-sqlite3) · JavaScript sin framework
