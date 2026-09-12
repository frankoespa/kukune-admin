# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# KUKUNE · Análisis de Pedido

## Qué es
App React (Vite + Tailwind) de una sola pantalla que replica la hoja
"AnalisisPedido" de un Excel. Calcula costos y márgenes de perfumes para
un negocio que vende en Mercado Libre y Tiendanube (Argentina, en ARS).

## Comandos
- Instalar: `npm install`
- Desarrollo: `npm run dev` (Vite, puerto 5173)
- Build: `npm run build` (genera `dist/`)
- Preview del build: `npm run preview`

No hay tests, ni ESLint, ni Prettier configurados. La única verificación
automática es `npm run build`; el resto se comprueba a ojo en el navegador.

## Arquitectura
- Casi todo está en `src/App.jsx`: motor de cálculo, formateadores, componentes
  de celda y la pantalla entera. No hay backend, router ni tests.
  `src/main.jsx` solo monta `<App />`.
- Piezas separadas de `App.jsx`: `src/pdf.js` (catálogo PDF), `src/precios.js`
  (precio sugerido por margen), `src/almacenamiento.js` (cliente de los archivos)
  y `src/Catalogo.jsx` (la pantalla del catálogo). La navegación entre pantallas
  es un `useState` (`vista`), no hay router.
- `src/pdf.js`: arma el catálogo para el proveedor con
  jsPDF. Recibe datos planos (`{ producto, cantidad, foto }[]`) y devuelve el
  `doc`, sin tocar React ni el DOM — así se puede generar un PDF de prueba desde
  Node (`node script.mjs` importando el módulo) sin abrir el navegador.
- El motor es `calcular(globals, productos)`: función pura que devuelve
  `{ filas, inversionUsdt, inversionPesos, costosExtras, factorGasto,
  gananciaBrutaTotalGeneral, gananciaNetaTotalGeneral }`. Se ejecuta dentro de
  un `useMemo` sobre `[globals, productos]` y su resultado (`R`) alimenta toda
  la UI. Cada `fila` es el producto original más sus campos calculados.
- **NO cambiar las fórmulas sin pedirlo**: están validadas contra el Excel al
  peso. Los comentarios al costado de cada línea (`// D`, `// H2`, `// J2`) son
  las celdas del Excel original — mantenerlos al tocar el cálculo.
- **Dónde viven los datos**: un archivo por pedido en `datos/pedidos/<id>.json`,
  servido por `vite-plugin-datos.js`. Endpoints: `GET /api/pedidos` (la lista,
  solo metadatos), `GET|PUT /api/pedidos/<id>`, `POST /api/pedidos` (crear),
  `DELETE /api/pedidos/<id>` (**mueve a `datos/papelera/`, no borra**).
  El plugin se engancha con `configureServer` **y** `configurePreviewServer`, así
  que `npm run dev` y `npm run preview` guardan igual. Cada escritura es atómica
  (`.tmp` + `rename`) y rota su `.bak.json`. `src/almacenamiento.js` es el cliente.
- Un archivo por pedido y no uno con todos adentro: cada uno tiene su historial
  de versiones propio en OneDrive y solo se reescribe el que se está tocando.
- **Ya no hay caché en localStorage.** Ahí solo queda `kukune:pedido-activo`, que
  es qué pedido estabas mirando — una preferencia de pantalla, no un dato. La
  caché no servía de nada desde que las fotos también las sirve el server.
- **La guarda contra escritura cruzada es lo más delicado del guardado.** El
  guardado espera 800 ms; si cambiás de pedido antes, el temporizador se
  despertaría con datos de un pedido y los escribiría en el archivo de otro. Por
  eso `pendiente.current` lleva `{ id, json }` y el temporizador compara contra
  `idActivo.current` antes de escribir. Y `guardarPendiente()` fuerza el guardado
  del pedido que se está dejando antes de soltarlo.
- Lo pendiente guarda el pedido **con su nombre**; el `json` que se compara
  contra `jsonInicial` es solo `{globals, productos}`. Si se mezclan, cambiar de
  pedido le borra el nombre al que dejás.
- `abrirPedido(id, datos)` es el único lugar que pone un pedido en pantalla:
  reinicia `jsonInicial`, `yaGuarda` y lo pendiente. Eso es lo que evita que
  abrir o cambiar de pedido dispare un guardado por sí solo.
- El plugin excluye `datos/` del watcher de Vite (`config()`). Sin eso, cada
  guardado automático recarga la página mientras el usuario tipea.
- Estado: dos `useState` (`globals`, `productos`) en `App`.
- **Cuidado con el guardado automático — acá ya se perdieron los datos una vez.**
  El `useEffect` que persiste no escribe mientras el estado siga siendo idéntico
  al que se cargó (`jsonInicial`). No cambiar esa comparación por un contador de
  "primer render": `main.jsx` usa `StrictMode`, que corre los efectos dos veces
  en desarrollo y hace pasar la segunda.
- `nuevoProducto(over)` crea una fila con valores por defecto y `crypto.randomUUID()`.
  Se usa también como plantilla al hidratar desde localStorage o al importar
  (`{ ...nuevoProducto(), ...x }`), así los campos nuevos aparecen en datos viejos.
  `SEED` es la carga inicial de ejemplo (un ARMAF Club de Nuit).
- Export/import de respaldo, vía **portapapeles**: "Exportar" copia
  `{globals, productos}` como JSON; "Importar" abre un modal donde se pega ese
  JSON. No hay Excel/CSV todavía.
- "PDF proveedor" descarga el catálogo (foto + nombre + cantidad, sin precios)
  de las filas con `incluir: true`. El botón se deshabilita si no hay ninguna.

## Pedidos (varias hojas)
- El selector está en una banda propia arriba de la tabla, con Nuevo, Duplicar,
  Renombrar y Borrar.
- **No usar `window.prompt` ni `window.confirm`.** En el navegador embebido de la
  preview `prompt()` lanza "not supported" y `confirm()` devuelve siempre `false`,
  así que los botones que dependían de ellos no hacían nada y sin avisar. Para
  pedir un nombre o confirmar algo está el componente `Dialogo`, que se maneja
  con el estado `dialogo` (`{titulo, texto, conCampo, valor, etiquetaOk, peligro,
  onAceptar}`). Probar esos flujos **clickeando de verdad**: si en la prueba se
  reemplaza `window.prompt`, se verifica la lógica y no el botón.
- **Duplicar** copia perfumes, cantidades y costos con ids de fila nuevos, y
  limpia `precioFinal` y `margenObjetivo` — los precios son de ese pedido, no del
  proveedor. Los globales se heredan del pedido que estabas mirando.
- La migración del pedido único a `datos/pedidos/` corre sola la primera vez y
  **deja `analisis-pedido.json` donde estaba, entero**. No borra nada.
- Borrar un pedido manda a la papelera **el `.json` y su `.bak.json`**, con el
  mismo sello de fecha para que queden juntos. El `.bak` es la versión anterior
  de ese pedido: si lo borraste por error y el principal ya estaba dañado, es lo
  único que queda. Antes solo se movía el principal y el `.bak` quedaba huérfano
  en `pedidos/`, juntando basura de pedidos que ya no existían. Si el `.bak`
  todavía no existe (recién al 2º guardado), el borrado igual funciona y la
  respuesta trae `conRespaldo: false`.

## Catálogo de perfumes
- El nombre y la foto de cada perfume viven **una sola vez** en
  `datos/perfumes.json`; las filas del pedido apuntan por `perfumeId`. En la fila
  queda `producto` como copia del nombre: hace legible el JSON y sirve de red si
  la referencia se rompiera, pero **manda el catálogo**.
- Que "mande el catálogo" hay que hacerlo cumplir: el memo de `productosResueltos`
  reescribe `producto` con el nombre del catálogo antes de que el motor y la UI
  lo vean. Sin ese paso, renombrar en el catálogo no se veía en el pedido —la
  celda mostraba la copia vieja— y el archivo quedaba con el nombre desfasado.
  Cualquier lugar que muestre el nombre debe salir de la lista resuelta, no del
  estado crudo.
- Las fotos son **archivos** en `datos/fotos/<hash>.jpg`, no base64 adentro del
  JSON. El nombre del archivo es el sha1 de su contenido, así que la misma foto
  subida dos veces no se duplica y la URL puede cachearse para siempre
  (`immutable`). Antes de esto el pedido pesaba 714 KB, de los cuales 708 eran
  fotos; ahora pesa 6 KB.
- `ConVistaPrevia` agranda la foto al pasar el mouse, en las dos pantallas. Va
  en un **portal al body** con `position: fixed`: la tabla del pedido scrollea
  por dentro (`overflow: auto`), así que un panel dentro de la celda quedaría
  recortado. Se esconde al scrollear (la posición calculada queda vieja) y lleva
  `pointer-events: none` para no robarle el mouse a la celda.
- La foto **solo se carga en la pantalla del catálogo** (`src/Catalogo.jsx`). En
  el pedido la celda Foto es de solo lectura. Un perfume creado desde el pedido
  nace sin foto: el catálogo tiene un contador "N sin foto" que los filtra.
- **Borrar del catálogo un perfume en uso no decide por el usuario**: el diálogo
  ofrece quitarlo dejando las filas (quedan huérfanas, marcadas en óxido con su
  nombre cacheado y sin foto) o quitarlo borrando esas filas del pedido con sus
  costos. `Dialogo` soporta una `segunda` acción para eso.
- Una fila huérfana (`perfumeId` que ya no existe) se marca en óxido en Producto
  y en Foto. Antes se veía igual que cualquier otra y parecía que borrar del
  catálogo no había hecho nada.
- **El guardado del catálogo marca `catalogoInicial` al programar la escritura,
  no al confirmarla.** Si se esperara la respuesta del PUT, un cambio hecho
  mientras la escritura anterior está en vuelo se compara contra una marca vieja;
  si ese cambio devuelve el catálogo a una forma ya guardada, la comparación da
  igual y el guardado se saltea en silencio. Pasaba al crear un perfume y
  borrarlo enseguida: la pantalla lo sacaba y el archivo se lo quedaba.
- La migración del formato viejo corre sola en el plugin la primera vez que falta
  `perfumes.json`, y deja `analisis-pedido.pre-catalogo.json` con el original
  entero. No borra nada.
- `comprimirImagen()` sigue achicando a 700 px / calidad 0.72 antes de subir.
  Formatos que el navegador no decodifica (HEIC de iPhone) hacen fallar
  `createImageBitmap`; la fila del catálogo lo marca con borde rojo y un `title`.
- El PDF necesita los bytes: `fotoComoDataUrl()` trae el archivo y lo pasa a data
  URL antes de armar el documento, solo para las filas incluidas. Por eso
  `exportarPDF` es asíncrono y el botón muestra "Armando…".
- El botón "N sin foto" sigue visible mientras el filtro esté puesto, aunque el
  contador llegue a cero (ahí dice "Ver todos"). Si se ocultara al cargar la
  última foto, el filtro quedaría activo sin forma de apagarlo. Vale para
  cualquier filtro cuyo botón dependa de que haya resultados.
- La lista del catálogo **no se reordena mientras se escribe un nombre**. El
  orden alfabético se recalcula solo cuando cambia el conjunto visible (alta,
  baja o búsqueda), usando como clave los ids ordenados. Si se ordenara por
  nombre, cada tecla mueve la fila y se va de abajo del cursor. Se reacomoda al
  agregar o borrar algo, al buscar, o al volver a entrar a la pantalla.
- **Todo lo que se despliegue desde una celda va en un portal al body**, con
  `position: fixed` y posición calculada del `getBoundingClientRect()` del campo:
  la lista de `BuscadorPerfume` y la vista previa de la foto. Dentro de la celda
  quedan recortadas por el `overflow` del contenedor de la tabla — la lista se
  veía cortada por abajo. La lista se abre hacia arriba si no entra abajo, sigue
  al campo al scrollear, y los botones usan `onMouseDown` con `preventDefault`
  para que el clic gane al `blur` que cierra.
- `BuscadorPerfume` es la celda Producto: busca por palabras sueltas y sin
  acentos (`buscarPerfumes` en `Catalogo.jsx`), y si no hay coincidencia ofrece
  crear la entrada con ese nombre. El nombre no se tipea libre.

## Precios del catálogo
- Cada perfume tiene `costo` y `precioPublico` (venta directa), **puestos a mano**.
  No se sugieren desde el último pedido: el costo de un pedido es lo que cobró
  ESE proveedor en ESA compra, y el del catálogo es la referencia actual.
- `analisisDePrecio()` en `src/precios.js` devuelve tres cosas: el margen sobre
  el costo (misma definición que la columna Margen de los pedidos, así que los
  números son comparables), **a cuánto publicar en ML para ganar lo mismo** que
  vendiendo directo, y cuánto quedaría si se publicara el precio directo tal cual
  en ML.
- De esos tres, en pantalla van **dos**: el margen y el precio de ML. El tercero
  vive en el tooltip. Estaban los dos últimos apilados en la misma celda y se
  leían como una contradicción ("el precio para ganar lo mismo" arriba, "perdés
  17%" abajo), porque el rótulo no decía a qué precio se refería cada uno. Cada
  número visible tiene que contestar una sola pregunta y decir cuál es.
- La comisión y el envío de ML del catálogo viven en `perfumes.json` bajo
  `ajustes`, no en cada pedido: el precio de lista no depende de a quién le
  compraste. `AJUSTES_POR_DEFECTO` está en `almacenamiento.js`.
- **"Pasar costos al catálogo"** (banda de acciones del pedido) copia el Precio
  sin Ganancia de las filas **incluidas** al `costo` del perfume: es el mismo
  número (costo del proveedor × dólar + su parte de los costos extras), así que
  no hay conversión ninguna, solo el traslado. Ofrece dos salidas y no elige por
  el usuario: **Reemplazar** (este pedido es la referencia nueva) o **Promediar**
  50/50 con el costo guardado, que es la cuenta que se hacía a mano cuando el
  mismo perfume se le compró a dos proveedores. "Promediar" solo aparece si
  algún perfume ya tenía costo.
- Si el mismo perfume aparece en dos filas del pedido, se promedia **por unidad**
  (ponderado por cantidad) antes de llegar al catálogo: el costo del catálogo es
  por unidad, no por fila. Las filas huérfanas se saltean solas.
- El diálogo muestra **todos** los perfumes que va a tocar, en una caja con
  scroll propio (`max-h-[42vh]`), no una muestra de los primeros: es la
  referencia para decidir, y recortada obliga a aceptar a ciegas.
- Van las **tres cifras en columnas**: *En el catálogo* (lo que hay hoy), *Este
  pedido* (lo que viaja) y *Promedio* (cómo quedaría promediando). Cada botón
  deja la columna que lleva su nombre, y eso lo dice el texto de arriba. En
  columnas y no en una frase con flechas porque lo que se hace es comparar una
  contra otra; envueltas en renglones no se sabe cuál es de cuál.
- La grilla es **una sola constante** (`COLUMNAS_COSTO`) para el encabezado y las
  filas, y el encabezado va **adentro** de la caja que scrollea, sticky: afuera,
  el ancho de la barra de scroll le corre las columnas y dejan de alinear.
- El aviso del resultado vuelve como texto en el propio botón durante unos
  segundos, no como un segundo diálogo.
- `Dialogo` acepta `ancho` (una clase `max-w-*`, por defecto `max-w-md`) y pone
  en cero el scroll de todo lo que lleve `data-scroll` cada vez que se abre: el
  navegador conserva el scroll y la lista aparecía empezada por el medio.

- El orden "Por margen" **no se congela** como el alfabético, porque mira los
  precios: es para revisar, no para escribir. Los sin precio van al final.
- "PDF de precios" (`construirPDFPrecios`) es para clientes: nombre, foto y
  **precio de venta directa**, nunca el de ML ni el margen. Acá sí va la marca
  KUKUNE, al contrario del PDF del proveedor.
- Va en **filas, no en cuadrícula**: foto, nombre y precio alineado a la derecha.
- **La perilla es `FILAS_POR_PAGINA` (hoy 7), no el tamaño de la foto.** De ahí
  salen `ALTO_FILA` y `FOTO_LADO` repartiendo el alto útil de la hoja. Está al
  revés a propósito: "quiero ver 9 por hoja" es la decisión real y el tamaño de
  la foto es la consecuencia. Subir el número achica la foto, y no hay forma de
  desbordar la página. Hoy: fila de 35mm, foto de 31mm, última fila en y=277 de
  297. **Ojo al hablarlo con el usuario: decir siempre la unidad** — se pidió
  "probá en 9" pensando en filas y se interpretó como 9mm de foto. El ancho disponible para el nombre se
  calcula **restando el ancho del precio ya medido** (`getTextWidth`) más 8mm de
  aire, así que un nombre largo se corta antes de invadirlo — verificado sobre
  los 34 del catálogo más un nombre de 95 caracteres y un precio de 8 dígitos:
  el menor aire fue 8,2mm (ese caso extremo; los nombres reales quedan holgados).
- `dibujarFotoEn(doc, foto, x, y, w, h)` sirve a los dos PDF; `dibujarFoto`
  quedó como el atajo con las medidas de la cuadrícula del proveedor.

## Fórmulas (idénticas al Excel)
- Factor de Gasto = Costos Extras (ARS) ÷ Inversión Total (USD) → ARS por USD de costo
- Costos Extras (ARS) = Comisión Red (USD) × Dólar + Envío Correo
- Precio sin Ganancia (ARS) = Costo Base (USD) × Dólar + Costos Extra de la fila
- Comisión ML = Precio Final × % Comisión ML (por defecto 15,32 %)
- Costo Total Venta ML = Comisión ML + Envío ML + Precio Final × Otras Comisiones
- Ganancia Bruta = si vende por ML → Precio Final − Costo Venta ML; si no → Precio Final
- Ganancia Neta = Ganancia Bruta − Precio sin Ganancia; Margen % = Neta ÷ Precio sin Ganancia
- Totales generales: suman solo las filas con `incluir` en `true`

## Convenciones
- Idioma de la UI y de los identificadores del dominio: español (Argentina).
- **Paleta y tipografía viven en `src/index.css` como variables** (`--vidrio`,
  `--tinta`, `--ambar`, `--verde`, `--oxido`…). Usarlas, no hardcodear hex nuevos.
  El fondo es sage frío (`#E6E9E3`, vidrio de frasco) y la tinta va corrida al
  marrón (`#22201C`), a propósito: el crema `#FAFAF7` anterior era el default.
- **El ámbar `#B8862F` está reservado para una sola cosa: la ganancia.** Si
  aparece ámbar en pantalla, es plata que le queda al usuario. No usarlo de
  acento decorativo.
- Dos familias, con roles fijos: **Montserrat** para marca y rótulos, **IBM Plex
  Mono** (clase `.k-num`) para *toda* cifra. Los helpers de clase están en
  `index.css`: `.k-num`, `.k-rotulo` (rótulo de sección), `.k-col` (encabezado
  de columna y unidades).
- La firma de la pantalla es `BarraDelPedido`: descompone a dónde va cada peso
  del pedido. Los tramos se reparten con `flex-grow` normalizado a fracción
  (`(valor/base).toFixed(6)`), **no** con `width` en porcentaje ni con el importe
  crudo — con importes del orden del millón React los serializa en notación
  científica (`1.3603e+06`) y CSS no la toma.
  `descomponerIngreso()` no agrega fórmulas: suma las que ya devuelve `calcular()`,
  y la identidad cierra exacta (`ingresos − costo − comisión − envío − otras = neta`).
  Con pérdida, la barra pasa a medir el costo total y una zona rayada marca lo
  que el precio de venta no cubre; así los tramos suman 100% en los dos casos.
- Al medir la barra desde la consola, seleccionarla por su `aria-label`: los
  iconos de lucide también llevan `role="img"` y un `querySelector('[role=img]')`
  agarra un icono de la cabecera.
- Los porcentajes se guardan como **fracción** en el estado (`comisionML: 0.1532`,
  `otrasComis: 0`) y se multiplican/dividen por 100 solo en el `NumberCell`.
- **`globals.monedaPedido`** (`"USD" | "ARS"`) dice en qué moneda cobra el
  proveedor de ese pedido. **No entra en ninguna fórmula**: con `"ARS"` el
  `precioUsdt` queda en 1 y el motor es el mismo de siempre. Lo único que cambia
  son los rótulos (`monedaCosto`), el formateador de las columnas de costo
  (`montoCosto`) y que el campo Dólar y el indicador "Inversión USD" se ocultan.
  Los pedidos guardados antes de que existiera el campo se migran una sola vez
  en `normalizarEstado()`: si no hay `monedaPedido` y el dólar está en 1, era un
  pedido en pesos.
- **Precio sugerido por margen** (`src/precios.js`): `margenObjetivo` en el
  producto (fracción, o `null` = precio a mano). Si tiene valor, el Precio Final
  se despeja de ahí. `resolverPrecios()` corre **antes** de `calcular()` y le
  pasa la lista con los precios ya resueltos, así que el motor no se entera y no
  hubo que tocarlo. No hay circularidad: el Factor de Gasto y el Precio sin
  Ganancia salen de cantidades y costos, nunca del precio de venta.
- Lo que se guarda, exporta y va al PDF es **`productosResueltos`**, no el estado
  crudo: el precio de una fila clavada vive en la lista derivada. Por eso al
  soltar el margen hay que devolverle el precio resuelto al estado en el mismo
  `setProductos` (`soltarMargen`) — si no, la fila vuelve al precio viejo.
- `resolverPrecios()` devuelve **el mismo array** si no cambió ningún precio, para
  no invalidar los `useMemo` de arriba ni disparar un guardado al abrir.
- El redondeo del precio sugerido no es fijo: un peso mueve el margen en
  `k/precioSinGanancia`, así que con costos base muy chicos redondear a peso
  entero desviaba el margen hasta 2 pp (pedías 30% y veías 32%). Cuando el
  desvío superaría 0,05 pp se guardan centavos.
- El botón masivo **no pisa las filas con precio puesto a mano** (`margenObjetivo
  == null && precioFinal > 0`); sí recalcula las ya clavadas.
- El **Factor de Gasto** se muestra como porcentaje (`costosExtras /
  inversionPesos`) con el valor crudo debajo en chico. El crudo (ARS por unidad
  de costo) es ilegible en pedidos en pesos, donde da "$ 0,01"; el porcentaje se
  lee igual en los dos modos y permite comparar pedidos entre sí. La fórmula no
  cambia: `calcular()` sigue devolviendo el mismo `factorGasto`.
- `pct()` formatea con `Intl` en es-AR (coma decimal) y acepta la cantidad de
  decimales como segundo argumento.
- Editable vs calculado se distingue por **caja, no por color de fondo**: lo que
  se edita es una caja blanca con borde (`NumberCell` / `TextCell` / `CheckCell`),
  lo calculado va suelto sobre la fila, sin caja (`CalcCell`, con
  `tone="pos" | "neg"`). Antes era blanco vs gris.
- **`NumberCell` vive en `src/NumberCell.jsx`, compartido** por la tabla de
  pedidos y el catálogo; el parseo está en `src/numeros.js` (`aNumero`, puro y
  testeable desde Node). No escribir `<input>` de número a mano en ninguna
  pantalla: el catálogo lo hizo y perdió el string local mientras se escribe.
- Mantiene un string local mientras el campo tiene foco (`focused` ref) para no
  pelear con lo que se está tipeando. **La coma es el decimal; el punto se deja
  tal cual**, así que "38.155" son 38,155 y no 38155. Se probó interpretarlo como
  separador de miles y **se volvió atrás a pedido del usuario**: la regla para
  distinguir "38.155" (miles) de "15.32" (decimal) mira la cantidad de dígitos
  del grupo, funciona, pero es sutil y no la tenés en la cabeza cuando algo sale
  raro. No reponerla sin preguntar.
- Por eso los porcentajes del catálogo usan `pctSinMiles` (`useGrouping: false`):
  un costo cargado como 38,155 en vez de 38.155 da 117840% de margen, y con
  agrupación `Intl` lo escribía **"117.840%"**, indistinguible de 117,8%. Sin
  agrupar, el error de carga se ve. **Esta parte sí queda**: es la red que hace
  visible el problema que el parseo simple no evita.
- Montos con `Intl.NumberFormat("es-AR")` mediante los helpers `ars` (0 decimales),
  `arsExact` (2), `usd` y `pct`.
- Para colores que deben verse sí o sí, usar estilos en línea (`style={{...}}`),
  no clases Tailwind con valores arbitrarios (`bg-[#...]`). En este proyecto con
  Tailwind real las arbitrarias funcionan, pero el `CheckCell` usa inline por historia.

## Al tocar la tabla
- Tiene 21 columnas, en este orden: **Incluir**, Producto, Foto, Cantidad, y
  después los grupos. **Margen va pegado a Precio Final** (dentro del grupo
  "Venta · Mercado Libre", no en "Resultado"): son un par que se maneja junto y
  el componente `ParPrecioMargen` renderiza las dos celdas. Si agregás o sacás
  una columna hay que actualizar, además del `<ColHead>` y el `<td>`: los
  `colSpan` de `<GroupHead>` (4 + 5 + 7 + 4 + 1),
  el `colSpan={21}` del estado vacío y el del `<tfoot>`.
- El encabezado es sticky en dos niveles: `GroupHead` en `top: 0` y `ColHead`
  pegado a `ALTO_GRUPOS`. Esa constante **impone** el alto de la fila de grupos
  (`height`) y a la vez es el offset del `ColHead`, así que no pueden
  desalinearse. Antes era un `top-[33px]` escrito a mano contra una fila que
  medía 31px.
- **El `max-height: calc(100vh - 5rem)` del contenedor no es cosmético**: es lo
  que hace que ese sticky funcione. El contenedor es el scrollport de los
  `sticky` de adentro (tiene `overflow-y: auto`), y sin alto máximo su
  `scrollHeight` es igual al `clientHeight`, nunca scrollea por dentro y los
  encabezados se van de pantalla con la página. Si se saca el `max-height`, los
  encabezados dejan de pegarse.
- No encadenar estos offsets con los de la barra espejo: esa se pega al viewport
  de la página y estos al contenedor. Son sistemas de coordenadas distintos.
- `ScrollEspejo` es una copia de la barra de scroll horizontal, pegada arriba y
  sincronizada en los dos sentidos con `objetivo` (el contenedor de la tabla).
  Existe porque con 20+ filas había que bajar hasta la última para mover las
  columnas de lado. Se oculta sola si la tabla entra entera en pantalla.
- Las dos primeras columnas también son sticky en horizontal: Incluir en `left: 0`
  y Producto en `left: ANCHO_INCLUIR`. Esa constante (72 px) se aplica como
  `width` fijo a la celda de Incluir **y** como offset de Producto: si se tocan
  por separado, las columnas se superponen al hacer scroll lateral. Los
  `GroupHead` no son sticky en horizontal, así que los títulos de grupo se
  deslizan por encima de esas dos columnas (es así desde antes).

## Entorno de esta máquina
- Node no está en el `PATH`: vive en `C:\Program Files\nodejs`. Por eso
  `.claude/launch.json` apunta directo a `node.exe` + `node_modules/vite/bin/vite.js`
  (además, un `spawn npm` en Windows falla porque `npm` es un `.cmd`).
- La carpeta está sincronizada por OneDrive y el watcher de Tailwind a veces no
  ve los archivos nuevos: si una clase recién agregada no aplica, reiniciar
  `npm run dev` regenera el CSS.

## Ideas pendientes (no implementadas)
- Export a Excel/CSV (hoy solo JSON al portapapeles) e import desde Tiendanube.
  El "Exportar" actual copia al portapapeles; estaría bueno que baje un `.json`.
- Sacar la barra espejo de scroll de arriba si termina resultando redundante:
  desde que la tabla tiene alto máximo, la barra de abajo siempre está visible.
- **Comparar precios de varias listas de proveedores.** Diseño hablado, no
  empezado:
  - Estructura propia `datos/listas/<id>.json` (`{proveedor, fecha, items:
    [{nombreEnLaLista, precio, moneda, perfumeId}]}`), **independiente de cómo se
    llenó**: PDF, texto pegado o a mano. La comparación no debe depender del PDF.
  - En la celda Costo Base, un indicador que abre "Proveedor A U$S 41 · B U$S 38
    · C U$S 36" y completa el costo al elegir. Elegir el precio, no tipearlo.
  - El valor real es el total: "todo a A / todo a B / lo más barato de cada uno",
    contra el costo de partir el pedido en varios envíos.
  - **El emparejado de nombres nunca es automático**: propone con puntaje, el
    usuario confirma, y el alias queda guardado para que la próxima lista de ese
    proveedor matchee sola. Un match errado = pedir el perfume equivocado.
  - Riesgo abierto: si los PDFs son escaneos no hay texto que extraer y haría
    falta OCR. Antes de empezar, mirar dos o tres PDFs reales.
