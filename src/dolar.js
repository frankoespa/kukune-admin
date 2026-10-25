import { registrarCosto } from "./historialCostos.js";

/* ============================================================
   Costo atado al dólar.

   El `costo` del catálogo está en pesos. Un perfume con `costoUSD` está atado
   al dólar: su costo en pesos es `costoUSD × dólar del catálogo`
   (`ajustes.dolar.valor`). Cuando cambia el dólar se recalculan los atados, y
   por las cuentas de siempre se reprecian los que tienen margen clavado.

   El `costo` en pesos se sigue guardando: es lo que usa todo lo demás. Cada
   movimiento pasa por `registrarCosto()`, así el historial (el de las Ventas de
   ML) registra también los cambios por dólar.

   Puro y sin React: se prueba desde Node.
   ============================================================ */

const num = (x) => Number(x) || 0;

export const estaAtado = (perfume) => num(perfume?.costoUSD) > 0;

/* -> pesos, redondeado al peso. */
export const costoAlDolar = (costoUSD, dolar) => Math.round(num(costoUSD) * num(dolar));

/* Los atados con el costo del dólar nuevo. Devuelve el MISMO array si no cambia
   ningún costo (no dispara un guardado). */
export function aplicarDolar(perfumes, dolarNuevo, ahora = new Date().toISOString()) {
  if (!(num(dolarNuevo) > 0)) return perfumes;
  let hubo = false;
  const salida = (perfumes ?? []).map((p) => {
    if (!estaAtado(p)) return p;
    const nuevo = registrarCosto(p, costoAlDolar(p.costoUSD, dolarNuevo), ahora);
    if (nuevo !== p) hubo = true;
    return nuevo;
  });
  return hubo ? salida : perfumes;
}

/* Para el diálogo: cuántos atados cambian de costo y en qué proporción. */
export function resumenDeCambio(perfumes, dolarAnterior, dolarNuevo) {
  const atados = (perfumes ?? []).filter(estaAtado);
  const cambian = atados.filter((p) => costoAlDolar(p.costoUSD, dolarNuevo) !== num(p.costo)).length;
  const variacion = num(dolarAnterior) > 0 ? num(dolarNuevo) / num(dolarAnterior) - 1 : null;
  return { atados: atados.length, cambian, variacion };
}

/* Atar: el costo de hoy se lee como el de este dólar. Sin dólar o sin costo,
   no se puede (devuelve el mismo perfume). */
export function atarAlDolar(perfume, dolar) {
  if (!(num(dolar) > 0) || !(num(perfume?.costo) > 0)) return perfume;
  return { ...perfume, costoUSD: num(perfume.costo) / num(dolar) };
}

/* Desatar: el costo en pesos queda como está y deja de seguir al dólar. */
export function desatar(perfume) {
  if (!estaAtado(perfume)) return perfume;
  const { costoUSD, ...resto } = perfume;
  return resto;
}

/* Editar el costo en pesos de un atado mueve su costo en dólares: sigue atado. */
export function conCostoEnPesos(perfume, costo, dolar, ahora) {
  const actualizado = registrarCosto(perfume, costo, ahora);
  if (!estaAtado(perfume) || !(num(dolar) > 0)) return actualizado;
  return { ...actualizado, costoUSD: num(costo) / num(dolar) };
}

/* El costo en dólares que deja una fila de pedido al pasarla al catálogo: en un
   pedido en dólares, su "s/Gan. USD" (costo del proveedor más su parte de los
   costos extras, en dólares); en uno en pesos, sus pesos al dólar del catálogo. */
export function costoUSDParaPasar(fila, monedaPedido, dolarCatalogo) {
  if (monedaPedido === "USD") return num(fila?.precioSinGanUsdt);
  return num(dolarCatalogo) > 0 ? num(fila?.precioSinGanPesos) / num(dolarCatalogo) : 0;
}
