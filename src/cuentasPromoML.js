import { resultadoDeCanal } from "./precios.js";
import { indiceDePublicaciones } from "./gananciasML.js";

/* ============================================================
   Qué deja cada publicación candidata si entra a una campaña de Mercado Libre.

   Esto es lo que contesta "me conviene entrar a Black Friday?". Todo pasa por
   `resultadoDeCanal`, que es la única fórmula de canal de la app: acá no hay
   cuentas nuevas, solo se le pasa el precio de la promo y, cuando la campaña es
   co-fondeada, lo que de verdad llega (que es MÁS que lo que paga el comprador,
   porque ML pone su parte).

   Puro y sin React: se prueba desde Node.

   Ojo con el nombre del archivo: NO puede llamarse `promocionesML.js` si algún
   día hay un `PromocionesML.jsx`, porque en Windows son el mismo archivo y el
   build se rompe con "default is not exported" — ya pasó con `clienteML.js` /
   `MercadoLibre.jsx` y con `gananciasML.js` / `VentasML.jsx`.
   ============================================================ */

/* El precio que se evaluaría: el que la promo ya tiene, o el que ML sugiere si
   todavía es candidata (donde `paga` viene en 0, que no es un precio). */
export const precioAEvaluar = (item) => item?.paga ?? item?.sugerido ?? null;

/* Lo que te llega con esa promo. En una co-fondeada ML paga su parte, así que
   llega `lista × (1 − lo tuyo)`, más que lo que paga el comprador. Si no se sabe
   cuánto pone ML se supone lo peor —que lo pagás todo vos— y el número queda del
   lado seguro. */
export function loQueLlega(item, campana, precio) {
  if (!item?.coFondeada && !campana?.coFondeada) return precio;
  const vendedorPct = item?.vendedorPct ?? campana?.vendedorPct ?? null;
  const lista = Number(item?.lista) || 0;
  if (vendedorPct == null || !(lista > 0)) return precio;
  return lista * (1 - vendedorPct / 100);
}

/* Una fila por publicación candidata de la campaña, cruzada con el catálogo por
   el vínculo guardado (nunca por nombre).

   -> { filas, sinCosto, sinVincular, total }
   · `filas`       — vinculadas y con costo, de la que MÁS PIERDE a la que menos:
                     lo primero que se ve es a qué perfume no conviene entrar.
   · `sinCosto`    — vinculadas sin costo en el catálogo: no se inventa ninguno.
   · `sinVincular` — publicaciones que no son de ningún perfume de la app.
   · `total`       — cuánto cambia la ganancia por unidad si entraran todas. */
export function filasDeCampana(campana, items, perfumes, ajustes = {}) {
  const indice = indiceDePublicaciones(perfumes);
  const comisionML = Number(ajustes.comisionML) || 0;
  const envioML = Number(ajustes.envioML) || 0;
  const cuotasML = ajustes.cuotasML ?? {};

  const filas = [];
  const sinCosto = [];
  const sinVincular = [];

  for (const item of items ?? []) {
    const encontrado = item.itemId ? indice.get(item.itemId) : null;
    if (!encontrado) {
      sinVincular.push({ ...item });
      continue;
    }
    const { perfume, plan, catalogo } = encontrado;
    const costo = Number(perfume.costo) || 0;
    const base = { ...item, perfume, plan, catalogo, costo };
    if (!(costo > 0)) {
      sinCosto.push(base);
      continue;
    }
    const comision = comisionML + (plan === 1 ? 0 : Number(cuotasML[plan]) || 0);
    const precio = precioAEvaluar(item);
    /* Sin precio no hay nada que calcular: es una candidata a la que ML todavía
       no le puso número ni sugerencia. Con `recibe` aparte daría el absurdo de
       "ML pone $105.000" al lado de un precio vacío. */
    const recibe = precio == null ? null : loQueLlega(item, campana, precio);
    const conPromo = resultadoDeCanal({ costo, precio, comision, envio: envioML, recibe });
    // Lo que deja hoy, al precio que está publicado, sin promo.
    const hoy = resultadoDeCanal({ costo, precio: item.lista, comision, envio: envioML });
    filas.push({
      ...base,
      comision,
      precio,
      recibe,
      ganancia: conPromo.ganancia,
      margen: conPromo.margen,
      gananciaHoy: hoy.ganancia,
      diferencia:
        conPromo.ganancia == null || hoy.ganancia == null ? null : conPromo.ganancia - hoy.ganancia,
      pierdePlata: conPromo.ganancia != null && conPromo.ganancia <= 0,
    });
  }

  /* De peor a mejor: la que más ganancia pierde primero. Las que no se pueden
     comparar (sin precio todavía) van al final, como los sin precio del orden
     "Por margen" del catálogo. */
  filas.sort((a, b) => {
    if (a.diferencia == null) return b.diferencia == null ? 0 : 1;
    if (b.diferencia == null) return -1;
    return a.diferencia - b.diferencia;
  });

  const conNumero = filas.filter((f) => f.diferencia != null);
  return {
    filas,
    sinCosto,
    sinVincular,
    total: {
      perfumes: conNumero.length,
      candidatas: filas.length,
      diferencia: conNumero.reduce((s, f) => s + f.diferencia, 0),
      enPerdida: filas.filter((f) => f.pierdePlata).length,
      comparables: conNumero.length,
    },
  };
}

/* Las que ya están adentro de la campaña y las que todavía son candidatas. ML
   usa `started` para la que corre y `pending` para la que está programada. */
export const yaParticipa = (item) => item?.estado === "started" || item?.estado === "pending";

/* Cuántos días quedan para aceptar la invitación. El plazo es el dato que
   apura, así que la pantalla lo muestra en vez de la fecha sola.
   -> número de días (puede ser 0 o negativo), o null si no hay plazo. */
export function diasParaAceptar(campana, ahora = new Date()) {
  if (!campana?.limite) return null;
  const limite = new Date(campana.limite);
  if (Number.isNaN(limite.getTime())) return null;
  return Math.ceil((limite.getTime() - ahora.getTime()) / 86400000);
}
