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
  y las pantallas `src/Catalogo.jsx`, `src/MercadoLibre.jsx` y `src/PestanaTiendaNube.jsx`. La navegación entre pantallas
  es un `useState` (`vista`), no hay router.
- `src/stock.js`: el stock base y sus movimientos (ver "Stock"). Puro y sin
  imports, probado desde Node.
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
- Un archivo por pedido y no uno con todos adentro: así cada escritura es chica
  y solo se reescribe el que se está tocando. Con todo en un archivo, tocar una
  celda reescribe el historial entero y cualquier error se lleva puesto todo.
- **No hay OneDrive ni historial de versiones.** La carpeta está adentro de
  `OneDrive\Escritorio\` por cómo quedó armada la máquina, pero Franco no lo usa
  y pidió que no se tenga en cuenta. Lo único que protege los datos es lo que
  hace la app: la escritura atómica, **un** `.bak.json` por archivo (que rota en
  la escritura siguiente, así que es solo la versión anterior) y
  `datos/papelera/` al borrar un pedido. No usar "OneDrive guarda versiones"
  como argumento de diseño ni como salida de emergencia.
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

## Pedidos abiertos y cerrados
- `estado: "abierto" | "cerrado"` en el JSON del pedido. **Abierto** = los
  productos todavía no llegaron y se puede tocar. **Cerrado** = ya está todo
  calculado y es un registro histórico.
- Lo que no tenga `estado` se lee como abierto y **eso no reescribe el archivo**:
  los pedidos viejos quedan como están hasta que se cierre uno a mano.
- **El candado tiene dos mitades y las dos hacen falta.** La UI: el contexto de
  `src/bloqueo.js` (`ContextoBloqueo` + `useBloqueo()`), que envuelve la vista
  del pedido y leen `NumberCell`, `TextCell`, `CheckCell`, `BuscadorPerfume`,
  `SelectorMoneda` y `ParPrecioMargen`. Va por contexto y no por props porque son
  21 columnas: pasar un `bloqueado` por celda es garantía de olvidarse justo la
  que importa.
- La otra mitad, la que de verdad protege el archivo: **el efecto que persiste no
  programa ninguna escritura con el pedido cerrado**. Apagar la UI no alcanza —
  cualquier camino que llame a `setProductos` escribiría igual.
- **Un pedido cerrado acepta exactamente dos escrituras**:
  1. el propio cambio de estado (`forzarGuardado`), y
  2. la **sincronización del nombre** de un perfume renombrado en el catálogo. La
     fila guarda una copia del nombre además del `perfumeId`; si no se
     actualizara, el archivo envejecería con nombres que ya no existen.
     Se distingue comparando el estado con `jsonInicial` **ignorando los
     `producto`** (`sinNombres()`): si sin los nombres son idénticos, el único
     cambio fue el nombre y se escribe; si difiere algo más, no se escribe nada.
- Queda habilitado lo que **no** modifica el pedido: Reabrir, Exportar, PDF
  proveedor y "pasar costos al catálogo" (escribe en el catálogo, y es justo el
  momento en que los costos son definitivos). Trabado todo lo demás: celdas,
  agregar/duplicar/borrar filas, soltar el margen, aplicar margen masivo, los
  globales, el selector de moneda, Importar, Renombrar y Borrar el pedido.
- **Nuevo** y **Duplicar** siguen disponibles y lo que nace, nace **abierto**:
  duplicar un cerrado es la forma natural de arrancar el pedido que le sigue.
- Cerrar y reabrir piden **confirmación los dos**, con `Dialogo`. El sello del
  selector dice el estado, el desplegable marca los cerrados, y una franja gris
  arriba de la tabla explica por qué no se puede escribir. Gris y no óxido:
  cerrado no es un error ni un peligro, es un estado.
- **Desde el catálogo tampoco se tocan**: si el perfume está en un pedido cerrado
  —el de pantalla o cualquier otro—, el diálogo de borrado no ofrece borrar esas
  filas, solo quitarlo del catálogo dejándolas huérfanas.

## Stock
- **El stock base se guarda; el total se calcula.** El modelo es *base (sin
  publicar) + lo asignado a ML + lo asignado a Tiendanube*. Puras en
  `src/stock.js` (sin imports, probadas desde Node).
- **La dirección inversa está mal y no es intercambiable.** Con el total
  guardado y `base = total − ML − TN`: ML vende uno y baja de 5 a 4 por su
  cuenta, el total sigue en 10 y la base **sube** de 2 a 3 — la venta aparece
  como una unidad que volvió al estante. Para que funcionara habría que
  descontarle al total cada venta de cada canal, y la app no las sabe: las de
  Tiendanube no se leen y las ventas en mano no se registran.
- **Las cantidades de los canales NO se guardan**: se leen en vivo
  (`useStockDeCanales` en `Catalogo.jsx`). Un espejo en `perfumes.json` habría
  que refrescarlo con cada lectura, o sea **escribir por entrar a la pantalla**.
  El precio es que las dos columnas muestran "?" hasta que vuelven las
  respuestas, y "?" significa *no se sabe*, nunca cero.
- `stockPorPerfume()` toma **un** número de ML, no la suma: ML comparte el stock
  entre las publicaciones del mismo perfume (1 pago, 6 cuotas, normal y catálogo
  son hasta cuatro del mismo User Product) y sumarlas contaría cuatro veces lo
  mismo. En Tiendanube `stock: null` es **infinito** (gestión de stock apagada):
  se muestra `∞` y no entra en ninguna suma, así que ahí no hay total posible.
- **"N sin stock" significa una sola cosa: no hay unidades en ninguna parte, y
  se sabe.** Antes significaba dos —"no tengo" y "todavía no lo cargué"— y por eso
  mentía: un perfume con 2 publicados en Tiendanube caía en el filtro, cuando lo
  que falta ahí es decir cuántos quedan en el cajón. En el catálogo real eran 13
  de 24. Que falte cargarlo se ve en la fila, que muestra `—` en vez de un
  número. La regla es `estaSinStock()` en `src/stock.js`, probada desde Node.
- **Sin vínculo en un canal es `0`, no `?`.** `stockPorPerfume` los daba iguales
  y no son lo mismo: si el perfume no está publicado ahí, no tiene unidades ahí,
  y eso es un dato. `?` quedó solo para lo que de verdad no se sabe —vinculado y
  sin leer, o sin conexión—. Sin esta distinción el total en mano de un perfume
  que solo se vende en mano no se calculaba nunca, y la celda terminaba diciendo
  "no se sabe" mientras el botón afirmaba que no había nada.
- **El total en mano es una columna** (antes vivía en el `title`, "porque es una
  suma de cosas que ya están a la vista"). Lo pidió Franco y con los +/− al lado
  tiene sentido: es el número contra el que se comprueba que lo repartido cierre
  con lo que hay, y **no se mueve al mover unidades entre lugares** —pasar un
  frasco del cajón a ML no cambia cuántos tenés—, así que sirve de control. Con
  un canal en infinito sigue sin existir; mientras falte leer un canal, `?`.
- **Los +/− de En ML y En TN no escriben en el canal: juntan y recién el tilde
  manda** (elegido por Franco sobre "escribe en cada clic"). Subir dos unidades
  es **un solo PUT** con el número final en vez de dos —verificado contra el ML
  falso: `PUT {"available_quantity":6}`, sin el 5 intermedio—, un clic de más se
  corrige antes de mandar, y nada toca la publicación viva hasta que se pide.
  Mientras hay algo pendiente el número va en tinta con "era N" al lado.
  - El orden es el mismo que en las dos pestañas y **no es negociable**: primero
    escribe el canal, y la base se mueve solo después. Si el PUT falla, el stock
    sin publicar no se toca y el error va en la celda con el pendiente intacto
    para reintentar (verificado forzando un 500 en la Tiendanube falsa).
  - A ML se le escribe **la misma publicación de la que se leyó el número**
    (`mlPubId`, que ahora devuelve `stockPorPerfume`): comparten stock entre las
    del mismo User Product, así que elegir otra sería calcular el delta contra
    un número ajeno.
  - Solo se puede mover si el canal está vinculado y se sabe cuánto hay: con `?`
    no hay contra qué calcular el delta y con `∞` no hay cuenta que llevar.
  - Lo que el canal acepta se **anota** sobre lo leído (`escrito` en
    `useStockDeCanales`) en vez de releer el canal: la respuesta del PUT ya trae
    el número, y releer las 44 publicaciones por mover una unidad tira por la
    ventana el tope de 2 pedidos/s de ML.
- **Qué es cada columna va ESCRITO arriba de la tabla, no en un `title`.** Franco
  leyó "Sin publicar" como el total y estuvo por cargar ahí los frascos que ya
  tenía publicados, que los habría contado dos veces. Misma lección que el campo
  Stock del panel de publicar en ML.
- Claves nuevas en el perfume, solo dos: **`stock`** (la base) y
  **`aportesStock`** (`[{pedido, fila, unidades, fecha}]`). Ninguna está en
  `AJUSTES_POR_DEFECTO` ni se escribe al leer: **abrir la app no escribe nada**
  (verificado por md5 entrando a las cuatro pantallas). Sin `stock` la celda
  muestra `—`, no 0.
- **Lo único que mueve la base**: cerrar un pedido, asignarle stock a un canal
  desde la app, y la edición a mano de la celda. Que ML o Tiendanube bajen solos
  **no la toca**: esas unidades se vendieron y desaparecen del total por sí
  mismas.
- **Cerrar un pedido suma sus unidades**, que es cuando la mercadería llegó. La
  suma va al **catálogo** y no al archivo del pedido: un cerrado acepta
  exactamente dos escrituras y marcarlo sería una tercera. El candado contra
  sumar dos veces es `aportesStock`, por **pedido + fila** (por fila, para que si
  reabrís y agregás una, al volver a cerrar entre solo la nueva). Reabrir **no
  resta** y volver a cerrar no vuelve a sumar; los dos diálogos lo dicen.
- **Sumar al cerrar es opcional** (pedido de Franco). Con unidades pendientes,
  el diálogo de cerrar trae dos salidas: **"Cerrar y sumar al stock"** (la
  principal) y **"Cerrar sin sumar"** (la `segunda` de `Dialogo`), que es
  `cambiarEstadoPedido("cerrado", { sumarStock: false })`. Cerrar sin sumar **no
  deja marca**: si se reabre y se vuelve a cerrar, se vuelve a ofrecer sumar.
  Probado en la copia: sin sumar, `perfumes.json` quedó con el mismo md5; al
  volver a cerrar sumando, 25 unidades en 19 perfumes del Fraganti.
- Los pedidos cerrados antes de que esto existiera **no aportan nada** y sus
  archivos no se tocan. El stock inicial se carga a mano. No hay migración.
- **Asignarle stock a un canal lo descuenta de la base**, con el delta contra lo
  que el canal tenía **leído justo antes** (`cambiarStock` en `MercadoLibre.jsx`
  y en `PestanaTiendaNube.jsx`). Así el delta es correcto aunque el canal haya
  vendido en el medio. Se mueve **después** de que el canal acepta: si el PUT
  falla, la base no se toca. Puede quedar negativa —asignaste unidades que nunca
  registraste—; se avisa, no se traba.
- **Hueco conocido y a propósito**: una venta en mano no descuenta nada hasta que
  existan las ventas directas. Mientras tanto se corrige editando la celda.
- Botón-filtro **"N sin stock"** en el catálogo, con la regla de los otros tres:
  no desaparece con el filtro puesto (ahí dice "Ver todos"). En humo, no en
  óxido: no tener stock cargado no es un error, y al principio son todos.

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
- **La columna Usos cuenta TODOS los pedidos, no solo el que está en pantalla.**
  Sale de `GET /api/usos` (solo lectura), que arma `contarUsos(pedidos)` —pura y
  exportada desde `vite-plugin-datos.js`, testeable desde Node—. El `title` de la
  celda dice en cuáles y con cuántas filas.
- Ese conteo **mezcla dos fuentes a propósito**: de los archivos salen los demás
  pedidos y el de pantalla se cuenta en vivo sobre `productos`. Si se usara el
  archivo para los dos, lo recién tipeado no contaría hasta pasados los 800 ms
  del guardado. `usosPorPerfume` devuelve `{total, enPantalla, enOtros, pedidos}`.
- **Borrar del catálogo un perfume en uso no decide por el usuario**, y tiene tres
  casos:
  - **En ningún pedido**: quitar y listo.
  - **Solo en el pedido en pantalla**: quitar dejando las filas (quedan huérfanas,
    marcadas en óxido con su nombre cacheado y sin foto) o quitar borrándolas con
    sus costos. `Dialogo` soporta una `segunda` acción para eso.
  - **En otros pedidos**: el diálogo los nombra con sus filas y avisa que **ésas
    quedan huérfanas**. Desde el catálogo solo se borran filas del pedido en
    pantalla: editar el archivo de un pedido que el usuario no está mirando es
    justo lo que no se hace. Antes este caso mostraba "no está usado en ninguna
    fila de este pedido" y borraba sin avisar.
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
- **Un perfume va una sola vez por pedido.** Franco lo daba por hecho y el
  código no lo hacía cumplir. Ahora `BuscadorPerfume` recibe `yaUsados` y no
  ofrece los que ya están en otra fila, con un pie **"Mostrar los N ya
  cargados"** que los trae marcados "ya en este pedido" — mismo gesto que el
  buscador de publicaciones de ML. Solo se esconden, no se prohíben: el caso
  legítimo es el mismo perfume comprado a dos proveedores en la misma compra.
- Cuando todo lo que coincide está escondido, la lista dice **"Los que coinciden
  ya están cargados en este pedido"** y va **arriba** de "Crear … en el
  catálogo". Sin ese renglón, lo único visible es "Crear", que invita a duplicar
  en el catálogo un perfume que ya existe. El aviso se decide contra
  `coincidencias`, no contra `opciones`: con "Crear" en la lista, `opciones`
  nunca llega a cero.
- **Duplicar fila copia los costos pero no el perfume**: la copia nace sin
  `perfumeId` y con el borde ámbar que pide elegir uno. Era la vía más fácil de
  repetir un perfume en el pedido.

## Precios del catálogo
- Cada perfume tiene `costo` y `precioPublico` (venta directa), **puestos a mano**.
  No se sugieren desde el último pedido: el costo de un pedido es lo que cobró
  ESE proveedor en ESA compra, y el del catálogo es la referencia actual.
- **El `costo` está detrás de un doble clic** (`CampoProtegido`, en
  `src/CampoProtegido.jsx`, compartido: también traba los ajustes de Tiendanube).
  De ese número cuelga todo: márgenes y ganancias de los dos
  canales y, desde que se clavan márgenes, los precios calculados — pisarlo de un
  tecleo reprecia publicaciones en silencio. Trabado se ve como número suelto; se
  abre con doble clic o con Enter/Espacio si se llegó con Tab, y se traba sola al
  salir del campo o con Enter.
- El gesto se anuncia, que es lo único que lo salva de parecer una celda rota:
  candado al pasar el mouse, borde que aparece, `title` y `aria-label` que dicen
  qué hacer. Para proteger otro campo, usar `CampoProtegido` (trae todo eso:
  `mostrar` dice cómo se ve trabado, `texto` lo vuelve campo de texto y
  `abiertoAlInicio` es para lo recién creado), no copiar solo el doble clic.
- **Escape deshace** lo tipeado y vuelve al costo que había al abrir. Hace falta
  porque `NumberCell` escribe en cada tecla: sin eso, el error ya está guardado
  antes de que lo veas.
- El candado es de pantalla: **"pasar costos al catálogo" escribe igual**, porque
  es una acción explícita y con su propio diálogo. Verificado.
- **Costo atado al dólar** (pedido de Franco: si sube el dólar, el costo en pesos
  quedaba viejo y la ganancia no alcanzaba al reponer). `ajustes.dolar = {valor,
  casa, fecha}` es el **dólar del catálogo**; un perfume con `costoUSD` está
  atado y su `costo = round(costoUSD × dólar)`. Puras en `src/dolar.js`
  (probadas desde Node). El `costo` en pesos se sigue guardando y es lo que usa
  todo lo demás; **cada movimiento pasa por `registrarCosto()`** (historial).
  - El dólar se cambia en la caja "Dólar del catálogo" con **"Aplicar"**, que
    confirma con `Dialogo` si hay atados (cuántos cambian y en qué %).
    `cambiarDolar` en `App.jsx` guarda el dólar y corre `aplicarDolar()` en el
    mismo movimiento; los clavados de los tres canales se reprecian solos
    porque cuelgan del costo, los de precio a mano no. **No va con
    `CampoProtegido`**: ese escribe en cada tecla y cada tecla repreciaría todo.
  - "Traer cotización" pide `GET /api/dolar?casa=` (en `vite-plugin-datos.js`,
    desde dolarapi.com, pública) y deja la venta en el campo: nunca se aplica
    sola. Casa por defecto `cripto` (lo más parecido a pagar en USDT).
  - Se ata y desata **uno por uno** (botón al pasar el mouse en la celda Costo,
    "US$ X" debajo). Atar toma el costo de hoy como el de este dólar
    (`atarAlDolar`); editar el costo en pesos de un atado mueve su `costoUSD`
    (`conCostoEnPesos`).
  - **Pasar costos al catálogo** tiene la casilla "Atar al dólar": tildada si el
    pedido es en dólares (guarda el s/Gan. USD de la fila, ponderado por
    unidad), destildada si es en pesos (tildada, convierte con el dólar del
    catálogo). Destildada, un perfume que estaba atado se desata. Promediar
    atado promedia en dólares (`cifrasDelPase`). El cuerpo del diálogo es un
    componente (`CuerpoDelPase`) porque la casilla cambia las cifras; avisa a
    App por un ref (`atarAlPasar`) que lee `aplicarAlCatalogo`.
  - Abrir la app no escribe: el dólar arranca vacío y nada está atado hasta
    que Franco lo decide. Probado en la copia: subir de $1.600 a $1.645,32
    (cripto real) movió el costo del Yara +2,8%, su precio clavado y el de
    Tiendanube; el Turathi (precio directo a mano) no cambió de precio.
- **Precio y Margen de la venta directa son un par**, igual que en los pedidos:
  escribís el precio y el margen sale solo, o clavás el margen (`margenObjetivo`,
  fracción o `null`) y el precio se despeja. Con el margen clavado el precio pasa
  a ser calculado y se muestra sin caja; la celda del margen lleva borde ámbar y
  una `X` para soltarlo. Van pegadas en la tabla: son un par que se maneja junto.
- **También se fija una ganancia en pesos** (`gananciaObjetivo`, pedido de
  Franco): la celda Ganancia de venta directa es editable igual que el Margen, y
  escribir en una fija esa y suelta la otra (`fijarObjetivoDirecto` en
  `App.jsx`, un solo `setPerfumes` para uno o muchos). Precio = `costo +
  ganancia` (`precioPublicoDesdeGanancia`), así que la ganancia queda fija
  aunque cambie el costo o el dólar. `objetivoDirecto(p)` en `precios.js` dice
  cuál manda (la ganancia, si aparecieran las dos). Soltar con la `X` borra las
  dos y escribe el precio resuelto. Sin la clave = como antes, sin migración.
- **"Aplicar a todos"** del catálogo: la misma banda que Tiendanube
  (`src/AplicarATodos.jsx`, compartida; solo Tiendanube le pasa `formas` y
  muestra "Medido contra"). Fija margen o ganancia en los que se ven con costo
  (búsqueda y filtro "sin foto" incluidos), pisando los de precio a mano, con
  confirmación. **Solo venta directa**: ML y Tiendanube no se tocan.
- **La banda de ganancia** (`gananciaDeBanda` en `precios.js`): cuarto modo de
  "Aplicar a todos", **solo en el catálogo** (prop `conBanda`; Tiendanube no lo
  muestra). Son tres números —**piso $ · margen % · techo $**— y la ganancia de
  cada perfume es el margen sobre SU costo, nunca menos que el piso ni más que
  el techo.
  - Existe porque una ganancia fija sola desparrama el margen: con $30.000
    parejos, el costo de $21.803 daba **138%** y el de $69.831 **43%**. Con
    22.000 / 65% / 35.000 va de 101% a 50%.
  - **No es un objetivo nuevo: es una calculadora.** Al aplicarla, a cada
    perfume se le guarda una `gananciaObjetivo` común y corriente, y de ahí en
    adelante todo sigue igual. Por eso `objetivoDirecto()`, el resolver,
    Tiendanube y ML **no saben que existe**. Si algún día se quiere que mande
    sola, eso sí sería un objetivo nuevo.
  - **Se aplica a mano, no es una regla permanente** (decisión de Franco). Se
    descartó el modelo de tramos con un corte de costo: daba un **escalón**
    —$2 más de costo, $13.100 más de precio— y, como los costos están atados al
    dólar, una cotización nueva cruzaría perfumes de tramo y les saltaría el
    precio solo en los tres canales. La banda es monótona y no tiene saltos.
  - La banda usada queda en **`ajustes.bandaDirecta`** (no está en
    `AJUSTES_POR_DEFECTO`: la clave aparece recién al aplicar una, así que abrir
    la app no escribe). Sirve para no retipear y para el contador de abajo.
  - **"N fuera de banda"**, botón-filtro al lado de "N sin foto" y con su misma
    regla (no desaparece con el filtro puesto; ahí dice "Ver todos"). Son los
    que tienen costo **y `gananciaObjetivo` puesta** cuya ganancia ya no
    coincide con la banda, casi siempre porque el dólar les movió el costo. Los
    de precio a mano y los de margen clavado **no se cuentan**: son excepciones
    deliberadas. Como "Aplicar a todos" trabaja sobre los que se ven, filtrar y
    reaplicar es el mismo gesto de siempre. Va en **óxido**, no en ámbar: es un
    "esto se corrió", como las filas huérfanas.
  - La confirmación dice **cuántos caen en el piso, cuántos por margen y
    cuántos en el techo**: si casi todos quedan en el piso, la banda está mal
    elegida y es una ganancia fija disfrazada. Con los 36 reales y
    22.000/65%/35.000 son 14 / 15 / 7.
  - **La vista previa en vivo es lo que vuelve elegibles tres números
    abstractos**, y por eso existe: Franco probó la banda y lo primero que dijo
    fue "lo veo complicado de elegir". Debajo de los campos, recalculándose con
    cada tecla: el reparto, el rango de margen, cuántos suben y bajan, y
    —lo que más pesa para decidir— **cuánto ganás en total contra hoy**
    (verde/óxido, nunca ámbar: es una comparación, no plata que te queda).
    Encabezado y filas comparten **una sola constante** (`COLUMNAS_VISTA`), y el
    bloque va con `w-max`: con el nombre en `flex-1` los números se iban al
    borde derecho y costaba seguir el renglón.
    Cada fila lleva **flecha y diferencia en color** (↑ verde sube, ↓ óxido
    baja, "igual" en gris), con el mismo criterio que el total: plata que entra
    o sale. Sin precio hoy no hay con qué comparar y la fila va sin color.
    La **ganancia** que le toca a cada uno va en ámbar y pegada al margen —son
    la misma cuenta mirada de dos maneras—, y es la columna donde mejor se ve
    dónde deja de mandar el piso: una tira de números repetidos y, a partir de
    ahí, creciendo.
    Con Tiendanube configurado se suma **lo que deja ese canal** con el precio
    nuevo, medido contra la forma que cada perfume tiene fijada; el rótulo la
    nombra cuando todas miden contra la misma, que es el caso real
    ("Transferencia · Pago Nube"). Hace falta porque los perfumes que **igualan
    a la venta directa** cuelgan del precio directo: la banda les mueve también
    Tiendanube y sin esta columna ese movimiento quedaba invisible. Se recalcula
    igual que en `resolverPreciosDelCatalogo` —`objetivoTN` →
    `precioTiendaNubeDesdeObjetivo` → `analisisTiendaNube`— y por eso
    `AplicarATodos` recibe `ajustesTN`.
    Abajo, tres perfumes de muestra con `costo · hoy → nuevo · margen · zona`:
    **el más barato, el del medio y el más caro**, que son los tres en los que
    se ve si la banda hace lo que se quiere. "Ver los N" despliega todos,
    ordenados por costo.
  - La línea de los **cruces** ("hasta $33.846 de costo manda el piso") es
    aritmética pura de los tres números (`piso / margen` y `techo / margen`): no
    mira el catálogo. El que cuenta perfumes es el reparto. Vale aclararlo
    porque es la primera confusión que aparece.
- El despeje es `precioPublicoDesdeMargen(costo, margen) = costo × (1 + margen)`.
  Acá no hace falta el de los pedidos porque vender directo no tiene comisión ni
  envío a cargo del negocio. El redondeo es el de `redondearPrecio()` (ver abajo).
- **Redondeo de los precios calculados — uno solo para los tres canales.**
  `redondearPrecio(precio, {redondeo, k, costo})` en `precios.js`, y un
  `SelectorRedondeo` ("Redondear arriba a") en la caja de cada canal:
  `ajustes.redondeoDirecto`, `ajustes.redondeoML` (vale para todos los planes) y
  `ajustes.tiendaNube.redondeo`.
  - "Sin redondear" (`1`, el default de directo y ML): peso más cercano, o
    centavos si un peso corre el margen más de 0,05 pp. Es el comportamiento de
    antes, así que abrir la app no reprecia nada ni escribe.
  - $100 / $500 / $1.000: **hacia arriba**, para que el margen quede igual o un
    poco arriba del pedido, nunca debajo.
  - Solo toca lo que sale de una cuenta: margen clavado y el `=`. **Los precios
    puestos a mano no se redondean nunca.**
  - Con el margen clavado la celda sigue mostrando el margen **pedido**; el
    `title` (`margenReal()` en `Catalogo.jsx`) dice cuánto queda con el precio ya
    redondeado ("Pediste 40,0% · queda 40,7%").
- **Un costo nuevo mueve el precio de los clavados.** Es lo que hace que "pasar
  costos al catálogo" desde un pedido reprecie solo los perfumes clavados; los
  que tienen precio a mano no se tocan nunca. Está pedido así a propósito.
- `resolverPreciosDelCatalogo()` es el gemelo de `resolverPrecios()`: corre sobre
  la lista y devuelve **el mismo array** si no cambió nada, para que abrir la
  pantalla no dispare un guardado. Lo que se guarda, se exporta y va al PDF es
  **`perfumesResueltos`**, no el estado crudo — si no, el precio calculado nunca
  llega al archivo.
- Soltar el margen escribe `margenObjetivo: null` **y** el precio resuelto, en el
  mismo `setPerfumes` (`soltarMargenDelCatalogo`). Si solo se borrara el margen,
  la fila volvería al precio viejo que quedó en el estado crudo: es la misma
  trampa que ya se pagó en los pedidos.
- **En Mercado Libre no hay "un" precio.** Se publica una vez por opción de pago
  —un pago, 6 cuotas…— y cada publicación tiene la suya, porque ML cobra una
  comisión extra por cuotas sobre el precio publicado. Por eso el perfume guarda
  **`preciosML`**, un mapa `plan → precio` (`{"1": 103000, "6": 118953}`), y la
  pantalla muestra una pareja de columnas (precio + ganancia) por plan.
- Antes había un solo `precioML` y las cuotas eran una **lente** (un selector que
  recalculaba la ganancia de ese único precio). Estaba mal modelado: para ver a
  cuánto publicar en 6 cuotas había que pisar el precio de un pago, y al volver
  ya no estaba. Si aparece la tentación de "una vista para mirar", acordarse de
  que cada plan es una publicación, no un punto de vista.
- **Migración de `precioML` a `preciosML`: en memoria, al leer**
  (`preciosDePlanes()` en `precios.js`). El archivo no se reescribe por abrir la
  pantalla; recién en la primera edición del catálogo se escribe el mapa y se
  deja de escribir `precioML` —el valor ya vive en `preciosML["1"]` y tener los
  dos sería tener dos verdades—. Esa primera escritura deja la versión previa en
  `perfumes.bak.json`, que **rota en la siguiente**: después de dos escrituras
  más, de la forma vieja no queda nada. No hay otra red.
- `analisisDePrecio()` en `src/precios.js` devuelve `{ directo, ml }` con **`ml`
  como una lista, una entrada por plan** (`{plan, precio, comision, ganancia,
  margen, sugerido}`). Se apoya en `resultadoDeCanal({costo, precio, comision,
  envio})` y `precioParaIgualar()`. Tiendanube **no** entró por ahí: tiene
  varias formas de pago con IVA, descuento y mínimo, y lleva sus propias
  funciones (ver "Tiendanube").
- **El envío local (Rosario) no entra en ninguna cuenta.** Es la columna *con
  envío* = `precioPublico + envioLocal`, el precio que se le cotiza al cliente
  que pide entrega. La ganancia y el margen se siguen midiendo contra el costo,
  así que **el margen del catálogo sigue siendo el mismo que la columna Margen de
  los pedidos** y los dos números se comparan. Si esto se cambia alguna vez, hay
  que corregir esa afirmación acá.
- **Cuotas de ML**: `ajustes.cuotasML` guarda la comisión EXTRA de cada plan
  (`{3, 6, 9, 12}`, en fracción). ML la cobra **además** de la comisión normal y
  sobre el mismo precio publicado, así que se suman: `k = 1 − comisión − extra`.
- **Qué planes se muestran lo decide esa tabla**: `planesPublicables()` devuelve
  un pago siempre, más los que tengan comisión mayor a cero. Un plan en 0% no es
  una opción de publicación, así que no ocupa columna; cargarle la comisión a 3
  cuotas hace aparecer su bloque solo. No hay un ajuste aparte que mantener.
- **Cada plan también clava margen**, igual que la venta directa: `margenesML`
  es el mapa gemelo de `preciosML` (`{"6": 0.45}`, solo los planes clavados). Con
  el margen clavado, el precio de ESE plan se despeja con
  `precioDesdeMargenEnCanal()` —que es `precioParaIgualar()` con la ganancia
  objetivo escrita como fracción del costo, no una fórmula nueva—, el precio se
  muestra sin caja y el `=` de ese plan desaparece: el precio ya lo manda el
  margen. Cada plan se clava por separado.
- Por eso **`resolverPreciosDelCatalogo(perfumes, ajustes)` necesita los
  ajustes**: sin la comisión, el envío y las cuotas no puede despejar el precio
  de un plan. Sigue devolviendo el mismo array si no cambió nada.
- El botón **`=`** de cada plan carga el precio que **en ese plan** deja
  exactamente la misma ganancia que vender directo (`sugerido`), sin tocar los
  otros. Aparece al pasar el mouse, como el atajo de "pasar costo al catálogo"
  en la tabla del pedido. El margen de cada plan y su precio para igualar viven
  en el `title` de la ganancia: en columnas no entran.
- La fila muestra **ganancia en pesos** al lado del **margen**, en los dos
  canales: son la misma cuenta mirada de dos maneras, cuántos pesos y qué
  proporción del costo. La ganancia va en **ámbar** —es plata que queda, el único
  uso legítimo de ese color— y en óxido si el precio no cubre el costo.
- **Las zonas de color son territorio, no acento**: `--zona-directa` (verde muy
  suave) y `--zona-ml` (azul grisáceo) pintan las columnas de cada canal y
  también la caja de ajustes que las configura, para que se vea qué configura
  qué. La versión `-honda` es para las bandas del encabezado. El ámbar no se usa
  para esto: por eso el precio "publicar en ML" dejó de ser ámbar.
- El catálogo tiene, además, el grupo **Stock** (sin publicar · En ML · En TN ·
  total) entre Venta directa y Usos. Va ahí y no al lado del Costo porque Costo
  sale de `Precios` junto con las cuatro columnas de venta directa.
- **Las columnas de ML (precio, margen, ganancia y "En ML" por plan) y la caja
  de sus ajustes viven en la pestaña Mercado Libre** (`src/MercadoLibre.jsx`), no
  en el catálogo: ahí ya no entraban. Lo de arriba sobre `preciosML`, `margenesML`
  y cuotas sigue valiendo igual; los datos no se movieron de `perfumes.json`.
- **La tabla tiene encabezado de dos niveles** (canal arriba —en ML, una banda
  por plan— y columnas abajo), `sticky top-0` contra la ventana: esta pantalla
  scrollea con la página, no tiene contenedor propio como la del pedido.
  Encabezado y filas reciben **las mismas `columnas`** (`COLUMNAS_CATALOGO` en el
  catálogo, `columnasDeML(planes)` en ML), y los dos llevan `border`
  (transparente en el encabezado) para que el borde de la fila no corra las
  columnas un píxel.
- Esas columnas van como **`gridTemplateColumns` en línea, no como clase de
  Tailwind**: en ML la cantidad depende de cuántos planes se publiquen, y Tailwind
  genera sus clases leyendo el código, así que un `grid-cols-[...]` armado en
  tiempo de ejecución no existiría en el CSS. **La grilla va sin `gap`
  horizontal**: el aire lo pone cada celda con su padding, así el color del canal
  es una franja continua.
- **Nada de esto va al PDF de precios**: al PDF se le pasan solo `nombre`,
  `precioPublico` y `foto` —el precio sin envío—, y `pdf.js` no menciona costo,
  margen ni ganancia. Es para el cliente.
- La comisión y el envío de ML del catálogo viven en `perfumes.json` bajo
  `ajustes`, no en cada pedido: el precio de lista no depende de a quién le
  compraste. `AJUSTES_POR_DEFECTO` está en `almacenamiento.js`.
- **Cada cambio de `costo` queda asentado en `historialCostos`** (ver "Ventas de
  Mercado Libre"): las ventas se miden contra el costo de su momento.
- **"Pasar costos al catálogo"** copia el Precio sin Ganancia al `costo` del
  perfume. Hay dos disparadores sobre la misma función: el botón de la banda de
  acciones, que toma **todas las filas incluidas**, y un atajo **por fila** en la
  celda de Precio s/Ganancia. `costosParaElCatalogo(filas, perfumePorId)` es puro
  y recibe las filas; quién lo llama decide cuáles.
- El atajo de la fila aparece al pasar el mouse (`group-hover`, con `group` en el
  `<tr>`) y no ocupa lugar cuando no está: son 21 columnas y una más no entra. Va
  en la celda del número que se copia, así no hay que explicar qué se pasa, y
  **funciona también en filas no incluidas** — el clic es explícito. Abre el mismo
  diálogo con un solo renglón, y el aviso de resultado es un tilde en esa fila,
  no el texto en el botón de la banda: el aviso tiene que estar donde estaba el
  ojo. Una fila huérfana no muestra el atajo.
- Es el mismo número (costo del proveedor × dólar + su parte de los costos
  extras), así que no hay conversión ninguna, solo el traslado. Ofrece dos salidas y no elige por
  el usuario: **Reemplazar** (este pedido es la referencia nueva) o **Promediar**
  50/50 con el costo guardado, que es la cuenta que se hacía a mano cuando el
  mismo perfume se le compró a dos proveedores. "Promediar" solo aparece si
  algún perfume ya tenía costo.
- **El 50/50 no mira unidades, y se decidió dejarlo así igual.** Franco lo
  planteó con un caso real: 10 unidades a $50.000 y 1 nueva a $65.000 dan
  **$57.500** promediando, cuando el ponderado por unidades daría **$51.364**.
  Se evaluó cambiarlo por el ponderado ahora que existe el stock y **se decidió
  que no**, por dos motivos: el costo del catálogo manda los precios de los tres
  canales y ahí lo que tiene que mandar es el **costo de reposición** (si el
  precio sale de $51.364 mientras reponer cuesta $65.000, el margen no alcanza
  para volver a comprar — el mismo problema que resolvió atar el costo al
  dólar), y Franco prefirió no tocar el pase por ahora. **No reponerlo sin
  preguntar.** El ponderado sirve para medir, no para fijar precios.
- **La "bolsa de excedente" también se evaluó y se descartó** (07/11/2026). Franco
  volvió sobre el pase con otra idea: juntar el excedente de un pedido entrante
  —5u en stock a $50.000 y 2u del pedido a $60.000 son $20.000— y con un botón
  repartirlo entre todo el stock del catálogo, **como el factor de gasto de la
  mesa**, para que no le aumente de golpe un perfume. Por qué no, en orden:
  - **El factor de gasto reparte lo que NO tiene dueño.** `costosExtras =
    comisionRedUsdt × dólar + envioCorreo` son costos del envío que no se pueden
    atribuir a ningún perfume, y por eso se prorratean por `costoBase`. El
    excedente de un perfume sí tiene dueño: repartirlo es **desasignar un costo
    atribuible**, lo contrario de lo que hace el factor. La analogía es intuitiva
    y está dada vuelta.
  - **Repartirlo "entre todo el stock de X" es el ponderado con otro nombre**:
    (5×50.000 + 2×60.000)/7 = **$52.857**, el mismo número del punto de arriba.
  - **Repartirlo entre todo el catálogo tapa el agujero en vez de cerrarlo.** Con
    la banda real guardada (piso $25.000 · 60% · techo $30.000) X está en el
    techo, así que su precio se mueve 1:1 con el costo: $80.000 → $90.000.
    Repartir $20.000 entre ~66 unidades da **$303 por unidad** —los demás se
    mueven 0,4%, invisible— y X queda en $80.000 costando $60.000 reponerlo: deja
    $20.000 y **la pantalla diría $30.000**. El problema no es que sea poca plata:
    es que el número mostrado pasa a ser falso. Mismo agujero que tapó atar el
    costo al dólar. La variante "igual que la bolsa pero escribiendo
    `gananciaObjetivo` en vez de `costo`" queda descartada por lo mismo: recupera
    un pago de una vez con un reparto invisible y deja el agujero de X abierto.
  - **Hoy no habría con qué dividir**: `stock` está ausente en los 44 perfumes.
  - **El sobreprecio es el precio de la factura, no del perfume.** El dato que
    faltaba: Franco le compra al proveedor caro **por excepción**, cuando necesita
    las facturas. Visto así el reparto no era una mala intuición —es un gasto del
    negocio, no del producto—, pero **para repartirlo hay que saber cuánto es
    sobreprecio**: qué cobraba el barato por ese perfume ese día. Ese dato no
    existe en la app. Es justo el que daría "Comparar precios de varias listas de
    proveedores" (en "Ideas pendientes"); hasta entonces la bolsa no se calcula.
  - **Cómo lo trabaja Franco, y alcanza con lo que ya hay**: de los pedidos con
    factura **no pasa los costos** —el costo del catálogo queda en el del
    proveedor barato, que es el de reposición real— y cuando le conviene usa
    **Promediar**. Las dos salidas ya existen: el pase es **por fila** además de
    por pedido, y Promediar sigue ahí. **No hace falta ninguna bolsa, ningún
    ponderado y ningún botón nuevo. No reponerlos sin preguntar.**
- Si el mismo perfume aparece en dos filas del pedido, se promedia **por unidad**
  (ponderado por cantidad) antes de llegar al catálogo: el costo del catálogo es
  por unidad, no por fila. Las filas huérfanas se saltean solas.
- **El pase deja asiento y no se repite por error** (pedido de Franco: se
  confundía, apretaba de nuevo y con Promediar volvía a promediar). Cada pase
  agrega a `pasesDeCosto: [{pedido, fecha, costo, modo}]` del **perfume del
  catálogo** (no del pedido: un cerrado no acepta otra escritura, igual que
  `aportesStock`), en el mismo `setPerfumes` que el costo. `costosParaElCatalogo`
  recibe el `pedidoId` y devuelve `yaPasado` (el último pase de ese pedido).
  El diálogo marca esos renglones "ya pasado el dd/mm" y trae tildado **"Saltear
  los N que ya pasaste"**: por defecto solo pasan los nuevos; destildando se
  repite a propósito. La casilla llega a `aplicarAlCatalogo` por un ref
  (`saltearAlPasar`, molde de `atarAlPasar`). Si no queda nada que pasar, el
  botón de la banda dice "Nada nuevo para pasar" y no escribe. Sin la clave =
  nunca pasado, sin migración.
- El diálogo muestra **todos** los perfumes que va a tocar, en una caja con
  scroll propio (`max-h-[42vh]`), no una muestra de los primeros: es la
  referencia para decidir, y recortada obliga a aceptar a ciegas.
- Van las **tres cifras en columnas**: *En el catálogo* (lo que hay hoy), *Este
  pedido* (lo que viaja) y *Promedio* (cómo quedaría promediando). Cada botón
  deja la columna que lleva su nombre, y eso lo dice el texto de arriba. En
  columnas y no en una frase con flechas porque lo que se hace es comparar una
  contra otra; envueltas en renglones no se sabe cuál es de cuál.
- La columna *Este pedido* va **en color** cuando hay con qué comparar: verde si
  este pedido salió más barato que el costo guardado, óxido si salió más caro,
  gris si es el mismo número, y tinta si el perfume no tenía costo. Ámbar no —
  está reservado para la ganancia. Abajo va la referencia de los tres colores, y
  el `title` de cada renglón dice la diferencia en pesos y en porcentaje.
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

## Tiendanube
- **Vive en su propia pestaña** (`vista === "tiendanube"`, `src/PestanaTiendaNube.jsx`),
  con el molde de `MercadoLibre.jsx`. Se mudó del catálogo, no se duplicó: el
  catálogo quedó con costo, venta directa y usos. **Los datos no se movieron**:
  `precioTN`, `margenTN` y `ajustes.tiendaNube` siguen en `perfumes.json` y la
  mudanza no reescribió nada. La pestaña recibe `perfumesResueltos` y
  `soltarMargenTNDelCatalogo`, y muestra costo y ganancia directa de referencia.
- **Fuente de verdad sobre cómo cobra y descuenta Tiendanube: su Centro de
  Ayuda**, https://ayuda.tiendanube.com/. Antes de tocar comisiones, cupones,
  promociones o medios de pago, mirar ahí si algo cambió, en vez de suponer.
  Artículos ya usados:
  - Reglas para combinar descuentos (orden de prioridad, "Combinar con"):
    https://ayuda.tiendanube.com/es_AR/123465-cupones-y-promociones/cuales-son-las-reglas-para-combinar-descuentos-en-tiendanube
  - Cómo funcionan las promociones y los descuentos:
    https://ayuda.tiendanube.com/es_MX/como-funcionan-las-promociones-y-los-descuentos-en-tiendanube
- Tercer canal, después de ML: **un solo precio** (`precioTN`) que tiene que dejar
  la ganancia pedida **pague como pague el cliente**. Viene de una calculadora
  HTML que Franco ya usaba; los casos de prueba de ella son la referencia:
  costo 65.000 + 30% → $123.000 (transferencia paga $92.250); con envío gratis
  10.000 → $138.000; costo 30.000 → 6 cuotas "No aplica". Probados desde Node.
- Mismo par precio + margen que directo y cada plan de ML: `margenTN` (fracción
  o `null`) clavado despeja el precio en `resolverPreciosDelCatalogo()`; a mano,
  el margen mostrado es el de la forma de pago que **menos deja**. Soltar escribe
  `margenTN: null` **y** el `precioTN` resuelto juntos (`soltarMargenTNDelCatalogo`).
  El `=` pone el precio que deja, con la forma más cara, la ganancia directa.
- **El objetivo puede ser margen o ganancia fija, y medirse contra una forma.**
  `objetivoTN(perfume)` en `precios.js` lee `margenTN` (fracción) **o**
  `gananciaTN` (pesos; queda fija aunque cambie el costo —pedido de Franco: si
  sube el costo, sube el precio—) y `formaTN` (id de la forma de pago; sin la
  clave = la que menos deja, lo de antes). Uno de margen/ganancia borra al otro
  (`fijarObjetivoTN` en `App.jsx`, un solo `setPerfumes` para uno o muchos).
  `precioTiendaNubeDesdeObjetivo()` despeja: sin forma es **exactamente** el
  algoritmo de siempre (`precioTiendaNubeDesdeMargen` quedó como atajo; verificado
  con los 47 perfumes reales: precios idénticos); con forma, `objetivo ÷ k` de
  esa forma con el mismo redondeo hacia arriba. Si la forma fijada tiene mínimo
  y no llega, devuelve `noAplica` y el resolver no toca el precio. Una forma
  borrada vuelve sola a "la que menos deja", sin reescribir nada.
  `analisisTiendaNube({formaId})` agrega `manda` / `gananciaManda` /
  `margenManda` (la forma fijada); `define` sigue siendo la que menos deja.
- **El tercer objetivo: igualar lo que paga una forma a la venta directa**
  (`igualarDirectoTN`, pedido de Franco). El precio de Tiendanube se publica
  inflado para absorber la comisión y el envío gratis, así que el que mira la
  tienda y elige transferencia ve un número **más alto** que el precio directo,
  pregunta por fuera y compra directo: la tienda queda como la opción cara. Con
  este objetivo el precio sale de `precioPublico ÷ (1 − descuento de la forma)`
  (`precioTNParaIgualarPago` en `precios.js`), y se mueve solo cuando se mueve el
  precio directo.
  - **La comisión NO entra en el despeje**: no la paga el cliente, sale de lo que
    llega. Por eso la ganancia baja, y bastante — en los 47 reales, el Yara pasa
    de dejar $19.296 a $13.847 (directo deja $25.094). Eso es lo que se está
    decidiendo, así que el popup lo dice al lado: "Te quedan X · vendiendo
    directo Y". No esconderlo nunca.
  - Redondea **hacia arriba** como todo el resto (decidido con Franco), así que
    esa forma paga lo mismo o unos pesos más que directo, nunca menos. La
    diferencia real se muestra en la celda ("directo $68.700 · +$250").
  - **Necesita la forma sí o sí**: igualar "la que menos deja" no significa nada.
    Sin `formaTN`, o si esa forma se borró, `objetivoTN` no lo lee y el precio
    queda a mano — al revés que margen y ganancia, que vuelven solas a la que
    menos deja.
  - `precioTiendaNubeDesdeObjetivo` delega en él (sigue siendo la única puerta) y
    por eso ahora recibe `precioDirecto`. En `resolverPreciosDelCatalogo` ese
    precio sale de `salida.precioPublico`, **no de `p`**: el objetivo de la venta
    directa se resuelve unas líneas antes en el mismo `map` y hay que encadenar
    con el precio ya resuelto.
  - El gesto es "igualar a directo" en la celda **Paga el cliente** de cada forma
    del popup, al pasar el mouse: ahí está el número que se iguala. Va debajo del
    número (la columna es angosta y encima lo taparía) y con `opacity-0`, que
    sigue ocupando lugar, así las filas no se corren al recorrerlas.
- **El popup del precio (`DetalleTiendaNube`) es editable**: en cada forma,
  Margen y Ganás son `NumberCell` y escribir en una fija el objetivo contra esa
  forma; el precio llega resuelto, así que precio y filas cambian al tipear. La
  fijada lleva la marca ámbar y "fijada"; si otra deja menos, ésa dice "deja
  menos" (óxido) y el texto de arriba lo avisa. Botones "Medir contra la que
  menos deja" (borra `formaTN`) y "Soltar". Con un cupón simulado no se edita.
- **"Aplicar a todos"** (banda arriba de la tabla, `src/AplicarATodos.jsx`,
  compartida con el catálogo): margen o ganancia fija + "medido contra", o
  "Igualar a venta directa" + la forma que tiene que pagar igual (ese tercer modo
  aparece **solo donde hay `formas`**, o sea solo en Tiendanube), a todos los
  que se ven **con costo**, **pisando también los de precio a mano** (decisión de
  Franco). Igualando quedan afuera los que no tienen precio de venta directa: sin
  él no hay nada que igualar, y guardarles el objetivo sería dejarlo sin
  resolver. Confirma con `Dialogo` diciendo cuántos tenían precio a mano y
  cuántos no se tocan. Escribe en el catálogo, no en Tiendanube.
- Ajustes en `ajustes.tiendaNube`: `envioGratis` (uno para todo el catálogo; lo
  paga el negocio, **sí entra en la cuenta**, al revés del envío de Rosario),
  `envioGratisDesde` (ver abajo), `comision` (la de Tiendanube, se suma a la de
  cada forma), `redondeo` y `formas: [{id, nombre, comision, descuento, minimo}]`.

- La comisión de cada forma se carga **sin IVA**, como la muestra el medio de
  pago; `comisionRealTN()` le aplica el 21%. Comisión + financiación de la
  pasarela se suman a mano en el mismo número.
- **El costo por transacción de Tiendanube (CPT) NO lleva IVA y va aparte**:
  columna **Costo TN** de cada forma (`forma.costoTN`, fracción; 2% en el plan
  de Franco con pasarelas que no son Pago Nube, donde está bonificado). El Centro
  de Ayuda ("¿Cómo se calculan los costos por transacción?") da 1% de $100 =
  $1, al lado de Mercado Pago "4,15% + IVA". `comisionRealTN = comisión × 1,21 +
  costoTNDeForma()`, que es `ajustesTN.comision` (el general, que tampoco lleva
  IVA) + `forma.costoTN`. En `analisisTiendaNube` el IVA va solo sobre la
  comisión de la pasarela. Ejemplo real: GOcuotas 9,10% + IVA y CPT 2% = 13,01%;
  cargado todo junto en la comisión (11,10%) daba 13,43%.
  Antes el CPT se sumaba a la comisión y llevaba IVA. Con los datos del
  13/11/2026 no se movió ningún precio (general en 0 y sin `costoTN`). Las formas
  que tienen el CPT sumado a mano en la comisión (la de Mercado Pago dice "3,46% +
  CPT 2%" y tiene 5,46%) siguen con IVA de más hasta que Franco lo separe.
- Redondea con `redondearPrecio()`, igual que directo y ML (ver "Precios del
  catálogo"), usando el `k` de la forma de pago que manda. Su default es $1.000.
  Antes "Sin redondear" subía al peso siguiente y el `=` podía mostrar 40,4%
  contra 40,3% de la venta directa (59 centavos que cruzaban el decimal); Franco
  pidió que "sin redondear" signifique lo mismo en toda la app.
- Monto mínimo (6 cuotas desde $70.000): aplica si `precio × (1 − descuento) ≥
  mínimo`. El despeje arranca sin las formas con mínimo y va sumando las que lo
  cumplen hasta que no cambie (tope 10 vueltas, como el HTML).
- Clic en el precio (o el icono de lista, con precio a mano) abre
  `DetalleTiendaNube` (`src/TiendaNube.jsx`, portal al body): precio + "Copiar
  número" y la tabla por forma de pago. El precio grande va en **tinta**, no en
  ámbar como en el HTML original: el ámbar es solo la ganancia.
- Las formas por defecto (`FORMAS_TN_POR_DEFECTO`, ids fijos) viven en
  `almacenamiento.js`, solo como arranque de un archivo sin la clave. Al leer,
  las guardadas **reemplazan enteras** a las de ejemplo (una lista no se
  mezcla). Abrir la app no escribe: la clave recién aparece en `perfumes.json`
  con la primera edición del catálogo.
- **Los ajustes de Tiendanube van con candado** (`CampoProtegido`): envío
  gratis, comisión TN, y nombre, comisión, descuento y mínimo de cada forma de
  pago. Cada uno reprecia todos los perfumes clavados. El selector de redondeo y
  el botón que despliega las formas quedan sin candado. Una forma recién
  agregada nace con el nombre abierto para escribir.
- **Simular cupón** en el detalle (`DetalleTiendaNube`): % y $ que se pueden
  usar juntos, más un tilde **"Se combina con el descuento del medio de pago"**
  (activado por defecto, es como suele armar Franco sus cupones). Vale para
  **todas** las formas de pago. Sigue el orden de la ayuda de Tiendanube
  ("¿Cuáles son las reglas para combinar descuentos?"): el cupón va 3° y se
  aplica sobre el subtotal; el descuento por medio de pago va 5°, último.
  - Primero el cupón (% y $) sobre el precio; después, si combina, el
    descuento de la forma sobre lo que quedó (10% y después 25% = 32,5%;
    `($100.000 − $5.000) × 0,75 = $71.250`).
  - Sin combinar, la forma **pierde su descuento**: esa ayuda dice que el de
    medio de pago "solo aplica si los anteriores son combinables". La fila lo
    dice ("sin su −25% (no combina)").
  - El mínimo de una forma se mide contra la compra ya con el cupón.
  - Es estado local del panel: se pierde al cerrarlo, no se guarda y no toca
    precios. La cuenta es el parámetro `cupon` de `analisisTiendaNube()`; sin
    cupón da exactamente lo de siempre.
  - Arriba, **"Cupón de la tienda"**: elegir un cupón real (solo los vigentes)
    llena la simulación con sus datos (`cuponDeTiendanube()`), incluido su
    `min_price` (`cupon.minimo`: si la compra no llega, `cuponAplica: false` y no
    se aplica). Si es para otros productos (`aQuienAplica()` = "no") no se aplica
    y lo dice; "no se sabe" (perfume sin vincular) se simula igual. Uno de envío
    gratis no cambia la cuenta: la app ya supone que el envío lo paga el negocio.
- **Simular promoción por cantidad** en el mismo popup: *Llevá X pagá Y* o
  *Progresivo* (N unidades con %). Las promociones del panel **no están en la API
  pública** (la API de Descuentos es para apps que son el motor de promociones,
  con un callback público en cada cambio del carrito: no sirve con la app en la
  compu de Franco), así que solo se simulan. Es el parámetro `carrito: {unidades,
  descuento}` de `analisisTiendaNube()`: va 2°, sobre el precio y antes del
  cupón (ayuda "¿Cómo funcionan las promociones…?"); se cuenta el carrito entero
  (un solo envío gratis, mínimos contra el total) y devuelve la ganancia del
  carrito y `gananciaPorUnidad`. Se supone que la promo combina con cupón y
  medio de pago. Con cupón o promo puestos no se edita el margen.
- **Cupones reales** (API "Coupons" 2025-03): sección "Cupones de la tienda" en
  la pestaña (`src/CuponesTN.jsx`). Lista con `estadoDeCupon()` (vigente /
  desactivado / por empezar / vencido / agotado; una fecha sin hora es un día en
  hora local —`new Date("2026-10-23")` es medianoche UTC, el 22 a la noche acá—)
  y, por cupón vigente, el **aviso de pérdida** (`impactoDeCupon()`): cada
  perfume con precio y costo al que le aplica, con la forma que menos deja y el
  cupón, de peor a mejor. El resumen mira la forma que menos deja; la lista
  desplegada muestra **una columna por forma de pago** (pedido de Franco): un
  cupón que no combina le saca el descuento a la transferencia y no a la tarjeta,
  así que no se mueven igual (`impactoDeCupon` devuelve `formas` y `define` por
  fila; la que menos deja va subrayada, el `title` dice cuánto dejaba sin el
  cupón). La grilla va con anchos fijos: con `min-w-max` cada fila arma la suya
  y un `1fr` corría las columnas con los nombres largos. **Crear y editar** escriben en la tienda real, con
  `Dialogo` y mostrando antes el aviso con el cupón como quedaría; **no se borran**
  desde la app. El server (`/api/tn/cupones`, `pedidoDeCupon()` puro en
  `vite-plugin-tn.js`) valida (código alfanumérico, % ≤ 100, productos **o**
  categorías) y al editar manda solo lo que cambió ("10000.00" y 10000 no es
  cambio). Las categorías de un cupón existente se conservan; desde la app se
  elige toda la tienda o perfumes vinculados. `resumirProducto` trae
  `categorias` para saber a quién aplica un cupón por categoría.
- **Necesita el permiso "Coupons" (escritura)** en Datos básicos de la app y
  tocar **"Volver a conectar"** (en la banda de conexión y al lado del aviso;
  antes no había forma de reconectar estando conectado): los permisos nuevos
  valen recién al reinstalar. Sin
  él, Tiendanube responde 403 y la sección dice eso; el resto de la pestaña
  sigue igual. Probado solo en la copia con Tiendanube falsa (POST de un cupón
  nuevo, PUT de KUKUDEROSARIO que llevó solo `{"max_uses":2}`, y el 403).
- **Quitar una forma de pago pide confirmación** con el `Dialogo` de `App.jsx`
  (llega como `onConfirmar` por la pestaña). Ya no existe "Volver a los
  ejemplos": pisaba de un clic las formas que Franco había cargado.
- Zona de color `--zona-tn` / `--zona-tn-honda`. No va al PDF de precios ni al
  orden "Por margen" (que siguen mirando la venta directa).

## Envío gratis a partir de un monto (Tiendanube)
- `ajustes.tiendaNube.envioGratisDesde` es la **compra mínima** para que el
  envío lo pague el negocio. **0 o ausente = siempre gratis**, que es lo de
  siempre: abrir la app no reprecia nada ni escribe. `envioGratis` sigue siendo
  *cuánto cuesta*; esto es *desde cuándo lo pagás vos*.
- **Contra qué monto se decide: el precio de lista, no lo que paga el cliente.**
  La base es el `subtotal` —`precioTN` × unidades, con la promo por cantidad
  aplicada—, **antes del cupón y antes del descuento del medio de pago**. El
  descuento del medio de pago no puede ser la base: en el orden de prioridad del
  Centro de Ayuda el envío gratis va 4° y ese descuento 5°, y se elige en el
  checkout después de calcular el envío. Del cupón (3°) la ayuda pública **no
  dice nada** —el artículo de envío gratis con monto mínimo ya no existe—, así
  que se toma la base **más alta**, que es la pesimista: el carrito califica más
  seguido, el envío lo pagás vos más seguido y el monto que sugiere la
  calculadora queda del lado seguro. Lo del cupón sigue **sin confirmar**:
  carrito apenas arriba del monto, elegir transferencia en el checkout y ver si
  el envío sigue gratis. Todo esto vive en **una sola función**,
  `envioDelCarrito()` en `precios.js`: darlo vuelta es una línea.
- **El mínimo INCLUYE el monto exacto (`>=`), verificado en la tienda real** el
  06/11/2026: con la promoción en `minimum_purchase: 120000` (leído por la API),
  un producto de exactamente $120.000 sale con envío gratis. La ayuda pública no
  lo define y las señales iban para los dos lados —el campo del panel figura
  como "Mayor de", el equivalente en cupones dice "el monto a partir del cual
  aplica"—, así que esto se probó y no se dedujo. Es lo que hace
  `envioDelCarrito()` (`subtotal >= desde`).
  Importa porque las sugerencias de la calculadora caen justo en el borde: "para
  no dejar menos de $10.000" propone $104.600 y hay tres perfumes a exactamente
  ese precio (Yum Yum, Untold, Tropical Vibe), que con la regla estricta no
  calificarían y con ésta sí. La otra sugerencia ("que nadie califique solo")
  suma un escalón al precio más caro, así que no depende de esto.
- `analisisTiendaNube` resta `envioAplicado`, no `envioGratis`, y devuelve
  `envio`, `umbralEnvio`, `envioAplicado` y `envioCalifica`. El envío sigue
  **fuera de `paga` y `llega`** (el cliente no lo paga) y fuera de los mínimos
  de las formas, que se miden contra `paga`.
- **El despeje de `precioTiendaNubeDesdeObjetivo` es a dos tramos** (margen y
  ganancia fija; `igualarDirecto` no cambia, ahí el envío nunca entró). La
  ganancia como función del precio crece, da un salto hacia abajo de `envio`
  justo en el monto y vuelve a crecer, así que hasta dos precios cumplen el
  objetivo y se quiere el más chico: si el precio sin envío no llega al monto,
  ése; si llega, el de con envío. No hay caso imposible.
  **El test va contra el precio YA REDONDEADO**: el redondeo es hacia arriba y
  un precio crudo de $99.600 con redondeo $1.000 se publica en $100.000 y
  cruzaría un monto de $100.000 sin que nada lo avise. Probado con un barrido de
  54.620 casos (dos redondeos, umbral de 0 a 300.000 de a 100): el objetivo se
  cumple siempre y el precio es siempre el mínimo.
- **La calculadora "¿desde qué monto?"**: `src/umbralEnvioTN.js`, puro y
  probable desde Node. **No se puede llamar `envioGratisTN.js`**: en Windows
  choca con `EnvioGratisTN.jsx` y el build falla con "default is not exported",
  igual que `clienteML.js` con `MercadoLibre.jsx`.
  - El riesgo del monto mínimo **no es** el perfume caro que se vende solo con
    envío gratis —ése ya lo absorbe en su precio—, es el **carrito que cruza el
    monto sumando frascos baratos que no lo absorbieron**. Por eso el número que
    decide es **el peor carrito que califica**: si ése deja bien, ninguno deja mal.
  - `gananciaDelCarrito` **no suma la ganancia de cada frasco por separado**:
    una forma con mínimo no aplica a un frasco solo pero sí al carrito de dos, y
    deja mucho menos, así que un carrito puede ser peor que sus partes
    (verificado: con una forma al 40% desde $150.000, un frasco deja $5.443 y
    dos dejan −$8.587 por unidad). Pasa todo por `analisisTiendaNube` con el
    costo y el precio totales: una sola cuenta, imposible de desfasar.
  - `carritosPosibles` enumera todos los carritos de hasta 4 frascos con
    repetición **una sola vez** (no depende del monto), guarda por subtotal el
    que menos deja y arma un mínimo por sufijo; después cada monto es una
    búsqueda binaria. **No se poda por "ya califica, no lo extiendo"**: parece
    obvio y es incorrecto, por lo mismo de arriba. Con 37 perfumes son 101.269
    carritos, 2.917 subtotales y ~130 ms, y por eso el panel **solo enumera con
    el panel abierto**.
  - `analisisDelUmbral` devuelve el reparto, el peor carrito, el más barato que
    califica solo, la ganancia total contra hoy, qué precios se moverían y dos
    sugerencias: "que nadie califique solo" y "para no dejar menos de $X".
- **El panel** es `src/EnvioGratisTN.jsx`, una banda de la pestaña (no de la caja
  de ajustes), con el molde de la vista previa de la banda de ganancia. **El
  monto se tantea con un campo local, no con el ajuste**: `NumberCell` escribe en
  cada tecla y cada tecla sobre el ajuste repreciaría todo el catálogo clavado y
  reiniciaría el temporizador del guardado. "Usar este monto" es el único que
  escribe. El campo guardado ("...a partir de", en los ajustes) va con
  `CampoProtegido` como el resto del canal.
- Números del catálogo real al 06/11/2026, por si hay que verificar: ganancia de
  hoy vendiendo uno de cada uno **$570.787**; el eslabón flojo es el **Rayhaan
  Kiss** ($101.400 de precio, $55.909 de costo), que con envío gratis deja
  $5.443; "nadie califica solo" da **$133.300** (+$370.000 contra hoy, peor
  carrito 2× Kiss $202.800 que deja $20.886); para no dejar menos de $10.000,
  **$104.600**; de $15.000, **$138.400**. Los 37 están con `igualarDirecto`, así
  que **el monto no mueve ningún precio**: solo cambia cuánto queda.
- **La ganancia si el cliente retira en Rosario** va de renglón chico, en ámbar,
  debajo de la ganancia de cada forma de pago en `DetalleTiendaNube`, y el pie
  del popup lo explica con palabras. Es `f.ganancia + envioAplicado`: **no hay
  cuenta nueva**, es el mismo número mirado sin el envío, y por eso es un
  renglón y no una columna. **Solo aparece cuando esa compra paga envío**: si no
  llega al monto los dos números son el mismo y repetirlo es ruido. El `title`
  de la celda Ganancia de la fila dice lo mismo en una oración.
  Existe porque el supuesto de la app —toda venta paga $10.000— es parejo y el
  retiro en mano no cuesta envío: la venta real del 06/11/2026 (Armaf Odyssey
  Marshmallow, retiro en Rosario) dejó $25.837 y la app decía $15.864. El
  supuesto **no se tocó**: sigue del lado conservador y ahora se ve al lado lo
  que pasa en el otro caso. Un "% de retiros" no se agregó a propósito: con una
  venta no hay con qué estimarlo, y el dato sale solo de las órdenes de
  Tiendanube cuando haya unas cuantas.
- **Comisión sobre el envío que paga el cliente** (pedido de Franco). Debajo del
  monto el envío lo paga el cliente, pero entra en el total que se cobra, y la
  pasarela y el costo por transacción de Tiendanube se calculan sobre todo ese
  total (Centro de Ayuda: el CPT va "sobre el total de la orden, incluyendo el
  costo de envío"; que la pasarela también lo cobre sobre el envío es lo
  esperable y no está confirmado). El envío es plata del correo; **la comisión
  sobre él sale de lo tuyo**. `analisisTiendaNube` devuelve `envioCliente`
  (`envioGratis` si no califica, 0 si califica) y por forma `comisionEnvio =
  envioCliente × comisionRealTN(forma)`, que se resta de la ganancia, **una vez
  por carrito**. Se estima con el mismo `envioGratis` y no con un campo aparte
  (decisión de Franco): ya está puesto para el envío más lejano, así que queda
  del lado seguro, y un carrito de dos con envío más caro reparte ese envío
  entre dos frascos. Con $10.000: transferencia $182, Mercado Pago $619, Go
  Cuotas $1.301, 6 cuotas $2.963 por venta.
  - El despeje de margen y ganancia fija lo incluye en el tramo de abajo
    (`despejar(c + extra, true)`: el objetivo de cada forma suma su comisión
    sobre el envío). Barrido de 2.178 casos (dos redondeos, monto de 0 a
    300.000, margen/ganancia, con y sin forma): el objetivo se cumple siempre.
    `igualarDirecto` no cambia (no mira comisiones): con los 33 reales, 0
    precios movidos.
  - En el detalle: "−$X s/envío" debajo de la comisión de cada forma, y el pie
    lo explica. **"Si retira"** suma de vuelta el envío que pagás vos **y** la
    comisión sobre el del cliente: retirando no hay envío de ningún tipo. El
    `title` de la Ganancia de la fila dice lo mismo.
- **Los que alcanzan el monto vendidos solos se marcan**, porque son los que hay
  que revisar de precio y en una tabla de 49 filas no se ven. Botón-contador
  "N con envío gratis" al lado del buscador, que filtra —molde y regla de los de
  `Catalogo.jsx`: no desaparece con el filtro puesto, ahí dice "Ver todos"— y un
  renglón en la celda Precio de cada uno. Va en **óxido**, no en ámbar.
- **La marca distingue dos zonas, porque piden acciones opuestas**
  (`zonaEnvioTN()` en `umbralEnvioTN.js`):
  - **"absorbido"**: el precio está lo bastante arriba como para que lo que
    cobra de más cubra el envío. Renglón gris, informativo.
  - **"floja"**: cruzó el monto por poco, así que paga el envío entero sin haber
    cobrado casi nada más por eso. Ahí **conviene BAJARLO** justo debajo del
    monto: el envío pasa al cliente y queda más ganancia con el producto más
    barato. Renglón en óxido con el precio escrito ("bajá a $119.900").
  - El caso real que lo motivó: con el monto en $120.000, el Rasasi Hawas Verde
    salía $120.000 —cruzaba por **$0**— y dejaba $18.409 cuando sus vecinos de
    abajo dejaban $28.500. Bajarlo $100 le suma ~$10.000.
  - **La frontera se mide, no se deriva**: es "floja" si a `bajarA` (el escalón
    justo debajo del monto) `analisisTiendaNube` da más ganancia que hoy. Así
    vale con cualquier redondeo, comisión, descuento y forma de pago sin rehacer
    la cuenta a mano. Con los números de hoy cae en $133.600.
  - `subirA` —la otra salida— se despeja con **el monto apagado**
    (`envioGratisDesde: 0`): el despeje a tramos devuelve el precio MÁS BARATO
    que cumple el objetivo, que es justamente quedarse debajo del monto, así que
    sin apagarlo devolvería `bajarA` otra vez.
  - **La marca no toca el precio**: con `igualarDirectoTN` el precio de
    Tiendanube cuelga del de venta directa, así que el número que se mueve es el
    del catálogo. La marca dice qué pasa y cuál es el objetivo.
  - No se avisa a los que están cerca por abajo (decisión de Franco): cuando
    cruzan, la marca aparece sola y la ganancia baja a la vista.
- Lo que la app **no** hace: escribir el monto en Tiendanube. La promoción de
  envío gratis se configura en el panel; la app dice qué número poner.
  **Hoy está en $150.000** en la tienda y en la app (confirmado por Franco el
  13/11/2026). `ajustes.tiendaNube.envioGratisDesde` tiene que quedar en el
  mismo número que la promoción de envío gratis del panel o las dos cuentas no
  coinciden. Antes estuvo en $120.000 (06/11/2026, promoción 813555); los
  números de ese momento, por si sirven de referencia: 34 perfumes debajo, con
  envío gratis vendidos solos Hawas Verde ($120.000 justo, inclusivo), Rayhaan
  Italia y 9PM Night Out, y +$340.000 contra el envío gratis siempre.

## Conexión con Tiendanube
- Mismo molde que ML: vincular cada perfume con su variante y mandarle precio y
  stock, siempre con confirmación. Piezas: `vite-plugin-tn.js` (dev y preview,
  expone `/api/tn/*`: `estado`, `autorizar`, `autorizar/codigo`, `productos`,
  `PUT variantes/<p>/<v>`), `src/clienteTN.js` (cliente + puras) y
  `src/ConexionTN.jsx` (banda, `CeldaTN`, `BuscadorTN`, `PanelActualizarTN`).
  **`clienteTN.js` no se puede llamar `tiendanube.js`**: choca con `TiendaNube.jsx`.
- **La app la crea Franco** en el portal de Partners de Tiendanube, con scope
  `write_products` y redirect `https://kukune.com.ar`. Todas las URLs de la app
  son obligatorias (admin, preferencias, privacidad, los tres webhooks de datos
  —store redact, customer redact, data request— y soporte): alcanzan páginas de
  kukune.com.ar. **Si la redirección queda en la que viene por defecto**
  (`partners.tiendanube.com/applications/authentication/<id>`), al aceptar pide
  el login de socio en vez de volver con el `code`.
  `TN_CLIENT_ID` y `TN_CLIENT_SECRET` van en `.env.local`; sin ellos la pestaña
  lo dice. Token en `datos/tn/tokens.json`, con el `app_id`: con otra app se lee
  "no conectado". **El token no vence**: no hay renovación que cuidar.
- Conectar: igual que ML, Tiendanube vuelve a kukune.com.ar con `?code=` (dura
  5 minutos) y Franco pega la dirección en un `Dialogo`. Se verifica el `state`.
- **Doc oficial: https://tiendanube.dev** (la de antes,
  tiendanube.github.io/api-documentation, quedó vieja). "Autenticación" y
  "Product Variant" de la 2025-03 son las páginas que se usaron. Para probar
  con la API real sin la tienda de verdad, el portal de socios permite crear
  una **tienda de demostración** e instalar la app ahí.
- API:
  `https://api.tiendanube.com/2025-03/<store_id>`, `Authorization: Bearer` y
  **`User-Agent` obligatorio** (sin él, 400). Tope 2 pedidos/s: todo va de a uno
  (`RESPIRO_MS` en el panel). `GET /products` pagina de a 200 y pasada la
  última devuelve **404 "Last page"**, que no es error.
- **Precio y stock son de la variante.** El vínculo es `publicacionTN:
  {productId, variantId}` en el perfume, puesto a mano (el buscador arranca con
  el nombre sin la medida y no muestra las ya vinculadas a otro perfume). Sin la
  clave = sin vincular, sin migración.
- **Precio promocional, decidido al mandar** (pedido de Franco, no se guarda en
  el catálogo): el precio de la app es lo que **paga el cliente**. Con promoción
  va en `promotional_price` y `price` se infla para mostrarse tachado; sin
  promoción va en `price` con `promotional_price: null` (si tenía, se saca).
  **Tiendanube puede ignorar ese `null`** sin dar error: le pasó a Franco, quedó
  el promocional viejo con el precio normal bajado al mismo valor y la tienda
  mostraba "0% OFF". La doc no dice cómo se borra, así que el server mira la
  respuesta del PUT: si el promocional sigue, reintenta con `""`, y si aun así
  queda, responde error ("sacalo a mano") en vez de "ok". Una variante con
  promocional ≥ precio (`promoRota` en `cambiosParaTN`) no cuenta como
  "coincide": sale tildada en el panel, con "se ve 0% OFF". El reintento con
  `""` se probó solo contra la Tiendanube falsa; falta confirmarlo con la real. La
  ganancia no cambia: el descuento por medio de pago de Tiendanube se combina con
  el promocional por defecto (Centro de Ayuda), así que las cuentas de siempre
  valen sobre `precioTN`.
- Tachado: `precioTachadoTN(precio, descuento, redondeo)` en `precios.js`,
  `precio / (1 − d)` **hacia arriba** al redondeo de Tiendanube; el % que se ve
  queda igual o un poco mayor (20% sobre $123.000 → $154.000, se ve 20,1%).
  `ajustes.tiendaNube.descuentoMostrado` (default 20%, con candado) es solo el
  que se **propone**; no entra en ninguna cuenta.
- En el panel cada renglón arranca **como está publicado**: con promoción
  prendida y el % exacto que se ve hoy (`descuento`, sin redondear) o apagada.
  **El % mostrado redondeado (20,3%) no se usa para recalcular**: daba un tachado
  de $136.100 donde había $136.000 y el renglón figuraba como cambio sin serlo.
  Recién al editar el % se pasa a `pct / 100`. Un renglón que no cambiaría nada
  dice "igual" y no se manda; "Mostrar también los que ya coinciden" deja prender
  o apagar la promoción a los que ya tienen el precio bien.
- **Stock**: desde el buscador de la variante vinculada, con `Dialogo`. Va por
  `POST /products/<p>/variants/stock` con `{action: "replace", value, id}`, el
  endpoint que la doc da para eso: escribe en la ubicación por defecto, haya o
  no Múltiples Ubicaciones. Antes de escribir se lee la variante: si su
  `inventory_levels` (solo existe con Múltiples Ubicaciones, que depende del
  plan) trae más de una ubicación, **no se toca nada** (409: habría que elegir
  en cuál). Se mira en la variante y no en `GET /locations` porque eso pediría
  el permiso `read_locations`. `stock_management: false` = infinito.
- **Probado solo en la copia, con Tiendanube falsa** (un `fetch` que intercepta
  `api.tiendanube.com` y `www.tiendanube.com/apps/authorize/token`): conectar,
  vincular, prender y apagar promociones, stock con y sin varias ubicaciones.
  Con la tienda real, primero solo leer; los primeros cambios los hace Franco.

## Ofertas en Tiendanube
- **Dos cosas distintas que se ven parecido en la tienda.** La "promoción" del
  panel de Actualizar es **inflada**: el cliente paga `precioTN` y el `price` se
  infla para mostrarse tachado. La ganancia no cambia, es vidriera. La
  **oferta** es de verdad (pedido de Franco, para la sección Ofertas de la web):
  el tachado es `precioTN` y el cliente paga menos. Son excluyentes por perfume.
- `ofertaTN: { descuento, desde }` en el perfume (fracción; `desde` es solo
  informativo). Sin la clave = sin oferta, sin migración, abrir no escribe.
  **Sin fecha de fin** (decisión de Franco): dura hasta que se saca.
- `precioTN` sigue siendo el precio normal y sigue saliendo de su objetivo; la
  oferta cuelga de él. `precioOfertaTN(precio, d, redondeo)` en `precios.js`
  redondea **hacia abajo** al redondeo de Tiendanube (el % que se ve nunca es
  menor al anunciado: 15% de $123.000 con $1.000 → $104.000, se ve 15,4%).
  `ofertaDeTN(perfume, ajustesTN)` y `pagaEnTN()` son los atajos.
- Lo que queda: `analisisTiendaNube({precio: oferta})`, sin tocarlo. El
  promocional es el precio del producto en el carrito, así que envío desde un
  monto, mínimos y descuento del medio de pago (combina con el promocional) salen
  solos. `impactoDeCupon` mide sobre `pagaEnTN`: un cupón real va sobre el
  promocional.
- **Se pone y se saca en el detalle del precio** (`DetalleTiendaNube`, bloque
  "Oferta"): el % se tantea en estado local y solo "Poner en oferta" escribe en
  el catálogo. Con el % puesto la tabla muestra lo que deja cada forma con la
  oferta y no se edita el margen (es el del precio normal). En la fila: renglón
  "oferta −15% · $X" bajo el precio y "en oferta $Y" bajo la Ganancia, que sigue
  siendo la del precio normal. Botón-filtro "N en oferta" con la regla de los demás.
- **Mandar**: `cambiosParaTN(perfumes, productos, ajustesTN)` distingue en lo
  publicado la inflada (`price > precioTN`) de la oferta (`price <= precioTN`, o
  el producto ya está en la categoría de ofertas). Un perfume que **dejó** de
  estar en oferta arranca sin promoción en el panel: si arrancara "como está
  publicado", la oferta vieja quedaría como promoción inflada.
- **La sección Ofertas es una categoría de Tiendanube** que Franco crea en el
  panel y elige en los ajustes ("Categoria de ofertas",
  `ajustes.tiendaNube.categoriaOfertas`; no mueve precios, así que va sin
  candado). Al mandar, los en oferta entran y los que salieron se sacan, primero
  el precio y después la categoría. `PUT /api/tn/productos/<id>/categorias`
  relee el producto y manda la lista **completa**: en `PUT /products/<id>`,
  `categories` **reemplaza** la lista (doc "Product" 2025-03; vacía deja el
  producto sin categorías). Sin categoría elegida, la sección no se toca.
- **Por qué no es una promoción nativa de Tiendanube** ("% off" del panel de
  Promociones), para no volver a investigarlo: el `POST /promotions` público
  (doc "Discount" 2025-03) es para apps que son el motor de descuentos y exige
  una URL de callback pública que Tiendanube llama en cada cambio de carrito; si
  no contesta, borra los descuentos. La app corre en la compu de Franco, así que
  no sirve. Franco pidió **todo desde la app**, sin el conector de Tiendanube.
- No se ajustaron a la oferta la calculadora del envío gratis ni `zonaEnvioTN`:
  siguen mirando `precioTN`.
- Probado en la copia con Tiendanube falsa: poner en oferta llevó
  `{"price":119000,"promotional_price":101100}` y `{"categories":[5,77]}`;
  sacarla, `promotional_price: null` y `[5]`. Con la tienda real, la primera
  la manda Franco.

## Conexión con Mercado Libre
- Pestaña **Mercado Libre** (`vista === "mercadolibre"`). Además de los precios
  por plan, vincula cada plan con su publicación real y le manda precio y stock.
  Además, las secciones **Ventas**, **Publicar** y **Actualizar** (ver abajo). Las preguntas
  todavía no están.
- Es la app propia de Franco en el DevCenter (su ID está en `.env.local`). Es la
  **misma app que usa el conector de ML de Claude**, que solo da documentación:
  por eso tiene **dos Redirect URIs** — la de claude.ai (del conector, no
  borrarla) y `https://kukune.com.ar` (la de esta pestaña). Sin la segunda, ML
  muestra "Lo sentimos, la aplicación no puede conectarse a tu cuenta". Para
  escribir, la app necesita scopes de lectura **y escritura**.
- **El secret y los tokens no llegan nunca al navegador.** `vite-plugin-ml.js`
  (enganchado a dev y preview) habla con ML y expone `/api/ml/*`. La app se
  configura en `.env.local` (ignorado): `ML_CLIENT_ID` y `ML_CLIENT_SECRET`
  (obligatorios; el ID **no se escribe en el código**, a pedido de Franco: si
  falta alguno, la pestaña lo dice y no ofrece Conectar) y `ML_REDIRECT_URI`
  (opcional, por defecto `REDIRECT_POR_DEFECTO`). Cambiar de app es editar ese
  archivo y reiniciar. Tokens: `datos/ml/tokens.json`, que
  guarda de qué `app_id` son: con otra app se leen como "no conectado" y se
  vuelve a conectar. Los vínculos con publicaciones no dependen de la app.
  El cliente es `src/clienteML.js` — **no se puede llamar `mercadolibre.js`**: en
  Windows choca con `MercadoLibre.jsx` y `import "./MercadoLibre"` agarra el que no es.
- **El refresh token de ML rota en cada uso.** Se guarda siempre el nuevo y las
  renovaciones van de a una (`renovando`); dos a la vez queman el token.
- Hubo un script suelto de preguntas (`mercado_libre/preguntas-ml.ps1`), nunca
  usado; se borró. Las preguntas, cuando se hagan, van en esta pestaña.
- Conectar: ML no acepta `localhost` como redirect, así que vuelve a
  kukune.com.ar y Franco pega esa dirección en un `Dialogo`. La pestaña de ML se
  abre **en el clic, antes del `await`**: abierta después, el navegador la toma
  como popup y la bloquea.
- **El vínculo:** `publicacionesML` en el perfume, mapa `plan → MLA…`, gemelo de
  `preciosML`. Aparece en `perfumes.json` solo cuando Franco elige una
  publicación; sin la clave = sin vincular, sin migración. **Nunca se empareja
  solo**: el buscador arranca con el nombre del perfume, pero se elige.
- El buscador **no muestra las publicaciones ya vinculadas** en otro lado (otro
  plan, otro perfume, o la otra mitad —normal/catálogo— del mismo plan), salvo la
  de ese mismo vínculo, con su tilde. Pedido de Franco: al vincular la de
  catálogo aparecía la normal. Abajo hay un "Mostrar las N ya vinculadas" que
  las trae marcadas "ya en …", para mover una sin desvincularla antes.
- **Las cuotas de una publicación salen del tipo + los `tags`** (no hay campo
  propio; doc "Campañas con cuotas para Marketplace"), en
  `cuotasDePublicacion()` de `clienteML.js`: `gold_pro` (Premium) sin tag = 6
  cuotas sin interés, con `3x_campaign`/`9x_campaign`/`12x_campaign` = 3/9/12;
  `gold_special` (Clásica) = 1 pago, o con `pcj-co-funded` = "3 a 12 cuotas con
  interés bajo" (las elige el comprador; la API no dice cuántas: plan `null`).
  Por eso `ATRIBUTOS` del plugin pide `tags`. ML ya no las llama Clásica/Premium,
  así que el buscador y los `title` muestran las cuotas. El buscador ordena
  primero las del plan que se vincula y avisa en óxido las que no son
  (`avisoDePlan`); la celda vinculada a un plan que no es el suyo lleva un `!`.
  Solo avisa: no impide vincular.
- Las publicaciones de catálogo llevan el título del producto de ML, que **no
  suele traer la medida** ("Lattafa Musamam Black Intense Eau De Parfum"). Por
  eso el buscador de catálogo arranca con el nombre **sin** "100ml"
  (`sinMedida`), y en los dos "100 ml" y "100ml" valen igual (`paraBuscar`).
  Antes las de catálogo del Musamam no aparecían.
- **Cada plan tiene dos vínculos: la publicación normal y la de catálogo.** La de
  catálogo va en `publicacionesCatalogoML`, mapa gemelo `plan → MLA`, y **no**
  adentro de `publicacionesML`: así lo que manda precios no cambió. **La de
  catálogo no recibe precios ni stock desde la app**: ML la sincroniza sola con la
  normal (doc "Publicar en catálogo": la sincronización es automática y no se
  puede desactivar; Franco lo comprobó: actualizar la normal movió la de
  catálogo). Se vincula para ver su precio y para que **Ventas** cuente sus
  ventas con el perfume y su costo (`indiceDePublicaciones` lee los dos mapas; la
  fila sale marcada "catálogo"). En la celda es el renglón chico de abajo, que
  aparece solo si el plan ya tiene la normal; el buscador pone primero las de
  catálogo, avisa que no recibe precios y no ofrece cambiar stock.
- **ML pasa el precio a la de catálogo unos segundos después**, no en el mismo
  momento. Por eso, tras "Actualizar precios en ML" se relee enseguida y otra vez
  a los `RELEER_TRAS_ACTUALIZAR` (10 s). Mientras la normal ya tiene el precio de
  la app y la de catálogo no, la de catálogo dice "sincronizando" en gris, no en
  óxido: no es un error. Antes había que recargar la página para verla al día.
- La celda "En ML" muestra el precio publicado: verde si coincide con el del
  catálogo, óxido si no (compara, no es ganancia: nada de ámbar).
- **"Actualizar precios en ML"** relee las publicaciones, arma
  `cambiosParaML(perfumesResueltos, publicaciones, planes)` (pura, en
  `clienteML.js`) y muestra **todos** los cambios con tilde por renglón. Nada se
  manda hasta confirmar; va de a uno y el resultado queda en cada renglón. Sale
  de la lista **resuelta**: con el estado crudo, los clavados irían con el precio
  viejo. Las publicaciones con variaciones no se tocan (el server las rechaza).
- El stock no vive en el catálogo: ML es la fuente. Se cambia desde el buscador
  de una publicación vinculada, con confirmación.
- **Probar sin tocar ML real**: en la copia del scratchpad se le agrega al final
  de su `vite-plugin-ml.js` un `fetch` falso que intercepta
  `api.mercadolibre.com` (y un `.env.local` con un secret de mentira). Las
  escrituras en ML real las decide Franco, una por una.

## Ventas de Mercado Libre
- Sección **Ventas** de la pestaña ML (selector Precios | Ventas, estado de
  pantalla). **Solo lectura**: no escribe en ML ni en `datos/`. Piezas:
  `GET /api/ml/ventas?desde&hasta` (AAAA-MM-DD, hora de Argentina) en
  `vite-plugin-ml.js`, `gananciasDeVentas()` en `src/gananciasML.js` (pura,
  probada desde Node) y la pantalla `src/VentasML.jsx`.
- **`gananciasML.js` no se puede llamar `ventasML.js`**: en Windows choca con
  `VentasML.jsx`, igual que `clienteML.js` con `MercadoLibre.jsx`. El build falla
  con `"default" is not exported`.
- De dónde sale cada número (doc oficial de ML, consultada con el conector):
  - Órdenes: `/orders/search?seller=…&order.date_closed.from/to`, de a 50, tope
    1000 (si hay más, la respuesta trae `truncado`). Cuentan `paid` y
    `partially_refunded` (marcada); canceladas y sin pagar se cuentan aparte.
  - Ingreso = `unit_price × quantity` (`unit_price` ya trae los descuentos).
  - Comisión = `sale_fee × quantity`: **`sale_fee` es por unidad**. Se cruza con
    `payments[].marketplace_fee`; si difieren en más de $1 la fila se marca. Si
    eso aparece con ventas reales de varias unidades, el supuesto está mal.
  - Envío = `senders[].cost` del vendedor en `/shipments/<id>/costs` (header
    `x-format-new: true`; la FAQ de ML lo da como la fuente para conciliar). Un
    carrito comparte envío entre varias órdenes: se pide **una vez por envío** y
    se reparte entre sus ítems **por ingreso**, el último se lleva el redondeo y
    la suma cierra exacta. Si ML no lo devuelve, la fila va con "?" y sin envío.
  - Impuestos = retenciones que **Mercado Pago** descuenta del cobro (IIBB de
    la provincia y demás). **No vienen en la orden**: están en el pago,
    `GET https://api.mercadopago.com/v1/payments/<id>` (mismo token que ML; los
    ids salen de `order.payments`), en `charges_details` con `type: "tax"` y
    `accounts.from: "collector"`, `original − refunded`. Se suman los pagos
    aprobados de la orden y se reparten entre sus ítems por ingreso, como el
    envío. Si MP no devuelve un pago, la orden va con "?" y sin impuestos.
    `nombreDeImpuesto()` traduce "tax_withholding-santa_fe" a "Retención IIBB
    Santa Fe". Verificado contra una venta real del Urban Elixir (14/10):
    98.200 − 15.045,07 − 8.290 − 3.437 = 71.427,93, el neto de MP al centavo.
  - Ese mismo pago trae también la comisión (`meli_percentage_fee`) y el envío
    (`shp_…`), y `transaction_details.net_received_amount`. Hoy la comisión y el
    envío siguen saliendo de la orden y de `/shipments`; el pago queda como
    fuente para cruzarlos si algún día no cierran.
- El cruce venta → perfume es `publicacionesML` y `publicacionesCatalogoML` de la
  lista **resuelta**, nunca por nombre. Lo que no está vinculado va en una tabla aparte, con ingreso,
  comisión, envío y "te queda" (en tinta: no es ganancia), **sin costo inventado**.
  Un perfume vinculado sin costo: ganancia "—" y no entra en el total.
- Ganancia = ingreso − comisión − envío − impuestos − costo; margen = ganancia ÷ costo, la
  misma cuenta que la columna Margen de los pedidos. Ámbar solo en la ganancia.
- **El costo es el que regía en el instante de la venta**, no el de hoy (pedido
  por Franco: el costo cambia después de vender). Para eso existe
  `historialCostos: [{desde, costo}]` en el perfume, `src/historialCostos.js`:
  - `registrarCosto(perfume, costo, ahora)` es **el único camino** para cambiar
    un costo: lo usan `cambiarPerfume` (la celda del catálogo) y
    `aplicarAlCatalogo` ("pasar costos al catálogo"). Si se agrega otro lugar que
    escriba `costo`, tiene que pasar por ahí.
  - `desde` es un instante ISO **con hora** (elegido por Franco: dos cambios en
    el mismo día quedan los dos). `null` = "desde antes del historial": sale del
    costo que había al primer cambio, así lo vendido antes usa ése.
  - Cambios a menos de 2 minutos de la última entrada la **reemplazan**:
    `NumberCell` escribe en cada tecla y "65000" dejaría 6, 65, 650… Volver al
    costo anterior (Escape) quita la entrada.
  - `costoEnFecha(perfume, instante)`: la última entrada con `desde <=` venta.
    Si cae en la de `null` o el perfume no tiene historial, el costo va con `~`
    (aproximado: no se sabe si antes hubo otros cambios).
  - Abrir la app no escribe: el campo aparece en `perfumes.json` recién con el
    primer cambio de costo de cada perfume.
- En desarrollo la sección pide las ventas dos veces al entrar: es `StrictMode`.

## Publicar en Mercado Libre
- Botón **"Publicar"** en la fila del perfume (pestaña ML → Precios), al pasar
  el mouse, si algún plan no tiene publicación vinculada. Abre `PublicarML.jsx`
  (portal, z 55: debajo del `Dialogo`, que confirma encima). Server:
  `ml-publicar.js`, enganchado por `vite-plugin-ml.js`. Puras: `src/armadoML.js`
  (sin imports, la usan el server y el panel, probada desde Node). **No se puede
  llamar `publicarML.js`**: choca con `PublicarML.jsx` en Windows (ya pasó).
- **Fotos y texto salen SOLO de `<base>/<Perfume>/Mercadolibre/`** (`base` =
  `KUKUNE_PUBLICACIONES` en `.env.local`, o `../Mi Negocio/branding/publicaciones`).
  **Nada de `Tiendanube/`**, pedido de Franco: cada canal con lo suyo. Esas
  carpetas se leen, nunca se escriben; los nombres que llegan del navegador se
  rechazan si traen barras o `..`. Fotos JPG/PNG en orden de nombre (la primera
  es la principal); las de menos de 500 px (mínimo de ML) no se pueden tildar.
  Si la carpeta no tiene `Mercadolibre/`, el panel dice qué ruta crear.
- Esa carpeta la arma el skill **fotos-mercadolibre**: se llama `MercadoLibre`
  (en Windows es la misma que `Mercadolibre`) y trae fotos `<perfume>_ml_N.jpg` de
  1200×1200 y el texto **`publicacion_ml.txt`** (se acepta también
  `publicacion.txt`: `NOMBRES_TXT` en `armadoML.js`). Del texto: la sección
  TÍTULO es el nombre sugerido de la publicación (`tituloDesdeTxt`); la
  descripción es el resto **sin** TÍTULO, SEO ni "FICHA TÉCNICA DE ML" (esa es
  para completar los campos, no para el comprador), y la referencia al lado del
  formulario es justamente "FICHA TÉCNICA DE ML" si está. Verificado con la
  carpeta real del Lattafa Fahad, solo leyendo.
- La carpeta del perfume **se propone, no se elige sola** (`proponerCarpeta`, por
  palabras). Se marca "sugerida" solo con parecido ≥ 60% y sin empate: con los
  nombres reales, "La Vivacite" se parecía 40% a "Dark Door Sport". Lo elegido se
  guarda en el perfume (`carpetaPublicacion`).
- **La ficha técnica se carga a mano** (decisión de Franco), `CAMPOS_FICHA` en
  `armadoML.js`; los valores de las listas salen de `/categories/MLA1271/attributes`.
  Al lado, solo de referencia, la ficha del texto (ver arriba). Se guarda en
  el perfume (`fichaML`, y `familyNameML`) al tocar Validar.
- **Qué parte de ML cubre `CAMPOS_FICHA`, para no volver a preguntárselo**
  (inventario del 27/10/2026 contra la API): MLA1271 declara **83 atributos**,
  pero **56 son `hidden` y/o `read_only`** —los pone ML: marca destacada,
  paquete de fábrica, tags de búsqueda, impuestos de otros países—. De los que
  carga el vendedor, `CAMPOS_FICHA` tiene **23**, o sea todos los que le sirven
  al negocio. Lo que queda afuera es a propósito: variaciones, tienda oficial,
  suscripciones y loyalty, precios globales, y `VALUE_ADDED_TAX` /
  `IMPORT_DUTY` (son para facturación y acá se publica "No factura"). Las
  promociones, Mercado Ads y la garantía extendida no se cargan al crear el
  ítem: se hacen después en ML.
- **El SKU va como atributo `SELLER_SKU`, no como `seller_custom_field`.** ML
  acepta los dos (probado con `/items/validate`), pero por el atributo entra al
  camino que ya existe: se carga en el mismo formulario, viaja en `attributes`
  y `fichaDesdeAtributos()` lo lee de vuelta en Actualizar, sin código aparte.
  No lo ve el comprador. Lo mismo vale para cualquier campo nuevo: si ML lo
  expone como atributo de la categoría, **agregarlo es un renglón en
  `CAMPOS_FICHA` y nada más** — `CampoFicha` ya resuelve texto, numero, lista,
  multi, siono y notas, y los dos paneles son un `CAMPOS_FICHA.map(...)`.
- `PURCHASE_MAX_QUANTITY` (máximo por compra) figura **`read_only`** en la
  categoría, aunque la app lo manda, ML no se queja y el Musamam lo tiene en 2.
  Puede ser que lo ignore en silencio. Mirarlo recién con una publicación real.
- Lo que pide ML (doc + la publicación real del Musamam): categoría **MLA1271**.
  La cuenta está en **User Products** (`user_product_seller`): **no se manda
  `title`, se manda `family_name`** y ML arma el título. Obligatorios: BRAND,
  PERFUME_NAME, UNIT_VOLUME y GTIN o EMPTY_GTIN_REASON. Plan → tipo con
  `tipoDePlan()` (el inverso de `cuotasDePublicacion`). Multivaluados (familias,
  notas) van como `values: [{name}]`.
- **Condiciones** (garantía, factura, máximo por compra, medidas del paquete) en
  `ajustes.publicacionML`, editables en el panel. El arranque
  (`CONDICIONES_POR_DEFECTO`) es lo que tiene la publicación del Musamam.
- **La facturación (`sale_term` INVOICE) es una lista multivaluada**: va como
  `values: [{id}]`, nunca `value_name`. Con el nombre, ML deja el valor en
  `null` y rechaza la publicación entera ("Sale term INVOICE has an invalid
  value (null). Allowed values are [6891885, 6891886, 6891887, 6891888]"). Los
  cuatro ids son Factura A/B/C y No factura, en ese orden
  (`VALORES_FACTURA` en `armadoML.js`, de `GET /categories/MLA1271/sale_terms`,
  verificados contra la publicación real del Musamam: 6891888). Por eso el
  campo Factura del panel es un **desplegable, no texto libre**: escrito a mano
  ("C") no era un valor de ML. `idDeFactura()` traduce lo que haya guardado
  —id, nombre o lo tipeado— así que el ajuste viejo no se reescribe.
  El resto de los `sale_terms` (garantía, máximo por compra) **sí** van con
  `value_name`: no son multivaluados.
- **El envío va explícito: `shipping: {mode: "me2", local_pick_up: false}`**,
  como el Musamam. Sin eso ML prueba con me1, que la cuenta de Franco no tiene.
  Si es gratis y con qué `logistic_type` lo decide ML, no la app.
- **`/items/validate` contesta 400 aunque lo único que haya sean advertencias**,
  así que el `ok` del HTTP da falso con la publicación impecable. Lo que decide
  es que no haya causas de `type: "error"` — por eso `validar()` arma su `ok`
  desde `errores`, no desde `r.ok`. Las dos advertencias que esta cuenta recibe
  siempre van traducidas (`EN_CASTELLANO` en `ml-publicar.js`): "no tenés me1"
  (no es un problema) y **"envío gratis obligatorio"**, que sí importa porque
  es plata: a ese precio ML obliga a envío gratis y lo paga el negocio. El
  panel lo avisa arriba de los resultados; la ganancia de la app ya lo
  descuenta con `ajustes.envioML`.
- **El Stock tiene renglón propio en el paso 3**, con la aclaración al lado en
  pantalla ("uno solo para todos los planes: ML comparte el stock entre las
  publicaciones del mismo perfume"). Antes era una columna de 120px apretada a
  la derecha del nombre de la publicación, con esa aclaración en un `title`:
  Franco lo usó y dio por hecho que **no se podía poner el stock**. La lección
  sirve para todo el panel: lo que explica un campo va escrito, no en un
  `title` que nadie va a descubrir pasando el mouse.
- **Validar no publica**: sube las fotos y corre `POST /items/validate` por plan.
  ML **no tiene sandbox**: lo publicado es real. "Publicar N" se habilita solo si
  todo validó, cualquier cambio obliga a validar de nuevo, y pide confirmación.
  El server **vuelve a validar** antes de crear: si alguna no pasa, no crea ninguna.
  Después va de a una: `POST /items`, `/description`, espera a que ML le asigne
  `catalog_product_id` (hasta 4 × 2,5 s) y crea la de catálogo con
  `POST /items/catalog_listings`. Lo creado queda vinculado aunque falle lo
  siguiente; nada se reintenta solo.
- Las fotos se suben **una vez**: el id de ML se recuerda por sha1 del archivo en
  `datos/ml/fotos-subidas.json` (archivo aparte, no es del negocio).
- Al terminar relee las publicaciones nuevas y dice si quedaron **como el
  Musamam**: las 4 (normal y catálogo de 1 pago y 6 cuotas) en el **mismo User
  Product** —comparten stock— y cada normal con `item_relations` a su de
  catálogo. Si no, lo marca en óxido; no corrige nada.
- `mlCrudo()` en el plugin devuelve `{ok, status, datos}` sin tirar error (hace
  falta leer `cause` en los 400), y solo pone `content-type: json` si el cuerpo
  es texto: una foto va como `FormData` multipart.
- **Probado solo en la copia, con ML falso.** La primera publicación real la hace
  Franco con un perfume que elija.

## Actualizar una publicación
- Botón **"Actualizar"** en la fila (al lado de "Publicar") cuando el perfume
  tiene alguna publicación normal vinculada. Abre `ActualizarML.jsx`: fotos,
  ficha técnica, nombre y descripción. **Precio y stock no**: siguen en sus botones.
- **Solo las normales.** Las de catálogo llevan las fotos y la ficha del
  producto de catálogo de ML, no las del vendedor (aclaración de Franco), y el
  server rechaza un PUT a una de catálogo.
- **Las fotos se eligen una por una** (pedido de Franco): en ML, `PUT /items/<id>`
  con `pictures` deja exactamente la lista que se manda, en ese orden, y borra el
  resto; para conservar una se manda su `id` (doc "Imágenes", Reemplazar
  imágenes). El panel arma la tira **"Así va a quedar"** (`TiraDeFotos` en
  `ActualizarML.jsx`), que arranca igual a la de hoy: quitar (X), mover (← →, la
  primera es la principal), "Volver a poner" las quitadas, y "Agregar" las de la
  carpeta (`SelectorDeFotos` con `onAgregar`). Atajos: "Reemplazar todo por la
  carpeta" (lo de antes) y "Volver a como está en ML". Cada elemento es
  `{tipo: "ml", id, url}` o `{tipo: "carpeta", archivo}`; `resumenDeFotos()` en
  `armadoML.js` dice si cambia ("3 fotos · 1 se quita · 1 nueva · cambia el
  orden") y `fotosDeLaTira()` en `ml-publicar.js` sube solo las de la carpeta
  (una vez, por sha1) y arma `pictures` en el orden de la tira. Si se quita
  alguna, la confirmación va en óxido y dice cuántas se borran. Probado en la
  copia con ML falso: el PUT llevó `[VIEJA-3, VIEJA-1, FOTO-2]`.
- Lee lo que hay hoy en ML (`GET /api/ml/publicacion/<MLA>`) y precarga la
  ficha con `fichaDesdeAtributos()` (el inverso de `atributosDeFicha`).
  `cambiosDeActualizacion()` arma el resumen y **solo manda lo que cambió**
  (verificado: el PUT de prueba llevó solo las fotos y `BRAND`). Notas con otro
  espaciado o familias en otro orden no cuentan como cambio, y **vaciar un campo
  tampoco**: borrar un atributo en ML es otra operación.
- Fotos, ficha y nombre se sincronizan solos entre las del mismo **User
  Product**: se manda **una por producto de usuario** (`grupos`) y después se
  releen todas las normales (`/api/ml/publicaciones/estado`): "ya tiene los
  cambios", "sincronizando" (gris) y una segunda lectura a los 10 s; si sigue
  distinta, óxido.
- El **nombre** (`family_name`) se traba si alguna del producto ya vendió: ML no
  deja cambiarlo. El Musamam real tiene 4 ventas.
- Las piezas comunes con Publicar (carpeta y fotos, ficha, rótulos) viven en
  `src/piezasPublicarML.jsx` (`useCarpetaML`, `SelectorDeFotos`, `CampoFicha`).
- Leído contra el Musamam real con GET (solo lectura): 7 fotos, ficha completa,
  y la marca en ML está escrita **"Lataffa"**. El primer PUT real lo hace Franco.

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
- En la mesa ya no se clava margen ni hay botón masivo (ver "Al tocar la
  tabla"): `resolverPrecios()` sigue resolviendo las filas clavadas de antes,
  que cuentan como precio a mano.
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
- Tiene **15 columnas**: Producto (Incluir, Producto, Foto, Cantidad), Costo (6,
  con **Costo catálogo** después de Precio s/Ganancia),
  **Venta directa** (Precio Final, Margen), Resultado (Ganancia, Ganancia total)
  y acciones. `ParPrecioMargen` renderiza el par de Venta directa. Si agregás o
  sacás una columna hay que actualizar, además del `<ColHead>` y el `<td>`, los
  `span` de `<GroupHead>` (4 + 6 + 2 + 2) y `COLUMNAS_PEDIDO` (el `colSpan` del
  estado vacío y del pie).
- **Costo catálogo** (`CostoDelCatalogo`, pedido de Franco): el `costo` que tiene
  hoy el perfume en el catálogo, en vivo, para compararlo con el Precio
  s/Ganancia sin pasar el mouse por la flecha del pase. Debajo, en chico, "igual"
  si coinciden y "pasado dd/mm" si esa fila ya se pasó desde este pedido. Solo
  lectura; sin perfume, huérfana o sin costo: "—".
- **Mercado Libre salió de la mesa** (pedido de Franco: tiene su pestaña). Se
  fueron Vende ML, Comisión ML, Otras %, Envío ML, Costo Venta ML, el campo
  global "Comisión ML" y, como sin ML la ganancia bruta es el mismo Precio
  Final, también Gan. Bruta y Gan. Bruta Tot. **`calcular()` no cambió**: la
  lista que entra al motor (`productosVista`) trae `vendeML: false` en todas las
  filas, el camino que ya seguían los pedidos cerrados (todos estaban sin ML al
  hacer esto, así que ningún número cambió). Los campos `vendeML`, `envioML`,
  `otrasComis` y `comisionML` siguen en los datos, sin usarse.
- **Precio Final sale del catálogo** (venta directa, `precioPublico`), en vivo:
  una fila sin precio propio (`precioFinal` 0 y sin `margenObjetivo`) toma el
  del catálogo y dice "del catálogo"; escribir un precio la deja "a mano" (con
  una flecha para volver: `volverAlCatalogo` la pone en 0). El Margen es solo
  lectura: lo que deja ESTE pedido, con su costo, a ese precio.
  - **Eso vive en `productosVista`, no en lo que se guarda** (`productosResueltos`):
    si entrara, abrir un pedido lo reescribiría cada vez que el catálogo tenga
    otro precio. Verificado en la copia: abrir Fraganti no cambió su md5.
  - **Al cerrar**, `congelarPrecios()` escribe en las filas el precio del
    catálogo de ese momento, marcado `precioDelCatalogo: true`, y apaga ML: el
    cerrado es un registro y no sigue al catálogo. **Al reabrir**,
    `soltarPreciosCongelados()` devuelve esas filas a 0 (vuelven a seguirlo); las
    puestas a mano quedan. Las dos van en el mismo movimiento que el estado.
  - Ya **no se clava margen** en la mesa ni existe "Aplicar margen" (el margen se
    fija en el catálogo, donde vive el precio). Una fila clavada de antes cuenta
    como "a mano"; escribirle un precio suelta el margen.
  - Duplicar deja las filas en 0: el pedido nuevo sigue al catálogo.
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

## Los datos del usuario NO se tocan
**Regla dura, por encima de cualquier necesidad de verificar.** `datos/` es el
negocio del usuario: costos, precios y márgenes que no están en ningún otro lado
y que él mismo dijo que si pierde "está en problemas". Ya se perdieron datos dos
veces por probar encima.

- **No escribir ni restaurar nada de `datos/` para verificar.** Ni con respaldo.
  Ni "lo dejo como estaba". La verificación se hace en una **copia del proyecto**
  (repo + `datos/`) en el scratchpad, con su propio `npm run dev` en otro puerto.
  Ahí se puede romper todo.
- Cómo se arma esa copia (probado): copiar `index.html`, los `*.config.js`,
  `vite-plugin-datos.js` y `datos/`, **copiar `src/` de verdad** y sincronizarlo
  con `robocopy /MIR` después de cada edición, y enganchar `node_modules` con un
  *junction* (`mklink /J`). `src/` no puede ser junction: Vite resuelve el enlace
  a la ruta real, la ve fuera del root y sirve el JSX sin transformar ("Unexpected
  token '<'").
- Sobre los datos reales, **solo lectura**: `GET` a la API, leer los JSON, mirar
  el DOM. Nada de clics que guarden.
- **Restaurar un archivo con la app abierta no alcanza**, y por eso ni siquiera
  es una salida de emergencia: el guardado es un `setTimeout` de 800 ms sobre el
  estado de React, así que un temporizador pendiente se despierta después de la
  restauración y vuelve a escribir lo viejo. Si alguna vez hay que restaurar:
  recargar la página primero, restaurar después, verificar el md5 unos segundos
  más tarde — y decírselo al usuario.
- **Lo que aparezca en los datos y no se reconozca es del usuario, no basura de
  una prueba.** Él trabaja en la app mientras nosotros editamos código. Si algo
  no cierra, se pregunta; no se restaura por cuenta propia. Así se borraron
  precios que él había cargado y los cambios que le había hecho a un pedido.
- **No hay red de seguridad, y eso hace esta regla más estricta, no menos.**
  Franco no usa OneDrive (ver "Arquitectura"), así que no existe el historial de
  versiones por archivo: si se escribe encima, no hay a dónde volver. Lo único
  que queda es el `.bak.json` —una sola versión anterior, que rota en la
  escritura siguiente— y `datos/papelera/`. Si alguna vez se escribe encima por
  error, decírselo al usuario enseguida y con la hora exacta: cuanto antes lo
  sepa, más chance hay de que el `.bak` todavía sirva.

## Entorno de esta máquina
- Node no está en el `PATH`: vive en `C:\Program Files\nodejs`. Por eso
  `.claude/launch.json` apunta directo a `node.exe` + `node_modules/vite/bin/vite.js`
  (además, un `spawn npm` en Windows falla porque `npm` es un `.cmd`).
- La carpeta vive adentro de `OneDrive\Escritorio\` (Franco no usa OneDrive, pero
  la ruta es esa) y el watcher de Tailwind a veces no
  ve los archivos nuevos: si una clase recién agregada no aplica, reiniciar
  `npm run dev` regenera el CSS.

## Ideas pendientes (no implementadas)
- **Ventas directas.** Es la pieza que cierra el hueco del stock: hoy una venta
  en mano no descuenta nada. Diseño hablado con Franco, no empezado:
  `datos/ventas/<AAAA-MM>.json` (un archivo por mes: uno por venta serían
  cientos, y uno solo haría que cada venta reescriba el historial entero). La
  venta guarda el `precio` precargado del `precioPublico` y **editable** (el
  familiar al que se le cobra menos) y el **`costo` congelado** con
  `costoEnFecha()`, mismo criterio que `congelarPrecios()` al cerrar un pedido.
  Ganancia = `Σ (precio − costo) × cantidad`, sin comisión ni envío. Pantalla
  `src/VentasDirectas.jsx` con el molde de `VentasML.jsx`, en el catálogo con un
  selector Catálogo | Ventas directas. Si las cuentas salen a un módulo puro,
  **no puede llamarse `ventasDirectas.js`** (choca con el `.jsx` en Windows).
- **Clientes, con Tiendanube como base.** La app no guardaría lista propia: se
  leen de la tienda y al cargar uno nuevo se crea allá. Verificado en la doc
  (`tiendanube.dev/es-AR/api/resources/2025-03/customer`): existen
  `POST /customers` (201), `PUT` y `DELETE` (422 si tiene pedidos); `q` busca por
  nombre, email o identificación; hace falta el scope **`write_customers`**, y
  cambiar scopes **obliga a reinstalar la app** ("Volver a conectar"), como pasó
  con los cupones. **Qué campos son obligatorios al crear no está documentado.**
  **Nunca mandar `send_email_invite`** (le manda un correo al cliente avisándole
  del registro: una ficha creada porque le vendiste en mano no puede dispararle
  un mail) **ni `password`**; `accepts_marketing` es de solo lectura. La venta
  guardaría `clienteTN` + el nombre del momento, y **el cliente tiene que ser
  opcional**: si la tienda no responde, la venta se guarda igual con el nombre
  como texto libre.
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
