/* ============================================================
   Precio sugerido a partir de un margen objetivo.

   El motor (`calcular`) va del precio al margen. Acá está el camino inverso:
   dado un margen deseado, cuál es el Precio Final que lo produce.

   No hay circularidad: el Factor de Gasto y el Precio sin Ganancia salen de las
   cantidades, los costos base y los globales — ninguno mira el precio de venta.
   Por eso se resuelve en una sola pasada, sin iterar.

   Este módulo es puro y no toca React ni el DOM, así que se puede probar desde
   Node contra el JSON de datos sin abrir el navegador.
   ============================================================ */

/* Las mismas cuentas que hace `calcular()` antes de mirar los precios.
   Vive acá para que el motor y la inversa no puedan quedar desincronizados. */
export function baseDeCostos(globals, productos) {
  const inversionUsdt = productos.reduce(
    (s, p) => s + (p.cantidad || 0) * (p.costoBase || 0),
    0
  );
  const costosExtras = globals.comisionRedUsdt * globals.precioUsdt + globals.envioCorreo;
  const factorGasto = inversionUsdt === 0 ? 0 : costosExtras / inversionUsdt;
  return { inversionUsdt, costosExtras, factorGasto };
}

export function precioSinGanancia(globals, producto, factorGasto) {
  return (producto.costoBase || 0) * globals.precioUsdt + (producto.costoBase || 0) * factorGasto;
}

/* Despeje de `margen = (gananciaBruta − precioSinGan) / precioSinGan`:

     precioFinal = ( precioSinGan × (1 + margen) + envíoML ) ÷ k
     con k = 1 − comisiónML − otrasComisiones   (vendiendo por ML)
         k = 1  y  envíoML = 0                  (si no)

   Devuelve null cuando no hay solución posible: sin costo no hay margen que
   fijar, y con comisiones que se comen todo el precio la cuenta no cierra. */
export function precioDesdeMargen(globals, producto, factorGasto, margen) {
  const sinGan = precioSinGanancia(globals, producto, factorGasto);
  if (!(sinGan > 0)) return null;

  const k = producto.vendeML ? 1 - globals.comisionML - (producto.otrasComis || 0) : 1;
  if (!(k > 0)) return null;

  const envio = producto.vendeML ? producto.envioML || 0 : 0;
  const precio = (sinGan * (1 + margen) + envio) / k;

  // Redondeo: un peso de más o de menos corre el margen en k/sinGan. En un
  // perfume normal eso es 0,001 pp y el peso entero es gratis, pero con un costo
  // base muy chico la sensibilidad se dispara y redondear mentiría — pedís 30%
  // y la pantalla te muestra 32%. Cuando pasa eso se guardan centavos.
  const desvioMaximoPP = 0.5 * (k / sinGan) * 100;
  const redondeado =
    desvioMaximoPP <= 0.05 ? Math.round(precio) : Math.round(precio * 100) / 100;
  return Math.max(0, redondeado);
}

/* Devuelve la lista con el Precio Final ya resuelto en las filas que están
   clavadas a un margen objetivo. Las demás pasan intactas. */
export function resolverPrecios(globals, productos) {
  const { factorGasto } = baseDeCostos(globals, productos);
  let hubo = false;
  const resueltos = productos.map((p) => {
    if (p.margenObjetivo == null) return p;
    const precio = precioDesdeMargen(globals, p, factorGasto, p.margenObjetivo);
    if (precio === null || precio === p.precioFinal) return p;
    hubo = true;
    return { ...p, precioFinal: precio };
  });
  // Si nada cambió se devuelve el mismo array: así los `useMemo` de más arriba
  // no se invalidan y no se dispara un guardado por abrir la pantalla.
  return hubo ? resueltos : productos;
}

/* ============================================================
   Precios del catálogo (no de un pedido).

   Un perfume se vende por dos canales y en cada uno la plata sale distinta:

   · **Directo**: el cliente paga el precio y listo. Si hay que llevárselo, el
     envío se le suma AL PRECIO que se le cotiza — no es un costo del negocio,
     así que no toca ni la ganancia ni el margen.
   · **Mercado Libre**: ML se queda una comisión sobre el precio publicado, más
     el envío, más —si se publica en cuotas— otra comisión encima. Por eso el
     precio de ML es un dato propio y no el precio directo disfrazado.

   Todo esto es aritmética pura: se prueba desde Node sin abrir el navegador.
   ============================================================ */

/* Qué queda de un precio después de que el canal se lleve lo suyo.
   Tener esto suelto es lo que va a hacer barato sumar Tienda Nube: es otro
   canal con su comisión y su envío, no otra fórmula. */
export function resultadoDeCanal({ costo, precio, comision = 0, envio = 0 }) {
  const c = Number(costo) || 0;
  const p = Number(precio) || 0;
  const k = 1 - (Number(comision) || 0);
  if (!(c > 0) || !(p > 0) || !(k > 0)) return { ganancia: null, margen: null };
  const ganancia = p * k - (Number(envio) || 0) - c;
  return { ganancia, margen: ganancia / c };
}

/* El único redondeo de los precios calculados del catálogo, para los tres canales.

   · `redondeo <= 1` ("Sin redondear"): peso más cercano. Un peso corre el margen
     en `k/costo`, que en un perfume normal no se nota, pero con un costo chico se
     dispara y redondear mentiría — pedís 45% y ves 47%. Cuando el desvío pasaría
     de 0,05 pp se guardan centavos.
   · $100 / $500 / $1.000: precio de vidriera, redondeado HACIA ARRIBA para que el
     margen quede igual o un poco por encima del pedido, nunca debajo. La
     tolerancia evita que un 123000.0000001 de coma flotante suba un escalón.

   `k` es lo que queda de cada peso después de las comisiones (1 si no hay). */
export function redondearPrecio(precio, { redondeo = 1, k = 1, costo } = {}) {
  const r = Number(redondeo) > 1 ? Number(redondeo) : 1;
  if (r > 1) return Math.ceil(precio / r - 1e-9) * r;
  const desvioMaximoPP = 0.5 * (k / costo) * 100;
  return desvioMaximoPP <= 0.05 ? Math.round(precio) : Math.round(precio * 100) / 100;
}

/* Precio promocional de Tiendanube: el precio de la app (el que deja la
   ganancia) es lo que paga el cliente, y el normal se infla para mostrarse
   tachado. `precio / (1 − descuento)` redondeado SIEMPRE hacia arriba ("Sin
   redondear" = al peso siguiente), así el descuento que se ve queda igual o un
   poco mayor al pedido. No entra en ninguna cuenta de ganancia.
   -> el precio tachado, o null si no hay precio o el descuento no tiene sentido. */
export function precioTachadoTN(precio, descuento, redondeo = 1) {
  const p = Number(precio) || 0;
  const d = Number(descuento) || 0;
  if (!(p > 0) || !(d > 0) || !(d < 1)) return null;
  const r = Number(redondeo) > 1 ? Number(redondeo) : 1;
  return Math.ceil(p / (1 - d) / r - 1e-9) * r;
}

/* El descuento que se ve en la tienda con un precio tachado: 1 − precio ÷ tachado. */
export const descuentoVisto = (precio, tachado) =>
  Number(tachado) > 0 && Number(precio) > 0 ? 1 - Number(precio) / Number(tachado) : null;

/* El precio a publicar en un canal para que quede la MISMA ganancia que se
   hace vendiendo directo. Despeje de `precio·k − envío − costo = ganancia`. */
export function precioParaIgualar({ costo, ganancia, comision = 0, envio = 0, redondeo = 1 }) {
  const c = Number(costo) || 0;
  const k = 1 - (Number(comision) || 0);
  if (!(c > 0) || ganancia == null || !(k > 0)) return null;
  const precio = (c + ganancia + (Number(envio) || 0)) / k;
  return redondearPrecio(precio, { redondeo, k, costo: c });
}

/* El camino inverso de la venta directa: dado un margen, qué precio lo produce.

   Acá no hace falta el despeje de los pedidos: vender directo no tiene comisión
   ni envío a cargo del negocio, así que `margen = (precio − costo) / costo` se
   da vuelta solo.

   Redondea con `redondearPrecio` (sin comisión: k = 1). */
export function precioPublicoDesdeMargen(costo, margen, redondeo = 1) {
  const c = Number(costo) || 0;
  // `margen == null` va aparte: `Number(null)` es 0, y devolver el costo como
  // precio sería poner el margen en cero sin que nadie lo haya pedido.
  if (margen == null) return null;
  const m = Number(margen);
  if (!(c > 0) || !Number.isFinite(m)) return null;
  return Math.max(0, redondearPrecio(c * (1 + m), { redondeo, k: 1, costo: c }));
}

/* Lo mismo con una ganancia fija en pesos: `costo + ganancia`. La ganancia
   queda fija aunque cambie el costo (también si lo mueve el dólar): sube el
   costo, sube el precio. Mismo redondeo que el margen. */
export function precioPublicoDesdeGanancia(costo, ganancia, redondeo = 1) {
  const c = Number(costo) || 0;
  if (ganancia == null) return null;
  const g = Number(ganancia);
  if (!(c > 0) || !Number.isFinite(g)) return null;
  return Math.max(0, redondearPrecio(c + g, { redondeo, k: 1, costo: c }));
}

/* El objetivo de la venta directa: ganancia fija en pesos (`gananciaObjetivo`)
   o margen (`margenObjetivo`). Si aparecieran los dos, manda la ganancia, igual
   que al resolver. `null` = precio a mano. Gemelo de `objetivoTN`. */
export function objetivoDirecto(perfume) {
  if (perfume?.gananciaObjetivo != null) return { ganancia: Number(perfume.gananciaObjetivo) };
  if (perfume?.margenObjetivo != null) return { margen: Number(perfume.margenObjetivo) };
  return null;
}

/* Qué precio hay que publicar en un canal para que quede ESE margen sobre el
   costo, después de la comisión y el envío. Es `precioParaIgualar` con la
   ganancia objetivo escrita como fracción del costo — la misma cuenta que
   alimenta el botón "=", con otro objetivo. */
export function precioDesdeMargenEnCanal({ costo, margen, comision = 0, envio = 0, redondeo = 1 }) {
  const c = Number(costo) || 0;
  if (!(c > 0) || margen == null || !Number.isFinite(Number(margen))) return null;
  return precioParaIgualar({ costo: c, ganancia: c * Number(margen), comision, envio, redondeo });
}

/* La lista del catálogo con el precio de venta ya despejado en los perfumes que
   tienen un margen clavado. Es el gemelo de `resolverPrecios()` para los pedidos,
   y existe por la misma razón: lo que se guarda, se exporta y va al PDF tiene que
   ser la lista resuelta, no el estado crudo.

   Devuelve **el mismo array** si no cambió ningún precio, así los `useMemo` de
   arriba no se invalidan y abrir la pantalla no dispara un guardado. */
export function resolverPreciosDelCatalogo(perfumes, ajustes = {}) {
  const comisionML = Number(ajustes.comisionML) || 0;
  const envioML = Number(ajustes.envioML) || 0;
  const cuotasML = ajustes.cuotasML ?? {};
  // Solo redondean los precios calculados: los puestos a mano no pasan por acá.
  const redondeoDirecto = ajustes.redondeoDirecto ?? 1;
  const redondeoML = ajustes.redondeoML ?? 1;
  let hubo = false;

  const resueltos = (perfumes ?? []).map((p) => {
    let salida = p;

    // Venta directa: margen o ganancia fija
    const directo = objetivoDirecto(p);
    if (directo) {
      const precio =
        directo.ganancia != null
          ? precioPublicoDesdeGanancia(p.costo, directo.ganancia, redondeoDirecto)
          : precioPublicoDesdeMargen(p.costo, directo.margen, redondeoDirecto);
      if (precio !== null && precio !== p.precioPublico) salida = { ...salida, precioPublico: precio };
    }

    // Un precio por plan clavado: cada publicación de ML se despeja sola.
    const margenes = margenesDePlanes(p);
    const planes = Object.keys(margenes);
    if (planes.length) {
      const precios = preciosDePlanes(p);
      let nuevos = null;
      for (const clave of planes) {
        const plan = Number(clave);
        if (margenes[clave] == null) continue;
        const comision = comisionML + (plan === 1 ? 0 : Number(cuotasML[plan]) || 0);
        const precio = precioDesdeMargenEnCanal({
          costo: p.costo,
          margen: margenes[clave],
          comision,
          envio: envioML,
          redondeo: redondeoML,
        });
        if (precio === null || precio === (Number(precios[clave]) || 0)) continue;
        nuevos = { ...(nuevos ?? precios), [clave]: precio };
      }
      if (nuevos) salida = { ...salida, preciosML: nuevos };
    }

    /* Tiendanube: un solo precio, que deja el objetivo con la forma fijada o, sin
       ella, con la más cara. Si la fijada no aplica por mínimo, el precio queda.

       `precioDirecto` sale de `salida`, no de `p`: el objetivo de la venta directa
       se resolvió unas líneas arriba en este mismo `map`, y el precio que iguala
       tiene que encadenarse con ese, no con el que quedó en el estado crudo. */
    const objetivo = objetivoTN(p);
    if (objetivo && ajustes.tiendaNube) {
      const r = precioTiendaNubeDesdeObjetivo({
        costo: p.costo,
        precioDirecto: salida.precioPublico,
        ...objetivo,
        ajustesTN: ajustes.tiendaNube,
      });
      if (r && !r.noAplica && r.precio !== (Number(p.precioTN) || 0)) salida = { ...salida, precioTN: r.precio };
    }

    if (salida !== p) hubo = true;
    return salida;
  });

  return hubo ? resueltos : perfumes;
}

/* ============================================================
   Tiendanube.

   En Tiendanube hay UN precio de venta, pero el cliente elige cómo pagar y cada
   forma de pago se lleva una comisión distinta (y alguna, como la transferencia,
   viene con descuento). El precio tiene que dejar la ganancia pedida con la
   forma de pago que MÁS cuesta: con las demás se gana igual o más.

   · La comisión que se carga es la que muestra la pantalla del medio de pago,
     SIN IVA. El IVA (21%) va sobre la comisión: `real = comisión × 1,21`.
   · Una forma con monto mínimo (6 cuotas desde $70.000) solo aplica si la
     compra —el precio con su descuento— llega a ese monto.
   · El envío gratis lo paga el negocio: entra en la cuenta, a diferencia del
     envío de Rosario de la venta directa.
   · El precio se redondea HACIA ARRIBA (a $1.000 por defecto): redondear para
     abajo dejaría la forma más cara apenas debajo de la ganancia pedida.
   ============================================================ */

export const IVA = 0.21;

/* La comisión real de una forma de pago: la suya más la de Tiendanube, con IVA. */
export function comisionRealTN(forma, ajustesTN = {}) {
  return ((Number(forma.comision) || 0) + (Number(ajustesTN.comision) || 0)) * (1 + IVA);
}

const aplicaTN = (forma, precio) => {
  const minimo = Number(forma.minimo) || 0;
  return minimo <= 0 || precio * (1 - (Number(forma.descuento) || 0)) >= minimo;
};

/* Qué deja un precio con cada forma de pago.
   `define` es la forma que aplica y deja MENOS: la que manda en el precio.
   El margen es esa ganancia sobre el costo, así se compara de igual a igual con
   el de la venta directa y el de cada plan de ML.

   `cupon` simula un cupón de Tiendanube (`{ porcentaje, monto, combinable }`,
   fracción, pesos y si se combina con el descuento del medio de pago). Vale para
   TODAS las formas de pago. Sigue el orden de la ayuda de Tiendanube ("reglas
   para combinar descuentos"): el cupón va 3° y se aplica sobre el subtotal; el
   descuento por medio de pago va 5°, "el último en la cadena":
   · primero el cupón (% y $) sobre el precio;
   · después, si es combinable, el descuento de la forma sobre lo que quedó. Así
     los % se acumulan multiplicando (10% y después 25% = 32,5%);
   · si NO es combinable, el medio de pago pierde su descuento: según esa misma
     ayuda, el de medio de pago "solo aplica si los anteriores son combinables".
   El mínimo de una forma se mide contra la compra ya con el cupón. Sin cupón el
   resultado es el de siempre: el cupón no toca ningún precio.

   `cupon.minimo` es el `min_price` de un cupón real: si la compra no llega, el
   cupón no aplica (`cuponAplica: false`) y todo sigue como sin cupón.

   `carrito` simula una promoción por cantidad (`{ unidades, descuento }`: 2x1 =
   2 unidades al 0,5; 3x2 = 3 al 1/3; progresivo = N al %). Va 2° en el orden de
   la ayuda ("¿Cómo funcionan las promociones…?"), sobre el precio y antes del
   cupón. Se cuenta el carrito ENTERO: el envío gratis se paga una vez y los
   mínimos se miden contra el total. `ganancia` es la del carrito y
   `gananciaPorUnidad` la parte de cada frasco; con una unidad son lo mismo. */
export function analisisTiendaNube({ costo, precio, ajustesTN = {}, cupon, formaId, carrito }) {
  const unidades = Math.max(1, Math.floor(Number(carrito?.unidades) || 1));
  const dCantidad = Math.min(0.99, Math.max(0, Number(carrito?.descuento) || 0));
  const c = (Number(costo) || 0) * unidades;
  const p = Number(precio) || 0;
  const envio = Number(ajustesTN.envioGratis) || 0;
  const tn = Number(ajustesTN.comision) || 0;
  // La promo por cantidad va primero, sobre el precio de cada unidad.
  const subtotal = p * unidades * (1 - dCantidad);
  const cuponPct = Math.min(1, Math.max(0, Number(cupon?.porcentaje) || 0));
  const cuponMonto = Math.max(0, Number(cupon?.monto) || 0);
  const cuponMinimo = Math.max(0, Number(cupon?.minimo) || 0);
  const cuponAplica = subtotal >= cuponMinimo;
  const conCupon = cuponAplica && (cuponPct > 0 || cuponMonto > 0);
  const combinable = cupon?.combinable !== false;
  // Después el cupón, sobre el subtotal.
  const conElCupon = conCupon ? Math.max(0, subtotal * (1 - cuponPct) - cuponMonto) : subtotal;

  const formas = (ajustesTN.formas ?? []).map((forma) => {
    const descuento = Number(forma.descuento) || 0;
    const base = (Number(forma.comision) || 0) + tn;
    const real = base * (1 + IVA);
    // Después, el descuento del medio de pago —si se combina con el cupón—.
    const aplicaDescuento = !conCupon || combinable;
    const paga = conElCupon * (1 - (aplicaDescuento ? descuento : 0));
    const valida = descuento < 1 && real < 1;
    const minimo = Number(forma.minimo) || 0;
    const aplica = minimo <= 0 || paga >= minimo;
    const comision = paga * base;
    const iva = comision * IVA;
    const llega = paga - comision - iva;
    return {
      forma,
      valida,
      aplica,
      // false cuando un cupón no combinable le saca su descuento a la forma.
      conDescuento: aplicaDescuento && descuento > 0,
      minimo: Number(forma.minimo) || 0,
      paga,
      comision,
      iva,
      total: comision + iva,
      tasaBase: base,
      tasaReal: real,
      llega,
      ganancia: c > 0 && p > 0 ? llega - c - envio : null,
      gananciaPorUnidad: c > 0 && p > 0 ? (llega - c - envio) / unidades : null,
    };
  });

  let define = -1;
  formas.forEach((f, i) => {
    if (!f.valida || !f.aplica || f.ganancia === null) return;
    if (define < 0 || f.ganancia < formas[define].ganancia) define = i;
  });
  const ganancia = define < 0 ? null : formas[define].ganancia;
  /* `manda`: la forma contra la que se mide el objetivo — la fijada si existe y
     aplica, si no la que menos deja. `define` sigue siendo la que menos deja. */
  const fija = indiceFormaTN(formaId, ajustesTN);
  const manda = fija >= 0 && formas[fija].valida && formas[fija].aplica && formas[fija].ganancia !== null ? fija : define;
  const gananciaManda = manda < 0 ? null : formas[manda].ganancia;
  return {
    formas,
    define,
    ganancia,
    margen: ganancia === null ? null : ganancia / c,
    manda,
    gananciaManda,
    margenManda: gananciaManda === null ? null : gananciaManda / c,
    unidades,
    gananciaPorUnidad: ganancia === null ? null : ganancia / unidades,
    subtotal,
    cuponAplica,
  };
}

/* ---------- Cupones reales de Tiendanube (API "Coupons" 2025-03) ---------- */

/* Un cupón de la API, en lo que entiende `analisisTiendaNube`. El de envío
   gratis no cambia la cuenta: la app ya supone que el envío lo paga el negocio.
   -> { porcentaje, monto, combinable, minimo } */
export function cuponDeTiendanube(c) {
  const valor = Number(c?.value) || 0;
  return {
    porcentaje: c?.type === "percentage" ? Math.min(1, valor / 100) : 0,
    monto: c?.type === "absolute" ? valor : 0,
    combinable: c?.combines_with_other_discounts !== false,
    minimo: Number(c?.min_price) || 0,
  };
}

/* ¿Vale hoy? -> "vigente" | "desactivado" | "por empezar" | "vencido" | "agotado" */
export function estadoDeCupon(c, hoy = new Date()) {
  if (c?.valid === false || c?.deleted_at) return "desactivado";
  const t = hoy.getTime();
  /* Una fecha sin hora ("2026-10-23") es un día en hora local: `new Date()` la
     leería como medianoche UTC, que en Argentina es el día anterior a la noche.
     El inicio vale desde las 0:00 y el fin hasta las 23:59 de ese día. */
  const fecha = (v, finDelDia) => {
    const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return new Date(v).getTime();
    return finDelDia ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999).getTime() : new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  };
  if (c?.start_date && fecha(c.start_date, false) > t) return "por empezar";
  if (c?.end_date && fecha(c.end_date, true) < t) return "vencido";
  if (c?.max_uses != null && Number(c.used) >= Number(c.max_uses)) return "agotado";
  return "vigente";
}

/* ¿Le aplica el cupón a este perfume? Por producto vinculado o por sus
   categorías. -> "si" | "no" | "no se sabe" (restringido y sin vincular, o el
   producto no vino en la lista). */
export function aQuienAplica(c, perfume, productosTN = []) {
  const ids = (lista) => (lista ?? []).map((x) => String(typeof x === "object" ? x.id : x));
  const productos = ids(c?.products);
  const categorias = ids(c?.categories);
  if (!productos.length && !categorias.length) return "si";
  const pid = perfume?.publicacionTN?.productId;
  if (pid == null) return "no se sabe";
  if (productos.length) return productos.includes(String(pid)) ? "si" : "no";
  const producto = productosTN.find((p) => String(p.id) === String(pid));
  if (!producto) return "no se sabe";
  return (producto.categorias ?? []).some((cat) => categorias.includes(String(cat))) ? "si" : "no";
}

/* Qué pasa con cada perfume si usan el cupón, pagando con la forma que menos
   deja. Solo los que tienen precio y costo. -> { filas, pierden, peor, noSeSabe }
   · filas: [{ perfume, ganancia, sinCupon, aplicaMinimo, formas, define }] de
     peor a mejor; `formas` es la ganancia con y sin el cupón en cada forma de
     pago (null si no aplica), y `define` el índice de la que menos deja. */
export function impactoDeCupon(c, perfumes, ajustesTN, productosTN = []) {
  const cupon = cuponDeTiendanube(c);
  const filas = [];
  const noSeSabe = [];
  for (const p of perfumes ?? []) {
    if (!(Number(p.costo) > 0) || !(Number(p.precioTN) > 0)) continue;
    const alcance = aQuienAplica(c, p, productosTN);
    if (alcance === "no") continue;
    if (alcance === "no se sabe") {
      noSeSabe.push(p);
      continue;
    }
    const con = analisisTiendaNube({ costo: p.costo, precio: p.precioTN, ajustesTN, cupon });
    const sin = analisisTiendaNube({ costo: p.costo, precio: p.precioTN, ajustesTN });
    if (con.ganancia === null) continue;
    // Cada forma por separado: un cupón no combinable le saca el descuento a
    // algunas y se lo deja a otras, así que no se mueven todas igual.
    const ganDe = (f) => (f.valida && f.aplica ? f.ganancia : null);
    const formas = con.formas.map((f, i) => ({ nombre: f.forma.nombre, ganancia: ganDe(f), sinCupon: ganDe(sin.formas[i]) }));
    filas.push({ perfume: p, ganancia: con.ganancia, sinCupon: sin.ganancia, aplicaMinimo: con.cuponAplica, formas, define: con.define });
  }
  filas.sort((a, b) => a.ganancia - b.ganancia);
  return { filas, pierden: filas.filter((f) => f.ganancia < 0).length, peor: filas[0] ?? null, noSeSabe };
}

/* El precio que deja `margen` sobre el costo con la forma de pago más cara.

     necesario = (costo + envío + ganancia) ÷ ((1 − descuento) × (1 − comisión real))

   y el precio es el mayor de las formas que aplican, redondeado hacia arriba.
   Los mínimos se resuelven iterando: primero sin las formas con mínimo, después
   se suman las que lo cumplen con ese precio y se recalcula hasta que no cambie.
   Devuelve `{ precio, define }` o null si no hay cuenta posible. */
export function precioTiendaNubeDesdeMargen({ costo, margen, ajustesTN = {} }) {
  return precioTiendaNubeDesdeObjetivo({ costo, margen, ajustesTN });
}

/* El objetivo de un perfume en Tiendanube: margen (fracción del costo), ganancia
   fija en pesos, o igualar lo que paga una forma al precio de venta directa,
   medido contra una forma de pago (`formaTN`) o, sin ella, contra la que menos
   deja. `null` si el perfume tiene el precio a mano.

   Igualar va primero porque los tres se excluyen: al fijar uno se borran los
   otros. Necesita la forma sí o sí —igualar "la que menos deja" no significa
   nada—, así que sin `formaTN` no hay objetivo y el precio queda a mano. */
export function objetivoTN(perfume) {
  if (perfume?.igualarDirectoTN && perfume?.formaTN != null)
    return { igualarDirecto: true, formaId: perfume.formaTN };
  if (perfume?.gananciaTN != null) return { ganancia: Number(perfume.gananciaTN), formaId: perfume.formaTN ?? null };
  if (perfume?.margenTN != null) return { margen: Number(perfume.margenTN), formaId: perfume.formaTN ?? null };
  return null;
}

/* La forma fijada, si todavía existe en los ajustes: borrada, se vuelve sola a
   medir contra la que menos deja. -> índice o -1. */
export const indiceFormaTN = (formaId, ajustesTN = {}) =>
  formaId == null ? -1 : (ajustesTN.formas ?? []).findIndex((f) => f.id === formaId);

/* El precio a publicar para que UNA forma de pago le cobre al cliente lo mismo
   que la venta directa.

   Nace de un problema concreto: el precio de Tiendanube se publica inflado para
   absorber la comisión y el envío gratis, así que el que mira la tienda y elige
   transferencia ve un número más alto que el precio directo, pregunta por fuera
   y compra directo. La tienda queda como la opción cara.

     precio = precioPublico ÷ (1 − descuento de la forma)

   La comisión NO entra en el despeje: no la paga el cliente, sale de lo que
   llega. Por eso este precio es más bajo que el del margen clavado y la ganancia
   también: la comisión y el envío gratis se comen la diferencia. Es la decisión
   que se está tomando, y la pantalla la muestra al lado de la ganancia directa.

   Redondea HACIA ARRIBA como todo el resto de la app, así que el cliente de esa
   forma paga lo mismo o unos pesos más que comprando directo — nunca menos.
   Devuelve `{ precio, define }`, `{ ..., noAplica: true }` si la forma tiene
   monto mínimo y el precio no llega, o null si no hay cuenta posible (sin precio
   directo, forma inexistente, o descuento/comisión al 100%). */
export function precioTNParaIgualarPago({ precioDirecto, costo, formaId, ajustesTN = {} }) {
  const objetivo = Number(precioDirecto) || 0;
  const i = indiceFormaTN(formaId, ajustesTN);
  if (!(objetivo > 0) || i < 0) return null;
  const forma = (ajustesTN.formas ?? [])[i];
  const d = Number(forma.descuento) || 0;
  const real = comisionRealTN(forma, ajustesTN);
  if (!(d < 1) || !(real < 1)) return null;
  const redondeo = Number(ajustesTN.redondeo) > 0 ? Number(ajustesTN.redondeo) : 1;
  const base = Number(costo) > 0 ? Number(costo) : objetivo;
  const precio = redondearPrecio(objetivo / (1 - d), { redondeo, k: (1 - d) * (1 - real), costo: base });
  return aplicaTN(forma, precio) ? { precio, define: i } : { precio, define: i, noAplica: true };
}

/* Como `precioTiendaNubeDesdeMargen`, con la ganancia en pesos como alternativa
   al margen y una forma de pago opcional contra la que medir:

     objetivo = costo + envío + (ganancia ?? costo × margen)

   · Sin forma (o con una que ya no existe): la de siempre, la forma que más
     cuesta manda.
   · Con forma: `precio = objetivo ÷ k` de ESA forma, mismo redondeo hacia
     arriba. Si tiene mínimo y el precio no llega, esa forma no aplica: devuelve
     `{ precio, define, noAplica: true }` y el precio no se usa.
   · Con `igualarDirecto`: no hay margen ni ganancia que despejar, el objetivo es
     lo que paga el cliente. Delega en `precioTNParaIgualarPago`, así el resolver
     y el popup siguen entrando por una sola puerta.
   Devuelve `{ precio, define }` o null si no hay cuenta posible. */
export function precioTiendaNubeDesdeObjetivo({
  costo,
  margen,
  ganancia,
  igualarDirecto,
  precioDirecto,
  formaId,
  ajustesTN = {},
}) {
  if (igualarDirecto) return precioTNParaIgualarPago({ precioDirecto, costo, formaId, ajustesTN });
  const c = Number(costo) || 0;
  const extra = ganancia != null ? Number(ganancia) : margen != null ? c * Number(margen) : NaN;
  if (!(c > 0) || !Number.isFinite(extra)) return null;
  const formas = ajustesTN.formas ?? [];
  if (!formas.length) return null;

  const objetivo = c + (Number(ajustesTN.envioGratis) || 0) + extra;
  const redondeo = Number(ajustesTN.redondeo) > 0 ? Number(ajustesTN.redondeo) : 1;
  const k = formas.map(
    (f) => (1 - (Number(f.descuento) || 0)) * (1 - comisionRealTN(f, ajustesTN))
  );
  if (k.some((x) => !(x > 0))) return null;

  const fija = indiceFormaTN(formaId, ajustesTN);
  if (fija >= 0) {
    const precio = redondearPrecio(objetivo / k[fija], { redondeo, k: k[fija], costo: c });
    return aplicaTN(formas[fija], precio) ? { precio, define: fija } : { precio, define: fija, noAplica: true };
  }

  const precioCon = (activas) => {
    let necesario = 0;
    let define = -1;
    k.forEach((x, i) => {
      if (!activas[i]) return;
      const p = objetivo / x;
      if (p > necesario) {
        necesario = p;
        define = i;
      }
    });
    if (define < 0) return { precio: 0, define };
    // El mismo redondeo que directo y ML, con el `k` de la forma que manda.
    return { precio: redondearPrecio(necesario, { redondeo, k: k[define], costo: c }), define };
  };

  let activas = formas.map((f) => !((Number(f.minimo) || 0) > 0));
  let r = precioCon(activas);
  for (let vuelta = 0; vuelta < 10; vuelta++) {
    const siguientes = formas.map((f) => aplicaTN(f, r.precio));
    if (siguientes.every((v, i) => v === activas[i])) break;
    activas = siguientes;
    r = precioCon(activas);
  }
  if (r.define < 0) return null;
  return r;
}

/* Qué planes de pago se publican: un pago siempre, más los que tengan comisión
   cargada. Un plan en 0% no es una opción de publicación, así que no ocupa
   columna; cargarle la comisión a 3 cuotas hace aparecer su bloque solo. */
export function planesPublicables(cuotas = {}) {
  const conComision = Object.entries(cuotas)
    .filter(([, comision]) => (Number(comision) || 0) > 0)
    .map(([plan]) => Number(plan))
    .filter((plan) => plan > 1)
    .sort((a, b) => a - b);
  return [1, ...conComision];
}

/* Los márgenes clavados por plan. Campo nuevo y sin historia: lo que no esté
   acá es un plan con el precio puesto a mano. */
export function margenesDePlanes(perfume) {
  return perfume?.margenesML ?? {};
}

/* El precio guardado de un plan. Los perfumes de antes tenían un único
   `precioML`: se lee como el precio de un pago. La conversión es en memoria —
   el archivo recién cambia de forma cuando el usuario toca algo del catálogo. */
export function preciosDePlanes(perfume) {
  if (perfume?.preciosML) return perfume.preciosML;
  return perfume?.precioML > 0 ? { 1: perfume.precioML } : {};
}

/* Los canales de un perfume del catálogo.

   En Mercado Libre no hay "un" precio: hay una publicación por opción de pago y
   cada una con la suya, porque ML cobra una comisión extra por cuotas sobre el
   precio publicado. Por eso `ml` es una lista, una entrada por plan, y no un
   resultado solo.

   `envioLocal` sale por un lado aparte a propósito: `precioConEnvio` es lo que se
   le cotiza al cliente con entrega, y no entra en ninguna cuenta. */
export function analisisDePrecio({
  costo,
  precioPublico,
  perfume,
  comisionML,
  envioML,
  envioLocal = 0,
  cuotasML = {},
  planes,
  redondeoML = 1,
}) {
  const c = Number(costo) || 0;
  const p = Number(precioPublico) || 0;
  const envioDirecto = Number(envioLocal) || 0;

  // Vender directo no tiene comisión ni envío a cargo del negocio: es la misma
  // cuenta de siempre.
  const directo = resultadoDeCanal({ costo: c, precio: p });

  const precios = preciosDePlanes(perfume);
  const margenes = margenesDePlanes(perfume);
  const ml = (planes ?? planesPublicables(cuotasML)).map((plan) => {
    const comision = (Number(comisionML) || 0) + (plan === 1 ? 0 : Number(cuotasML[plan]) || 0);
    const precio = Number(precios[plan]) || 0;
    return {
      plan,
      precio,
      comision,
      // Clavado = el precio de este plan lo manda el margen, no la mano.
      margenObjetivo: margenes[plan] ?? null,
      ...resultadoDeCanal({ costo: c, precio, comision, envio: envioML }),
      // A cuánto publicar EN ESTE PLAN para ganar lo mismo que vendiendo directo.
      sugerido: precioParaIgualar({
        costo: c,
        ganancia: directo.ganancia,
        comision,
        envio: envioML,
        redondeo: redondeoML,
      }),
    };
  });

  return {
    directo: {
      ...directo,
      // Una suma, no una cuenta. Vale solo si hay precio y hay envío cargado.
      precioConEnvio: p > 0 && envioDirecto > 0 ? p + envioDirecto : null,
    },
    ml,
  };
}
