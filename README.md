# KUKUNE · Análisis de Pedido

App de escritorio web para calcular costos y márgenes de perfumes, réplica de la
hoja **AnalisisPedido** del Excel original. Permite editar cualquier dato, agregar,
duplicar y eliminar perfumes, y ver en vivo el precio que queda en la mano y el
margen neto para decidir el precio de venta.

## Requisitos

- Node.js 18 o superior

## Cómo correrla

```bash
npm install
npm run dev
```

Abrí la URL que muestra la terminal (por defecto http://localhost:5173).

Para generar la versión de producción:

```bash
npm run build      # genera la carpeta dist/
npm run preview    # sirve dist/ para probar
```

## Dónde se guardan los datos

En un archivo de verdad, dentro de la carpeta del proyecto:

```
datos/
  analisis-pedido.json       ← tus perfumes y parámetros
  analisis-pedido.bak.json   ← la versión anterior, por las dudas
```

Como la carpeta está sincronizada por OneDrive, ese archivo tiene copia en la
nube e **historial de versiones**: si algo sale mal, clic derecho sobre el
archivo → *Historial de versiones* y volvés a una versión anterior.

Se guarda solo, un segundo después de cada cambio. La escritura es atómica
(se escribe a un `.tmp` y recién ahí se renombra), así que nunca queda un
archivo a medio escribir aunque se corte la luz.

El `localStorage` del navegador se sigue usando, pero solo como caché para que la
pantalla aparezca al instante. **El archivo manda.** Podés borrar los datos del
sitio en el navegador y no perdés nada.

Si abrís la app sin el servidor corriendo, no hay archivo: ahí guarda solo en el
navegador y te lo avisa en el pie de la tabla. En ese caso conviene usar
**Exportar** para llevarte un respaldo.

## Catálogo en PDF para el proveedor

Cada perfume tiene una columna **Foto**: tocá el recuadro para elegir una imagen
(se achica sola antes de guardarse) y la crucecita para sacarla.

El botón **PDF proveedor** de la cabecera descarga un catálogo con la foto, el
nombre y la cantidad de cada perfume — sin precios ni márgenes. Salen
**solamente las filas con Incluir en SÍ**. Los perfumes sin foto aparecen igual,
con un recuadro que dice "sin foto".

Las fotos se guardan en el mismo `localStorage` que el resto, que tiene unos
pocos MB. Si se llena, la app avisa con un cartel rojo y hay que sacar alguna
foto para poder seguir guardando.

## Estructura

```
src/
  App.jsx             → la app (cálculo + UI)
  pdf.js              → armado del catálogo PDF para el proveedor
  almacenamiento.js   → cliente del guardado en archivo
  main.jsx            → punto de entrada React
  index.css           → Tailwind + fuente
vite-plugin-datos.js  → lee/escribe datos/analisis-pedido.json (/api/datos)
index.html            → carga la fuente Montserrat
```

## Fórmulas (idénticas al Excel)

- Factor de Gasto = Costos Extras ÷ Inversión Total (USD)
- Costos Extras (ARS) = Comisión Red (USD) × Dólar + Envío Correo
- Precio sin Ganancia (ARS) = Costo Base (USD) × Dólar + Costos Extra
- Comisión ML = Precio Final × % Comisión ML (por defecto 15,32 %)
- Costo Total Venta ML = Comisión ML + Envío ML + (Precio Final × Otras Comisiones)
- Ganancia Bruta = si vende por ML → Precio Final − Costo Venta ML; si no → Precio Final
- Ganancia Neta = Ganancia Bruta − Precio sin Ganancia
- Margen % = Ganancia Neta ÷ Precio sin Ganancia
- Totales: suman solo las filas con "Incluir" tildado

## Próximos pasos sugeridos

- Exportar a Excel / CSV
- Importar productos desde Tiendanube
- Precio sugerido según un margen objetivo
