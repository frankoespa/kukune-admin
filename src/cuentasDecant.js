/* ============================================================
   Decants: porciones chicas de un perfume (5 ml, 10 ml…) vendidas en su
   propio frasquito con caja.

   Puro y sin React: lo usan App, la pestaña Decants y la de Tiendanube, y se
   prueba desde Node. **No se puede llamar `decants.js`**: en Windows chocaría
   con un `Decants.jsx` (ya pasó con `clienteML.js` y `MercadoLibre.jsx`).

   Modelo (todo en perfumes.json, sin migración: sin la clave = no hay):
   · `perfume.ml` — los ml del frasco entero. La medida vive SOLO ahí: el nombre
     ya no la lleva. Sin `ml` no se inventa costo.
   · `ajustes.decants = { tipos: [...], redondeoDirecto, redondeoTN }`. Cada tipo
     es `{id, ml, costoFrasco, costoCaja}` más el objetivo por defecto con las
     MISMAS claves que un perfume (margenObjetivo, gananciaObjetivo, margenTN,
     gananciaTN, igualarDirectoTN, formaTN).
   · `perfume.decants = [{tipo, …, precioPublico, precioTN, publicacionTN,
     ofertaTN}]` — uno por tipo asignado.

   Herencia del objetivo, por GRUPO (directo y Tiendanube por separado):
   · Si la entrada no tiene ninguna clave del grupo, hereda el del tipo.
   · Si tiene alguna (aunque sea en `null`), manda la suya. `margenTN: null`
     solo = precio de Tiendanube a mano.
   Así "soltar" tiene dos destinos: con objetivo propio vuelve a heredar del
   tipo; heredando, pasa a precio a mano.
   ============================================================ */

import {
  objetivoDirecto,
  objetivoTN,
  precioPublicoDesdeGanancia,
  precioPublicoDesdeMargen,
  precioTiendaNubeDesdeObjetivo,
} from "./precios.js";

export const CLAVES_DIRECTO = ["margenObjetivo", "gananciaObjetivo"];
export const CLAVES_TN = ["margenTN", "gananciaTN", "igualarDirectoTN", "formaTN"];

// "Presente" es cualquier valor menos undefined: null cuenta (es "a mano").
const tieneAlguna = (o, claves) => !!o && claves.some((k) => o[k] !== undefined);
const tomar = (o, claves) => {
  const r = {};
  for (const k of claves) if (o && o[k] !== undefined) r[k] = o[k];
  return r;
};
const sin = (o, claves) => {
  const r = { ...o };
  for (const k of claves) delete r[k];
  return r;
};

/* ---------- La medida del frasco ---------- */

const MEDIDA = /\s*\b(\d+(?:[.,]\d+)?)\s*ml\b\.?/i;

/* "Lattafa Hayaati 100ml" -> { nombre: "Lattafa Hayaati", ml: 100 }.
   Sin medida en el nombre, `ml: null` y el nombre igual. Se usa una sola vez,
   para pasar los nombres viejos al campo `ml`. */
export function separarMedida(nombre) {
  const texto = String(nombre ?? "");
  const m = texto.match(MEDIDA);
  if (!m) return { nombre: texto.trim(), ml: null };
  const ml = Number(m[1].replace(",", "."));
  const limpio = (texto.slice(0, m.index) + " " + texto.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
  return { nombre: limpio, ml: Number.isFinite(ml) && ml > 0 ? ml : null };
}

/* Los perfumes cuyo nombre todavía trae la medida, con lo que les haría el
   pase. `conflicto` = ya tienen `ml` distinto al del nombre: no se tocan. */
export function pasesDeMedida(perfumes) {
  const salida = [];
  for (const p of perfumes ?? []) {
    const s = separarMedida(p.nombre);
    if (s.ml == null) continue;
    const actual = Number(p.ml) > 0 ? Number(p.ml) : null;
    salida.push({ id: p.id, antes: p.nombre, nombre: s.nombre, ml: s.ml, conflicto: actual != null && actual !== s.ml });
  }
  return salida;
}

/* "Lattafa Hayaati 100 ml", o el nombre solo si no se sabe la medida. Para
   donde el cliente o el proveedor necesitan ver el tamaño (los PDF). */
export const nombreConMedida = (p) => {
  const ml = Number(p?.ml);
  return ml > 0 ? `${p.nombre} ${formatoMl(ml)} ml` : p?.nombre ?? "";
};

export const formatoMl = (ml) => String(ml).replace(".", ",");

/* ---------- Tipos ---------- */

export const tiposDeDecant = (ajustes) => (Array.isArray(ajustes?.decants?.tipos) ? ajustes.decants.tipos : []);

export const nombreDeTipo = (tipo) => (tipo ? `${formatoMl(Number(tipo.ml) || 0)} ml` : "");

/* Los ajustes de Tiendanube con los que se calculan los decants: los mismos de
   la tienda (formas, comisiones, envío) con su propio redondeo. El $1.000 de
   los frascos es demasiado grueso para un precio de $9.000. */
export function ajustesTNDeDecants(ajustes) {
  const tn = ajustes?.tiendaNube;
  if (!tn) return tn;
  const r = ajustes?.decants?.redondeoTN;
  return r == null ? tn : { ...tn, redondeo: r };
}

/* ---------- Cuentas ---------- */

/* Costo de un decant: los ml que lleva, al costo por ml del frasco, más su
   frasquito y su caja. `null` si el perfume no tiene costo o no tiene `ml`.
   No se guarda: sigue al costo del perfume (y al dólar, si está atado). */
/* `sinCaja`: sin la cajita individual. Es como va adentro de una caja de
   descubrimiento (`cuentasCaja.js`): el frasquito solo. */
export function costoDecant(perfume, tipo, { sinCaja = false } = {}) {
  const costo = Number(perfume?.costo) || 0;
  const ml = Number(perfume?.ml) || 0;
  const mlDecant = Number(tipo?.ml) || 0;
  if (!(costo > 0) || !(ml > 0) || !(mlDecant > 0)) return null;
  return Math.round(
    (costo / ml) * mlDecant + (Number(tipo.costoFrasco) || 0) + (sinCaja ? 0 : Number(tipo.costoCaja) || 0)
  );
}

export const costoPorMl = (perfume) => {
  const costo = Number(perfume?.costo) || 0;
  const ml = Number(perfume?.ml) || 0;
  return costo > 0 && ml > 0 ? costo / ml : null;
};

/* El objetivo efectivo del decant: grupo por grupo, el de la entrada si tiene
   alguna clave, si no el del tipo. Devuelve un objeto con las claves de un
   perfume, para pasárselo a `objetivoDirecto()` y `objetivoTN()` tal cual. */
export function objetivosDelDecant(tipo, entrada) {
  const directo = tieneAlguna(entrada, CLAVES_DIRECTO) ? tomar(entrada, CLAVES_DIRECTO) : tomar(tipo, CLAVES_DIRECTO);
  const tn = tieneAlguna(entrada, CLAVES_TN) ? tomar(entrada, CLAVES_TN) : tomar(tipo, CLAVES_TN);
  return {
    ...directo,
    ...tn,
    hereda: { directo: !tieneAlguna(entrada, CLAVES_DIRECTO), tn: !tieneAlguna(entrada, CLAVES_TN) },
  };
}

/* Los precios de UNA entrada ya despejados. Devuelve la misma entrada si no
   cambió nada. */
function resolverEntrada(perfume, entrada, tipo, ajustes, ajustesTN) {
  const costo = costoDecant(perfume, tipo);
  if (costo == null) return entrada;
  const obj = objetivosDelDecant(tipo, entrada);
  let salida = entrada;

  const directo = objetivoDirecto(obj);
  const redondeoDirecto = ajustes?.decants?.redondeoDirecto ?? 1;
  if (directo) {
    const precio =
      directo.ganancia != null
        ? precioPublicoDesdeGanancia(costo, directo.ganancia, redondeoDirecto)
        : precioPublicoDesdeMargen(costo, directo.margen, redondeoDirecto);
    if (precio !== null && precio !== entrada.precioPublico) salida = { ...salida, precioPublico: precio };
  }

  const objetivo = objetivoTN(obj);
  if (objetivo && ajustesTN) {
    const r = precioTiendaNubeDesdeObjetivo({ costo, precioDirecto: salida.precioPublico, ...objetivo, ajustesTN });
    if (r && !r.noAplica && r.precio !== (Number(entrada.precioTN) || 0)) salida = { ...salida, precioTN: r.precio };
  }
  return salida;
}

/* El catálogo con los precios de los decants despejados. Corre DESPUÉS de
   `resolverPreciosDelCatalogo` (usa el costo ya resuelto). Igual que él,
   devuelve **el mismo array** si nada cambió: abrir la app no escribe. */
export function resolverDecantsDelCatalogo(perfumes, ajustes) {
  const tipos = tiposDeDecant(ajustes);
  if (!tipos.length) return perfumes;
  const porId = new Map(tipos.map((t) => [t.id, t]));
  const ajustesTN = ajustesTNDeDecants(ajustes);
  let hubo = false;
  const salida = (perfumes ?? []).map((p) => {
    if (!Array.isArray(p.decants) || !p.decants.length) return p;
    let cambio = false;
    const decants = p.decants.map((e) => {
      const tipo = porId.get(e.tipo);
      if (!tipo) return e;
      const r = resolverEntrada(p, e, tipo, ajustes, ajustesTN);
      if (r !== e) cambio = true;
      return r;
    });
    if (!cambio) return p;
    hubo = true;
    return { ...p, decants };
  });
  return hubo ? salida : perfumes;
}

/* ---------- Un decant como si fuera un perfume ---------- */

const SEP = ":decant:";
export const idDecant = (perfumeId, tipoId) => `${perfumeId}${SEP}${tipoId}`;
export const esIdDecant = (id) => typeof id === "string" && id.includes(SEP);
export const partesIdDecant = (id) => {
  const i = String(id).indexOf(SEP);
  return i < 0 ? null : { perfumeId: id.slice(0, i), tipoId: id.slice(i + SEP.length) };
};

/* Un decant con la forma de un perfume, para que la pestaña de Tiendanube (y
   todo lo que cuelga de ella: detalle, cupones, envío gratis, Aplicar a todos,
   Actualizar precios) lo trate igual sin saber que existe. Las claves de
   objetivo son las EFECTIVAS (heredadas o propias); `hereda` dice de dónde. */
export function vendibleDeDecant(perfume, entrada, tipo) {
  const obj = objetivosDelDecant(tipo, entrada);
  const { hereda, ...claves } = obj;
  return {
    ...claves,
    id: idDecant(perfume.id, tipo.id),
    nombre: `${perfume.nombre} · ${nombreDeTipo(tipo)}`,
    foto: perfume.foto ?? null,
    costo: costoDecant(perfume, tipo),
    precioPublico: entrada.precioPublico ?? null,
    precioTN: entrada.precioTN ?? null,
    ofertaTN: entrada.ofertaTN,
    publicacionTN: entrada.publicacionTN,
    decantDe: perfume,
    tipo,
    hereda,
  };
}

/* Todos los decants asignados del catálogo como vendibles, ordenados por
   perfume y ml. Un tipo borrado no aparece. */
export function decantsComoVendibles(perfumes, ajustes) {
  const tipos = tiposDeDecant(ajustes);
  if (!tipos.length) return [];
  const porId = new Map(tipos.map((t) => [t.id, t]));
  const salida = [];
  for (const p of perfumes ?? []) {
    for (const e of p.decants ?? []) {
      const tipo = porId.get(e.tipo);
      if (tipo) salida.push({ ...vendibleDeDecant(p, e, tipo), redondeoTN: ajustes?.decants?.redondeoTN ?? undefined });
    }
  }
  return salida;
}

/* Aplica `fn` a los perfumes y a las entradas de decant cuyos ids estén en
   `ids`, en una sola pasada. Es lo que deja que las escrituras de la pestaña de
   Tiendanube —que sólo conoce ids— caigan en el frasco o en la entrada del
   decant según corresponda. Devuelve el mismo array si no tocó nada. */
export function aplicarAVendibles(perfumes, ids, fnPerfume, fnDecant = fnPerfume) {
  const cuales = new Set(ids);
  let hubo = false;
  const salida = perfumes.map((p) => {
    let q = p;
    if (cuales.has(p.id)) q = fnPerfume(p);
    if (Array.isArray(p.decants) && p.decants.some((e) => cuales.has(idDecant(p.id, e.tipo)))) {
      q = { ...q, decants: (q.decants ?? p.decants).map((e) => (cuales.has(idDecant(p.id, e.tipo)) ? fnDecant(e, p) : e)) };
    }
    if (q !== p) hubo = true;
    return q;
  });
  return hubo ? salida : perfumes;
}

/* Soltar el objetivo de un grupo en una entrada de decant. Con objetivo propio
   vuelve a heredar del tipo; heredando, queda a mano. El precio resuelto va en
   el mismo movimiento, o la entrada vuelve al precio viejo del estado crudo. */
export function soltarEnDecant(entrada, grupo, precioResuelto) {
  const claves = grupo === "tn" ? CLAVES_TN : CLAVES_DIRECTO;
  const campoPrecio = grupo === "tn" ? "precioTN" : "precioPublico";
  const nulo = grupo === "tn" ? { margenTN: null } : { margenObjetivo: null };
  const base = sin(entrada, claves);
  return tieneAlguna(entrada, claves)
    ? { ...base, [campoPrecio]: precioResuelto }
    : { ...base, ...nulo, [campoPrecio]: precioResuelto };
}

/* Asignar o quitar un tipo a varios perfumes. Asignar no pisa una entrada que
   ya exista (con sus precios y su vínculo). */
export function asignarTipo(perfumes, ids, tipoId, ofrecer) {
  const cuales = new Set(ids);
  let hubo = false;
  const salida = perfumes.map((p) => {
    if (!cuales.has(p.id)) return p;
    const lista = Array.isArray(p.decants) ? p.decants : [];
    const tiene = lista.some((e) => e.tipo === tipoId);
    if (ofrecer === tiene) return p;
    hubo = true;
    return { ...p, decants: ofrecer ? [...lista, { tipo: tipoId }] : lista.filter((e) => e.tipo !== tipoId) };
  });
  return hubo ? salida : perfumes;
}
