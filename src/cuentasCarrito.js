/* ============================================================
   Simulador de carrito de Tiendanube: cuentas puras (sin React), probadas
   desde Node. NO se puede llamar `carrito.js` si algún día existe un
   `Carrito.jsx` (choca en Windows, como `clienteML.js` con `MercadoLibre.jsx`).

   No hay fórmulas nuevas: el carrito entero pasa UNA vez por
   `analisisTiendaNube` con el precio y el costo totales, igual que
   `gananciaDelCarrito` de la calculadora del envío gratis. Así salen solos los
   mínimos de las formas contra el total, el envío desde un monto, la comisión
   sobre el envío del cliente (una vez por carrito) y el descuento del medio de
   pago. Lo único que se arma acá es lo que esa función no sabe hacer con un
   carrito mezclado:

   - La promo por cantidad, que en un carrito mezclado no es "un % sobre el
     precio": en "Llevá X pagá Y" se regalan unidades concretas. Se supone que
     son LAS MÁS BARATAS de las que entran en la promo (lo que suelen hacer las
     tiendas; no está confirmado en la ayuda de Tiendanube). Se pasa a la
     función como el descuento equivalente sobre el subtotal (va 2°, antes del
     cupón, como en `analisisTiendaNube`).
   - El cupón limitado a productos o categorías: se calcula su monto solo sobre
     las líneas a las que aplica y se pasa como un monto fijo.
   ============================================================ */

import { analisisTiendaNube, aQuienAplica, pagaEnTN } from "./precios.js";

/* El precio que paga el cliente por una unidad de un ítem (frasco o decant) en
   el carrito: el de oferta si hay, si no el de Tiendanube. Un decant redondea
   su oferta con su propio redondeo. */
export function precioEnCarrito(item, ajustesTN = {}) {
  const aj = item?.redondeoTN != null ? { ...ajustesTN, redondeo: item.redondeoTN } : ajustesTN;
  return pagaEnTN(item, aj);
}

/* Lo que se puede poner en el carrito: con costo y con precio en Tiendanube. */
export const sePuedeSimular = (item, ajustesTN = {}) =>
  Number(item?.costo) > 0 && precioEnCarrito(item, ajustesTN) > 0;

/* El descuento de la promo por cantidad, repartido por línea.
   `unidades`: [{linea, precio}] de las líneas que ENTRAN en la promo.
   promo: {tipo: "xy", x, y} | {tipo: "progresivo", unidades, pct (fracción)}.
   -> Map linea -> monto descontado. */
export function descuentoDePromo(unidades, promo) {
  const porLinea = new Map();
  const sumar = (l, m) => porLinea.set(l, (porLinea.get(l) || 0) + m);
  const n = unidades.length;
  if (!promo || !n) return porLinea;
  if (promo.tipo === "xy") {
    const x = Math.floor(Number(promo.x) || 0);
    const y = Math.floor(Number(promo.y) || 0);
    if (!(x > y) || !(y >= 1)) return porLinea;
    const gratis = Math.floor(n / x) * (x - y);
    // Las más baratas: ordenadas de menor a mayor precio.
    const orden = unidades.slice().sort((a, b) => a.precio - b.precio);
    for (let i = 0; i < gratis; i++) sumar(orden[i].linea, orden[i].precio);
  } else if (promo.tipo === "progresivo") {
    const desde = Math.max(1, Math.floor(Number(promo.unidades) || 0));
    const pct = Math.min(0.99, Math.max(0, Number(promo.pct) || 0));
    if (n >= desde && pct > 0) for (const u of unidades) sumar(u.linea, u.precio * pct);
  }
  return porLinea;
}

/* La cuenta de un carrito, sin los aportes por línea.
   lineas: [{item, cantidad, enPromo}] (enPromo: undefined = entra).
   cupon: {porcentaje (fracción), monto, combinable, minimo, real?} — `real` es
   el cupón de la tienda, para saber a qué líneas aplica. */
function cuenta({ lineas, ajustesTN = {}, promo = null, cupon = null, productosTN = [] }) {
  const filas = lineas
    .map((l, i) => {
      const cantidad = Math.max(0, Math.floor(Number(l.cantidad) || 0));
      const precio = precioEnCarrito(l.item, ajustesTN);
      const costo = Number(l.item?.costo) || 0;
      return { i, item: l.item, cantidad, precio, costo, enPromo: l.enPromo !== false };
    })
    .filter((f) => f.cantidad > 0);

  const subtotalLista = filas.reduce((a, f) => a + f.precio * f.cantidad, 0);
  const costoTotal = filas.reduce((a, f) => a + f.costo * f.cantidad, 0);
  const unidades = filas.reduce((a, f) => a + f.cantidad, 0);

  // 2° la promo por cantidad, por unidad, sobre las líneas que entran.
  const enLaPromo = [];
  for (const f of filas) if (f.enPromo) for (let k = 0; k < f.cantidad; k++) enLaPromo.push({ linea: f.i, precio: f.precio });
  const promoPorLinea = descuentoDePromo(enLaPromo, promo);
  let promoMonto = 0;
  for (const f of filas) {
    f.promo = promoPorLinea.get(f.i) || 0;
    f.trasPromo = f.precio * f.cantidad - f.promo;
    promoMonto += f.promo;
  }
  const subtotal = subtotalLista - promoMonto;

  // 3° el cupón, solo sobre las líneas a las que aplica.
  const pct = Math.min(1, Math.max(0, Number(cupon?.porcentaje) || 0));
  const monto = Math.max(0, Number(cupon?.monto) || 0);
  const conCupon = pct > 0 || monto > 0;
  let baseCupon = 0;
  for (const f of filas) {
    f.alcanceCupon = !conCupon ? null : cupon?.real ? aQuienAplica(cupon.real, f.item, productosTN) : "si";
    // "no se sabe" (perfume sin vincular) se simula igual, como en el detalle.
    if (f.alcanceCupon && f.alcanceCupon !== "no") baseCupon += f.trasPromo;
  }
  const minimoCupon = Math.max(0, Number(cupon?.minimo) || 0);
  const cuponAplica = conCupon && baseCupon > 0 && subtotal >= minimoCupon;
  const cuponMonto = cuponAplica ? Math.min(baseCupon, baseCupon * pct + monto) : 0;

  const a = analisisTiendaNube({
    costo: costoTotal,
    precio: subtotalLista,
    ajustesTN,
    carrito: subtotalLista > 0 && promoMonto > 0 ? { unidades: 1, descuento: promoMonto / subtotalLista } : undefined,
    cupon: conCupon
      ? { porcentaje: 0, monto: cuponMonto, combinable: cupon?.combinable !== false, minimo: minimoCupon }
      : undefined,
  });

  return {
    ...a,
    filas,
    unidades,
    subtotalLista,
    promoMonto,
    subtotal,
    costoTotal,
    conCupon,
    cuponAplica,
    cuponMonto,
    baseCupon,
    // Cuánto falta para el envío gratis (0 si ya llega o si no hay monto).
    faltaEnvio: a.umbralEnvio > 0 && !a.envioCalifica ? a.umbralEnvio - subtotal : 0,
  };
}

/* El carrito con lo que aporta cada línea: la ganancia del carrito entero
   menos la del carrito sin esa línea, forma por forma. Es la respuesta a "si
   le sumo un decant a este frasco, ¿cuánto más gano?": el envío, la comisión
   sobre el envío y los mínimos ya los paga el resto del carrito, así que no se
   le reparten. Por eso los aportes NO suman la ganancia total. `null` en una
   forma si con o sin la línea esa forma no aplica. */
export function simularCarrito(opciones) {
  const total = cuenta(opciones);
  const aportes = total.filas.map((f) => {
    const sin = cuenta({ ...opciones, lineas: opciones.lineas.filter((_, j) => j !== f.i) });
    return total.formas.map((ft, k) => {
      const fs = sin.formas[k];
      if (!ft.valida || !ft.aplica || ft.ganancia === null) return null;
      // Sin la línea el carrito puede quedar vacío: aporta toda la ganancia.
      if (sin.unidades === 0) return ft.ganancia;
      if (!fs?.valida || !fs.aplica || fs.ganancia === null) return null;
      return ft.ganancia - fs.ganancia;
    });
  });
  total.filas.forEach((f, k) => (f.aporte = aportes[k]));
  return total;
}
