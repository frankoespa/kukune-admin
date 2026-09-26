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

    // Venta directa
    if (p.margenObjetivo != null) {
      const precio = precioPublicoDesdeMargen(p.costo, p.margenObjetivo, redondeoDirecto);
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

    // Tiendanube: un solo precio, que tiene que cubrir la forma de pago más cara.
    if (p.margenTN != null && ajustes.tiendaNube) {
      const r = precioTiendaNubeDesdeMargen({
        costo: p.costo,
        margen: p.margenTN,
        ajustesTN: ajustes.tiendaNube,
      });
      if (r && r.precio !== (Number(p.precioTN) || 0)) salida = { ...salida, precioTN: r.precio };
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
   el de la venta directa y el de cada plan de ML. */
export function analisisTiendaNube({ costo, precio, ajustesTN = {} }) {
  const c = Number(costo) || 0;
  const p = Number(precio) || 0;
  const envio = Number(ajustesTN.envioGratis) || 0;
  const tn = Number(ajustesTN.comision) || 0;

  const formas = (ajustesTN.formas ?? []).map((forma) => {
    const descuento = Number(forma.descuento) || 0;
    const base = (Number(forma.comision) || 0) + tn;
    const real = base * (1 + IVA);
    const paga = p * (1 - descuento);
    const valida = descuento < 1 && real < 1;
    const aplica = aplicaTN(forma, p);
    const comision = paga * base;
    const iva = comision * IVA;
    const llega = paga - comision - iva;
    return {
      forma,
      valida,
      aplica,
      minimo: Number(forma.minimo) || 0,
      paga,
      comision,
      iva,
      total: comision + iva,
      tasaBase: base,
      tasaReal: real,
      llega,
      ganancia: c > 0 && p > 0 ? llega - c - envio : null,
    };
  });

  let define = -1;
  formas.forEach((f, i) => {
    if (!f.valida || !f.aplica || f.ganancia === null) return;
    if (define < 0 || f.ganancia < formas[define].ganancia) define = i;
  });
  const ganancia = define < 0 ? null : formas[define].ganancia;
  return { formas, define, ganancia, margen: ganancia === null ? null : ganancia / c };
}

/* El precio que deja `margen` sobre el costo con la forma de pago más cara.

     necesario = (costo + envío + ganancia) ÷ ((1 − descuento) × (1 − comisión real))

   y el precio es el mayor de las formas que aplican, redondeado hacia arriba.
   Los mínimos se resuelven iterando: primero sin las formas con mínimo, después
   se suman las que lo cumplen con ese precio y se recalcula hasta que no cambie.
   Devuelve `{ precio, define }` o null si no hay cuenta posible. */
export function precioTiendaNubeDesdeMargen({ costo, margen, ajustesTN = {} }) {
  const c = Number(costo) || 0;
  if (!(c > 0) || margen == null || !Number.isFinite(Number(margen))) return null;
  const formas = ajustesTN.formas ?? [];
  if (!formas.length) return null;

  const objetivo = c + (Number(ajustesTN.envioGratis) || 0) + c * Number(margen);
  const redondeo = Number(ajustesTN.redondeo) > 0 ? Number(ajustesTN.redondeo) : 1;
  const k = formas.map(
    (f) => (1 - (Number(f.descuento) || 0)) * (1 - comisionRealTN(f, ajustesTN))
  );
  if (k.some((x) => !(x > 0))) return null;

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
