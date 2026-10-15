import { preciosDePlanes } from "./precios";

/* ============================================================
   Cliente de /api/ml (ver vite-plugin-ml.js) y las cuentas puras de la
   pestaña de Mercado Libre.

   El vínculo con ML vive en el perfume: `publicacionesML` es el mapa
   `plan → id de publicación` (`{"1": "MLA123", "6": "MLA456"}`), gemelo de
   `preciosML` y `margenesML`. Lo pone Franco eligiendo, nunca se adivina.
   ============================================================ */

const URL_ML = "/api/ml";

const pedir = async (ruta, opciones = {}) => {
  const r = await fetch(`${URL_ML}${ruta}`, {
    ...opciones,
    headers: opciones.body ? { "Content-Type": "application/json" } : undefined,
  });
  let datos = {};
  try {
    datos = await r.json();
  } catch (e) {
    /* sin cuerpo JSON: el server de la app no está (build estático) */
  }
  if (!r.ok) throw new Error(datos.error || `HTTP ${r.status}`);
  return datos;
};

/* -> { conectado, nickname?, userId?, falta? } (falta: claves que faltan en .env.local) */
export const estadoML = () => pedir("/estado");

/* -> { url } para abrir en otra pestaña */
export const pedirAutorizacionML = () => pedir("/autorizar", { method: "POST" });

/* `pegado`: la dirección de kukune.com.ar a la que volvió ML, o el código solo. */
export const enviarCodigoML = (pegado) =>
  pedir("/autorizar/codigo", { method: "POST", body: JSON.stringify({ pegado }) });

/* -> [{ id, titulo, precio, stock, estado, link, miniatura, tipo, variaciones }] */
export const leerPublicacionesML = async () => (await pedir("/publicaciones")).publicaciones;

/* Escribe en Mercado Libre. Solo se llama después de una confirmación. */
export const actualizarPublicacionML = (id, cambios) =>
  pedir(`/publicaciones/${id}`, { method: "PUT", body: JSON.stringify(cambios) });

/* Solo lectura. `desde`/`hasta` en AAAA-MM-DD, hora de Argentina.
   -> { ordenes, envios, total, truncado } (ver gananciasDeVentas en gananciasML.js) */
export const leerVentasML = (desde, hasta) =>
  pedir(`/ventas?${new URLSearchParams({ desde, hasta })}`);

export const vinculosDe = (perfume) => perfume?.publicacionesML ?? {};

/* La publicación de catálogo de cada plan, mapa gemelo (`plan → MLA`). Aparte y
   no adentro de `publicacionesML` para que lo que manda precios no cambie: la de
   catálogo no los recibe, ML se los sincroniza desde la normal. Sirve para ver
   su precio y para que Ventas reconozca sus ventas. */
export const vinculosCatalogoDe = (perfume) => perfume?.publicacionesCatalogoML ?? {};

export const CAMPO_DE_VINCULO = { normal: "publicacionesML", catalogo: "publicacionesCatalogoML" };

export const nombreDePlan = (plan) => (Number(plan) === 1 ? "1 pago" : `${plan} cuotas`);

const ESTADOS = { active: "activa", paused: "pausada", closed: "finalizada", under_review: "en revisión" };

/* Cuántas cuotas ofrece una publicación. No hay un campo: sale del tipo y de
   los tags (doc de ML "Campañas con cuotas para Marketplace"):
   · gold_pro (Premium) sin tag → 6 cuotas sin interés; con 3x_campaign,
     9x_campaign o 12x_campaign → 3, 9 o 12.
   · gold_special (Clásica) sin tag → un pago; con pcj-co-funded → cuotas con
     interés bajo, de 3 a 12 a elección del comprador (la API no dice cuántas).
   -> { plan, texto }: `plan` es el plan de la app al que corresponde (1, 3, 6…)
      o null si no se puede decir. */
export function cuotasDePublicacion(x) {
  const tags = x?.tags ?? [];
  if (x?.tipo === "gold_pro") {
    const n = [3, 9, 12].find((k) => tags.includes(`${k}x_campaign`)) ?? 6;
    return { plan: n, texto: `${n} cuotas sin interés` };
  }
  if (x?.tipo === "gold_special") {
    return tags.includes("pcj-co-funded")
      ? { plan: null, texto: "3 a 12 cuotas con interés bajo" }
      : { plan: 1, texto: "1 pago" };
  }
  if (x?.tipo === "free") return { plan: 1, texto: "gratuita" };
  return { plan: null, texto: x?.tipo ?? "" };
}

/* Si la publicación no es del plan al que se vincula (una de 6 cuotas en el de
   1 pago), la frase que lo avisa; si coincide o no se sabe, null. */
export function avisoDePlan(x, plan) {
  const c = cuotasDePublicacion(x);
  if (c.plan == null || c.plan === Number(plan)) return null;
  return `es de ${c.texto}, no de ${nombreDePlan(plan)}`;
}

/* Lo que distingue a dos publicaciones con el mismo título: las cuotas que
   ofrece, si es de catálogo, el stock y el estado. */
export const detallePublicacion = (x) =>
  [
    cuotasDePublicacion(x).texto,
    x.catalogo ? "catálogo" : null,
    `stock ${x.stock}`,
    ESTADOS[x.estado] ?? x.estado,
  ]
    .filter(Boolean)
    .join(" · ");

/* Qué precios del catálogo no coinciden con lo publicado.

   Recibe la lista RESUELTA (`perfumesResueltos`): ahí los planes clavados ya
   tienen su precio calculado. Con el estado crudo irían con el precio viejo.

   Devuelve:
   · `cambios`  — vinculados con precio en el catálogo distinto al de ML.
   · `perdidos` — vinculados a una publicación que ML ya no devuelve (borrada,
                  o de otra cuenta). No se tocan; se avisan.
   Un plan sin precio en el catálogo no se manda: publicar a $0 no existe. */
export function cambiosParaML(perfumes, publicaciones, planes) {
  const porId = new Map((publicaciones ?? []).map((x) => [x.id, x]));
  const cambios = [];
  const perdidos = [];
  for (const p of perfumes ?? []) {
    const vinculos = vinculosDe(p);
    const precios = preciosDePlanes(p);
    for (const plan of planes) {
      const itemId = vinculos[plan];
      if (!itemId) continue;
      const pub = porId.get(itemId);
      if (!pub) {
        perdidos.push({ perfumeId: p.id, nombre: p.nombre, plan, itemId });
        continue;
      }
      const precioCatalogo = Number(precios[plan]) || 0;
      if (!(precioCatalogo > 0) || precioCatalogo === Number(pub.precio)) continue;
      cambios.push({
        perfumeId: p.id,
        nombre: p.nombre,
        plan,
        itemId,
        titulo: pub.titulo,
        detalle: detallePublicacion(pub),
        variaciones: pub.variaciones,
        precioML: Number(pub.precio),
        precioCatalogo,
      });
    }
  }
  return { cambios, perdidos };
}
