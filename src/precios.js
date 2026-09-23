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
  return Math.round((c + ganancia + (Number(envio) || 0)) / k);
}

/* Los dos canales de un perfume del catálogo.

   `comisionCuotas` es la comisión EXTRA del plan de cuotas elegido en pantalla
   (0 si se publica en un pago): se suma a la de ML porque ML las cobra a las
   dos sobre el precio publicado.

   `envioLocal` sale por un lado aparte a propósito: `precioConEnvio` es lo que
   se le cotiza al cliente con entrega, y no entra en ninguna cuenta. */
export function analisisDePrecio({
  costo,
  precioPublico,
  precioML,
  comisionML,
  envioML,
  envioLocal = 0,
  comisionCuotas = 0,
}) {
  const c = Number(costo) || 0;
  const p = Number(precioPublico) || 0;
  const pML = Number(precioML) || 0;
  const envioDirecto = Number(envioLocal) || 0;
  const comisionTotalML = (Number(comisionML) || 0) + (Number(comisionCuotas) || 0);

  // Vender directo no tiene comisión ni envío a cargo del negocio: es el mismo
  // canal de siempre, con la misma cuenta que ya estaba.
  const directo = resultadoDeCanal({ costo: c, precio: p });
  const ml = resultadoDeCanal({
    costo: c,
    precio: pML,
    comision: comisionTotalML,
    envio: envioML,
  });

  return {
    directo: {
      ...directo,
      // Una suma, no una cuenta. Vale solo si hay precio y hay envío cargado.
      precioConEnvio: p > 0 && envioDirecto > 0 ? p + envioDirecto : null,
    },
    ml: {
      ...ml,
      sugerido: precioParaIgualar({
        costo: c,
        ganancia: directo.ganancia,
        comision: comisionTotalML,
        envio: envioML,
      }),
    },
  };
}

/* Lo que quedaría en cada plan de cuotas, para el detalle al pasar el mouse.
   `cuotas` es el mapa de comisiones extra ({3: 0.07, 6: 0.12, ...}); el plan de
   un pago siempre está y es el que no paga extra. */
export function gananciaPorCuotas({ costo, precioML, comisionML, envioML, cuotas = {} }) {
  const planes = [1, ...Object.keys(cuotas).map(Number).sort((a, b) => a - b)];
  return planes.map((plan) => ({
    plan,
    ...resultadoDeCanal({
      costo,
      precio: precioML,
      comision: (Number(comisionML) || 0) + (plan === 1 ? 0 : Number(cuotas[plan]) || 0),
      envio: envioML,
    }),
  }));
}
