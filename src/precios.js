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
