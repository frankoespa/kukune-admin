/* ============================================================
   Historial del costo de cada perfume.

   El catálogo guarda un solo `costo`, el de hoy. Pero una venta de hace dos
   meses tiene que medirse contra el costo que había cuando se vendió: si
   después el perfume se compró más caro, esa venta no dejó menos plata.

   `historialCostos: [{desde, costo}]`, en orden. `desde` es un instante ISO
   con hora (dos cambios en el mismo día quedan los dos) o `null`: "desde antes
   de que hubiera historial". Esa entrada sale del costo que el perfume tenía
   al primer cambio — así lo vendido antes usa ese costo y no el nuevo.

   Puro y sin imports: se prueba desde Node.
   ============================================================ */

// NumberCell escribe en cada tecla: "65000" pasaría por 6, 65, 650… Los
// cambios más cerca que esto de la última entrada la reemplazan.
export const VENTANA_TECLEO_MS = 2 * 60 * 1000;

const num = (x) => Number(x) || 0;

/* Devuelve el perfume con `costo` y el historial al día. Si el costo no
   cambia, devuelve el MISMO objeto (no dispara un guardado). */
export function registrarCosto(perfume, costoNuevo, ahora = new Date().toISOString()) {
  const nuevo = num(costoNuevo);
  const anterior = num(perfume.costo);
  if (nuevo === anterior) return perfume;

  let historial = Array.isArray(perfume.historialCostos) ? perfume.historialCostos.slice() : [];

  // Primer cambio: el costo que había pasa a ser "desde siempre". Si no había
  // costo, no hay nada que conservar.
  if (!historial.length && anterior > 0) historial.push({ desde: null, costo: anterior });

  const ultima = historial[historial.length - 1];
  const reciente =
    ultima?.desde != null && Date.parse(ahora) - Date.parse(ultima.desde) < VENTANA_TECLEO_MS;
  if (reciente) historial.pop();

  // Volver al costo de la entrada anterior (Escape, o tipear y borrar) no es
  // un cambio: no deja rastro.
  const previa = historial[historial.length - 1];
  if (!(previa && num(previa.costo) === nuevo)) historial.push({ desde: ahora, costo: nuevo });

  return { ...perfume, costo: nuevo, historialCostos: historial };
}

/* El costo que regía en `instante` (ISO, con zona; se compara como instante).
   -> { costo, aproximado }
   · `aproximado`: la venta cae antes de que empezara el historial, o el perfume
     no tiene historial. Es el mejor dato que hay, pero no se sabe si antes
     hubo otros cambios.
   · `costo: 0`: no había costo cargado en ese momento. */
export function costoEnFecha(perfume, instante) {
  const historial = Array.isArray(perfume?.historialCostos) ? perfume.historialCostos : [];
  if (!historial.length) return { costo: num(perfume?.costo), aproximado: true };

  const t = Date.parse(instante);
  let vigente = null;
  for (const e of historial) {
    if (e.desde == null || Date.parse(e.desde) <= t) vigente = e;
    else break;
  }
  if (!vigente) return { costo: 0, aproximado: false };
  return { costo: num(vigente.costo), aproximado: vigente.desde == null };
}
