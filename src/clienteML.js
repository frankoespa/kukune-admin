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

export const vinculosDe = (perfume) => perfume?.publicacionesML ?? {};

export const nombreDePlan = (plan) => (Number(plan) === 1 ? "1 pago" : `${plan} cuotas`);

const TIPOS = { gold_pro: "Premium", gold_special: "Clásica", free: "Gratuita" };
const ESTADOS = { active: "activa", paused: "pausada", closed: "finalizada", under_review: "en revisión" };

/* Lo que distingue a dos publicaciones con el mismo título: el tipo (en
   Argentina, Premium es la que ofrece cuotas sin interés), si es de catálogo,
   el stock y el estado. */
export const detallePublicacion = (x) =>
  [
    TIPOS[x.tipo] ?? x.tipo,
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
