import { analisisTiendaNube, objetivoTN, precioTiendaNubeDesdeObjetivo } from "./precios.js";

/* ============================================================
   Elegir desde qué monto conviene dar envío gratis en Tiendanube.

   NO se puede llamar `envioGratisTN.js`: en Windows choca con
   `EnvioGratisTN.jsx` —el panel que lo usa— y el import agarra el que no es,
   igual que `clienteML.js` con `MercadoLibre.jsx`. El build falla con
   "default is not exported".

   El riesgo del envío gratis con monto mínimo no es el perfume caro que se
   vende solo: ése ya absorbe el envío en su precio. Es el CARRITO que cruza el
   monto sumando frascos baratos que no lo absorbieron — el negocio paga un
   envío que ningún precio pagó. Por eso el número que decide es "el peor
   carrito que califica": si ése deja bien, ninguno deja mal.

   Todo acá es puro y se prueba desde Node. La cuenta de cada carrito la hace
   `analisisTiendaNube`, que es la de siempre: un carrito de varios frascos es
   un costo total y un precio total, y la función ya mide los mínimos de las
   formas de pago contra lo que paga el carrito entero y descuenta un solo
   envío. No hay una segunda cuenta que pueda desfasarse.
   ============================================================ */

/* Qué deja UN carrito. `unidades` es una lista de `{costo, precio}`, una entrada
   por frasco (dos del mismo perfume son dos entradas).

   No se puede sumar la ganancia de cada frasco por separado: una forma de pago
   con monto mínimo —"6 cuotas desde $70.000"— no aplica a un frasco solo pero
   SÍ al carrito de dos, y deja mucho menos. Un carrito puede ser peor que
   cualquiera de sus partes. */
export function gananciaDelCarrito(unidades, ajustesTN = {}) {
  const precio = unidades.reduce((a, u) => a + (Number(u.precio) || 0), 0);
  const costo = unidades.reduce((a, u) => a + (Number(u.costo) || 0), 0);
  const a = analisisTiendaNube({ costo, precio, ajustesTN });
  const f = a.define < 0 ? null : a.formas[a.define];
  return {
    subtotal: a.subtotal,
    costo,
    ganancia: a.ganancia,
    forma: f?.forma?.nombre ?? null,
    paga: f?.paga ?? 0,
    llega: f?.llega ?? 0,
    envioAplicado: a.envioAplicado,
    califica: a.envioCalifica,
  };
}

/* Los perfumes que entran en la cuenta: con costo y con precio de Tiendanube,
   ordenados por precio. Los que no tienen precio todavía no se venden. */
export function itemsDelCatalogo(perfumes) {
  return (perfumes ?? [])
    .filter((p) => Number(p.costo) > 0 && Number(p.precioTN) > 0)
    .map((p) => ({ id: p.id, nombre: p.nombre, costo: Number(p.costo), precio: Number(p.precioTN) }))
    .sort((a, b) => a.precio - b.precio);
}

/* Todos los carritos posibles de 1 a `maxUnidades` frascos, con repetición, con
   lo que deja cada uno SUPONIENDO que tiene envío gratis (que es lo único que
   se le pregunta a un carrito que califica). Por eso la enumeración no depende
   del monto: se hace UNA vez y después cada monto es una búsqueda.

   Se guarda, por subtotal, el carrito que MENOS deja, y un mínimo por sufijo
   encima: `peorDesde(monto)` es `min{ ganancia : subtotal >= monto }`, que es la
   definición exacta y no supone que la cosa sea monótona (no lo es: un mínimo de
   forma de pago la rompe).

   NO se poda por "ya califica, no lo extiendo": parece obvio y es incorrecto,
   porque el carrito más grande puede habilitar una forma con mínimo y dejar
   menos. Con 37 perfumes son ~100.000 carritos y unos milisegundos. */
export function carritosPosibles(items, { maxUnidades = 4, ajustesTN = {} } = {}) {
  // Con envío siempre: la pregunta es qué deja un carrito que ya calificó.
  const conEnvio = { ...ajustesTN, envioGratisDesde: 0 };
  const lista = items ?? [];
  const peorPorSubtotal = new Map();
  let total = 0;

  const sel = [];
  const anotar = () => {
    total++;
    const r = gananciaDelCarrito(sel, conEnvio);
    const previo = peorPorSubtotal.get(r.subtotal);
    if (!previo || r.ganancia < previo.ganancia)
      peorPorSubtotal.set(r.subtotal, { ...r, unidades: sel.map((u) => ({ id: u.id, nombre: u.nombre, precio: u.precio })) });
  };
  const rec = (desde, restantes) => {
    if (sel.length) anotar();
    if (restantes <= 0) return;
    for (let j = desde; j < lista.length; j++) {
      sel.push(lista[j]);
      rec(j, restantes - 1);
      sel.pop();
    }
  };
  if (lista.length) rec(0, maxUnidades);

  const subtotales = [...peorPorSubtotal.keys()].sort((a, b) => a - b);
  // Mínimo por sufijo: `sufijo[i]` es el peor carrito con subtotal >= subtotales[i].
  const sufijo = new Array(subtotales.length).fill(null);
  for (let i = subtotales.length - 1; i >= 0; i--) {
    const aca = peorPorSubtotal.get(subtotales[i]);
    const dsp = sufijo[i + 1];
    sufijo[i] = !dsp || aca.ganancia < dsp.ganancia ? aca : dsp;
  }

  const indiceDesde = (monto) => {
    let lo = 0;
    let hi = subtotales.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (subtotales[m] >= monto) hi = m;
      else lo = m + 1;
    }
    return lo;
  };

  return {
    carritos: total,
    subtotales,
    sufijo,
    indiceDesde,
    maxSubtotal: subtotales.length ? subtotales[subtotales.length - 1] : 0,
    // null = con ese monto no califica ningún carrito de hasta `maxUnidades`.
    peorDesde: (monto) => sufijo[indiceDesde(Number(monto) || 0)] ?? null,
  };
}

/* El monto más chico con el que TODO carrito que califica deja al menos
   `gananciaMinima`. El mínimo por sufijo es no decreciente —sacar carritos solo
   puede subir el mínimo—, así que alcanza con buscar el primero que cumple. */
export function umbralParaGananciaMinima(posibles, gananciaMinima) {
  const minimo = Number(gananciaMinima) || 0;
  const { subtotales, sufijo } = posibles;
  for (let i = 0; i < subtotales.length; i++)
    if (sufijo[i].ganancia >= minimo) return { umbral: subtotales[i], peor: sufijo[i] };
  return null;
}

/* La foto completa de un monto, para el panel y para los scripts de Node.
   `perfumes` son los RESUELTOS: los precios calculados ya adentro. */
export function analisisDelUmbral(
  perfumes,
  ajustesTN = {},
  umbral = 0,
  { gananciaMinima = 0, maxUnidades = 4, posibles: previos } = {}
) {
  const items = itemsDelCatalogo(perfumes);
  const monto = Number(umbral) || 0;
  const paso = Number(ajustesTN.redondeo) > 0 ? Number(ajustesTN.redondeo) : 1;
  const sinMonto = { ...ajustesTN, envioGratisDesde: 0 };
  const conMonto = { ...ajustesTN, envioGratisDesde: monto };

  /* "Uno de cada uno": el mismo criterio con el que la vista previa de la banda
     compara la ganancia total de hoy contra la nueva. */
  const sumar = (ajustes) => items.reduce((a, i) => a + (gananciaDelCarrito([i], ajustes).ganancia ?? 0), 0);
  const gananciaHoy = sumar(sinMonto);
  const gananciaConUmbral = sumar(conMonto);

  // La enumeración no depende del monto, así que se puede traer ya hecha.
  const posibles = previos ?? carritosPosibles(items, { maxUnidades, ajustesTN });
  const peorCarrito = posibles.peorDesde(monto);

  const arriba = items.filter((i) => i.precio >= monto);
  const masBarato = monto > 0 ? (arriba[0] ?? null) : null;
  const masBaratoQueCalifica = masBarato
    ? { ...masBarato, ...gananciaDelCarrito([masBarato], sinMonto) }
    : null;

  /* Qué precios se moverían. Solo los de margen o ganancia clavada: los que
     igualan a la venta directa cuelgan del precio directo y no se mueven, y los
     de precio a mano no se tocan nunca. */
  const seMueven = [];
  for (const p of perfumes ?? []) {
    const objetivo = objetivoTN(p);
    if (!objetivo || objetivo.igualarDirecto || !(Number(p.costo) > 0)) continue;
    const args = { costo: p.costo, precioDirecto: p.precioPublico, ...objetivo };
    const hoy = precioTiendaNubeDesdeObjetivo({ ...args, ajustesTN: sinMonto });
    const queda = precioTiendaNubeDesdeObjetivo({ ...args, ajustesTN: conMonto });
    if (!hoy || !queda || hoy.noAplica || queda.noAplica) continue;
    if (hoy.precio !== queda.precio)
      seMueven.push({
        id: p.id,
        nombre: p.nombre,
        hoy: hoy.precio,
        queda: queda.precio,
        dif: queda.precio - hoy.precio,
      });
  }

  return {
    monto,
    items: items.length,
    debajo: items.length - arriba.length,
    arriba: arriba.length,
    masBaratoQueCalifica,
    peorCarrito,
    gananciaHoy,
    gananciaConUmbral,
    dif: gananciaConUmbral - gananciaHoy,
    seMueven,
    maxUnidades,
    posibles,
    sugerencias: {
      paraGananciaMinima: umbralParaGananciaMinima(posibles, gananciaMinima),
      /* Con este monto ningún perfume califica vendido solo: el envío gratis
         pasa a ser el empujón para el segundo frasco. */
      nadieCalificaSolo: items.length ? items[items.length - 1].precio + paso : 0,
    },
  };
}
