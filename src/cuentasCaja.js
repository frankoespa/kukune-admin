/* ============================================================
   Cajas de descubrimiento: una caja con N decants del mismo tamaño, cada uno
   de un perfume que elige Franco, que se vende directo y en Tiendanube como un
   producto propio.

   Puro y sin React: lo usan App, la pestaña Cajas y la de Tiendanube, y se
   prueba desde Node. La pantalla es `PestanaCajas.jsx` (sin choque de nombres
   en Windows).

   Modelo — en `ajustes.cajas` de perfumes.json (no está en
   AJUSTES_POR_DEFECTO: sin la clave no hay cajas, y abrir no escribe):
     { id, nombre, tipo,                 // tipo = id de un tipo de decant
       perfumes: [perfumeId, …],         // la cantidad de la caja es el largo
       costos: [{id, nombre, costo}],    // lista libre: caja, espuma, tarjeta…
       margenObjetivo, gananciaObjetivo, // las MISMAS claves que un perfume
       margenTN, gananciaTN, igualarDirectoTN, formaTN,
       precioPublico, precioTN, publicacionTN, ofertaTN }

   Adentro va el frasquito SOLO: sin la cajita individual del decant
   (`costoDecant(…, { sinCaja: true })`). La caja no hereda objetivo del tipo:
   tiene el suyo, o precio a mano.
   ============================================================ */

import { ajustesTNDeDecants, costoDecant, formatoMl, tiposDeDecant } from "./cuentasDecant.js";
import {
  objetivoDirecto,
  objetivoTN,
  precioPublicoDesdeGanancia,
  precioPublicoDesdeMargen,
  precioTiendaNubeDesdeObjetivo,
} from "./precios.js";

export const cajasDe = (ajustes) => (Array.isArray(ajustes?.cajas) ? ajustes.cajas : []);

const PREFIJO = "caja:";
export const idCaja = (id) => `${PREFIJO}${id}`;
export const esIdCaja = (id) => typeof id === "string" && id.startsWith(PREFIJO);
export const idDeCaja = (id) => (esIdCaja(id) ? id.slice(PREFIJO.length) : null);

export const sumaDeCostos = (caja) =>
  (caja?.costos ?? []).reduce((s, c) => s + (Number(c.costo) > 0 ? Number(c.costo) : 0), 0);

/* El costo de una caja, renglón por renglón. Un decant sin costo dice por qué
   (`falta`): "catalogo" si el perfume ya no está, "costo" o "ml" si le falta
   ese dato, "tipo" si el tamaño se borró. Con uno solo que falte, `total` es
   null: no se inventa un costo a medias. */
export function costoDeCaja(caja, perfumePorId, tipo) {
  const decants = (caja?.perfumes ?? []).map((perfumeId) => {
    const p = perfumePorId.get(perfumeId);
    let falta = null;
    if (!p) falta = "catalogo";
    else if (!tipo) falta = "tipo";
    else if (!(Number(p.costo) > 0)) falta = "costo";
    else if (!(Number(p.ml) > 0)) falta = "ml";
    const costo = falta ? null : costoDecant(p, tipo, { sinCaja: true });
    return { perfumeId, perfume: p ?? null, costo, falta };
  });
  const extras = sumaDeCostos(caja);
  const deDecants = decants.reduce((s, d) => s + (d.costo ?? 0), 0);
  const completo = decants.length > 0 && decants.every((d) => d.costo != null);
  return { decants, deDecants, extras, total: completo ? deDecants + extras : null };
}

const FALTA = {
  catalogo: "ya no está en el catálogo",
  tipo: "la caja no tiene tamaño",
  costo: "el perfume no tiene costo",
  ml: "el perfume no tiene ml",
};
export const motivoFalta = (f) => FALTA[f] ?? "";

const nombreTamano = (tipo) => (tipo ? `${formatoMl(Number(tipo.ml) || 0)} ml` : "");

/* "Caja de descubrimiento con 5 decants de 5 ml" + la lista. Texto plano: el
   que crea el producto lo pasa a HTML (`descripcionHTML`). */
export function descripcionDeCaja(caja, perfumePorId, tipo) {
  const n = (caja?.perfumes ?? []).length;
  const nombres = (caja?.perfumes ?? []).map((id) => perfumePorId.get(id)?.nombre).filter(Boolean);
  const cabeza = `Caja de descubrimiento con ${n} decant${n === 1 ? "" : "s"}${tipo ? ` de ${nombreTamano(tipo)}` : ""}.`;
  return nombres.length ? `${cabeza}\n\nIncluye:\n${nombres.map((x) => `- ${x}`).join("\n")}` : cabeza;
}

/* Las dos cuentas de precio de una caja, como `resolverEntrada` en
   cuentasDecant.js. Devuelve la misma caja si nada cambió. */
function resolverCaja(caja, costo, ajustes, ajustesTN) {
  if (costo == null) return caja;
  let salida = caja;
  const directo = objetivoDirecto(caja);
  const redondeoDirecto = ajustes?.decants?.redondeoDirecto ?? 1;
  if (directo) {
    const precio =
      directo.ganancia != null
        ? precioPublicoDesdeGanancia(costo, directo.ganancia, redondeoDirecto)
        : precioPublicoDesdeMargen(costo, directo.margen, redondeoDirecto);
    if (precio !== null && precio !== caja.precioPublico) salida = { ...salida, precioPublico: precio };
  }
  const objetivo = objetivoTN(caja);
  if (objetivo && ajustesTN) {
    const r = precioTiendaNubeDesdeObjetivo({ costo, precioDirecto: salida.precioPublico, ...objetivo, ajustesTN });
    if (r && !r.noAplica && r.precio !== (Number(caja.precioTN) || 0)) salida = { ...salida, precioTN: r.precio };
  }
  return salida;
}

/* Los ajustes con los precios de las cajas despejados. Corre sobre los
   perfumes YA resueltos (el costo de un decant cuelga del costo del perfume).
   Devuelve **el mismo objeto** si nada cambió: abrir la app no escribe. */
export function resolverCajas(perfumes, ajustes) {
  const cajas = cajasDe(ajustes);
  if (!cajas.length) return ajustes;
  const perfumePorId = new Map((perfumes ?? []).map((p) => [p.id, p]));
  const tipos = new Map(tiposDeDecant(ajustes).map((t) => [t.id, t]));
  const ajustesTN = ajustesTNDeDecants(ajustes);
  let hubo = false;
  const nuevas = cajas.map((c) => {
    const r = resolverCaja(c, costoDeCaja(c, perfumePorId, tipos.get(c.tipo)).total, ajustes, ajustesTN);
    if (r !== c) hubo = true;
    return r;
  });
  return hubo ? { ...ajustes, cajas: nuevas } : ajustes;
}

/* Una caja con la forma de un perfume, para que la pestaña de Tiendanube (la
   fila, el detalle, Aplicar a todos, Actualizar precios, cupones, carrito) la
   trate igual sin saber que existe. La foto es la del primer perfume. */
export function vendibleDeCaja(caja, perfumePorId, tipos) {
  const tipo = tipos.get(caja.tipo) ?? null;
  const primero = perfumePorId.get(caja.perfumes?.[0]);
  return {
    ...caja,
    id: idCaja(caja.id),
    nombre: caja.nombre || "Caja sin nombre",
    foto: caja.foto ?? primero?.foto ?? null,
    costo: costoDeCaja(caja, perfumePorId, tipo).total,
    precioPublico: caja.precioPublico ?? null,
    precioTN: caja.precioTN ?? null,
    esCaja: true,
    cajaId: caja.id,
    tipo,
  };
}

export function cajasComoVendibles(perfumes, ajustes) {
  const cajas = cajasDe(ajustes);
  if (!cajas.length) return [];
  const perfumePorId = new Map((perfumes ?? []).map((p) => [p.id, p]));
  const tipos = new Map(tiposDeDecant(ajustes).map((t) => [t.id, t]));
  const redondeoTN = ajustes?.decants?.redondeoTN ?? undefined;
  return cajas.map((c) => ({ ...vendibleDeCaja(c, perfumePorId, tipos), redondeoTN }));
}

/* Aplica `fn` a las cajas cuyos ids de vendible (`caja:<id>`) estén en `ids`.
   Gemelo de `aplicarAVendibles`: devuelve el mismo objeto si no tocó nada, así
   los escritores de App pueden llamarlo siempre sin disparar un guardado. */
export function aplicarACajas(ajustes, ids, fn) {
  const cuales = new Set((ids ?? []).map(idDeCaja).filter(Boolean));
  if (!cuales.size) return ajustes;
  const cajas = cajasDe(ajustes);
  let hubo = false;
  const nuevas = cajas.map((c) => {
    if (!cuales.has(c.id)) return c;
    const r = fn(c);
    if (r !== c) hubo = true;
    return r;
  });
  return hubo ? { ...ajustes, cajas: nuevas } : ajustes;
}

/* Una caja nueva, o la copia de otra (Duplicar): perfumes, costos y objetivos
   viajan; el vínculo con Tiendanube y la oferta no (es otro producto). */
export function nuevaCaja({ tipo = null, base = null, id = crypto.randomUUID() } = {}) {
  if (base) {
    const { publicacionTN, ofertaTN, ...resto } = base;
    return {
      ...resto,
      id,
      nombre: `${base.nombre || "Caja"} (copia)`,
      perfumes: [...(base.perfumes ?? [])],
      costos: (base.costos ?? []).map((c) => ({ ...c, id: crypto.randomUUID() })),
    };
  }
  return { id, nombre: "", tipo, perfumes: [], costos: [] };
}
