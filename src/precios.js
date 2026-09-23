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

/* El precio a publicar en un canal para que quede la MISMA ganancia que se
   hace vendiendo directo. Despeje de `precio·k − envío − costo = ganancia`. */
export function precioParaIgualar({ costo, ganancia, comision = 0, envio = 0 }) {
  const c = Number(costo) || 0;
  const k = 1 - (Number(comision) || 0);
  if (!(c > 0) || ganancia == null || !(k > 0)) return null;
  const precio = (c + ganancia + (Number(envio) || 0)) / k;
  // Mismo criterio que los otros despejes: un peso corre el margen en `k/costo`,
  // que en un perfume normal no se nota, pero con un costo chico se dispara y
  // redondear mentiría — pedís 45% y ves 47%.
  const desvioMaximoPP = 0.5 * (k / c) * 100;
  return desvioMaximoPP <= 0.05 ? Math.round(precio) : Math.round(precio * 100) / 100;
}

/* El camino inverso de la venta directa: dado un margen, qué precio lo produce.

   Acá no hace falta el despeje de los pedidos: vender directo no tiene comisión
   ni envío a cargo del negocio, así que `margen = (precio − costo) / costo` se
   da vuelta solo.

   Mismo criterio de redondeo que `precioDesdeMargen`: un peso corre el margen en
   `1/costo`, que en un perfume normal es 0,002 pp y no se nota, pero con un
   costo muy chico se dispara y redondear mentiría — pedís 30% y ves 32%. */
export function precioPublicoDesdeMargen(costo, margen) {
  const c = Number(costo) || 0;
  // `margen == null` va aparte: `Number(null)` es 0, y devolver el costo como
  // precio sería poner el margen en cero sin que nadie lo haya pedido.
  if (margen == null) return null;
  const m = Number(margen);
  if (!(c > 0) || !Number.isFinite(m)) return null;
  const precio = c * (1 + m);
  const desvioMaximoPP = 0.5 * (1 / c) * 100;
  const redondeado = desvioMaximoPP <= 0.05 ? Math.round(precio) : Math.round(precio * 100) / 100;
  return Math.max(0, redondeado);
}

/* Qué precio hay que publicar en un canal para que quede ESE margen sobre el
   costo, después de la comisión y el envío. Es `precioParaIgualar` con la
   ganancia objetivo escrita como fracción del costo — la misma cuenta que
   alimenta el botón "=", con otro objetivo. */
export function precioDesdeMargenEnCanal({ costo, margen, comision = 0, envio = 0 }) {
  const c = Number(costo) || 0;
  if (!(c > 0) || margen == null || !Number.isFinite(Number(margen))) return null;
  return precioParaIgualar({ costo: c, ganancia: c * Number(margen), comision, envio });
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
  let hubo = false;

  const resueltos = (perfumes ?? []).map((p) => {
    let salida = p;

    // Venta directa
    if (p.margenObjetivo != null) {
      const precio = precioPublicoDesdeMargen(p.costo, p.margenObjetivo);
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
        });
        if (precio === null || precio === (Number(precios[clave]) || 0)) continue;
        nuevos = { ...(nuevos ?? precios), [clave]: precio };
      }
      if (nuevos) salida = { ...salida, preciosML: nuevos };
    }

    if (salida !== p) hubo = true;
    return salida;
  });

  return hubo ? resueltos : perfumes;
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
