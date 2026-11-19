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

/* Las promociones que ML tiene puestas en esas publicaciones. Solo lectura.
   -> { promos: { MLA…: [promo] }, errores: { MLA…: mensaje }, sinPermiso }
   (la forma de cada promo la arma `resumirPromo` en vite-plugin-ml.js). */
export const leerPromocionesML = (ids) =>
  pedir(`/promociones?${new URLSearchParams({ ids: (ids ?? []).join(",") })}`);

/* Las invitaciones a campañas (Black Friday, Cyber Monday y las demás).
   -> { campanas: [{ id, tipo, nombre, estado, coFondeada, desde, hasta, limite,
                     meliPct, vendedorPct, llevaPaga }], sinPermiso } */
export const leerCampanasML = () => pedir("/campanas");

/* Las publicaciones candidatas y las que ya participan de una campaña.
   -> { items, sinPermiso, truncado }; cada item trae `itemId` (el MLA). */
export const leerItemsDeCampanaML = (id, tipo) =>
  pedir(`/campanas/${encodeURIComponent(id)}/items?${new URLSearchParams({ tipo })}`);

/* Escribe en Mercado Libre: suma la publicación a una campaña, cambia su precio
   en una tradicional, o le pone un descuento propio. Siempre después de una
   confirmación. `pedido` lo valida `pedidoDePromo` en el server.

   Con `reemplaza: true` el server quita primero el descuento que ya tenía: ML
   no deja encimar dos (contesta "No candidates found for item") y la doc dice
   que para cambiarlo hay que borrarlo y volver a crearlo.
   -> { ok, reemplazado, mandado, resultado, promos } */
export const ponerPromoML = (itemId, pedido) =>
  pedir(`/promociones/${itemId}`, { method: "POST", body: JSON.stringify(pedido) });

/* Saca la publicación de una promoción. `promocion` y `oferta` son opcionales
   según el tipo (un descuento propio no tiene campaña). */
export const quitarPromoML = (itemId, { tipo, promocion, oferta } = {}) =>
  pedir(
    `/promociones/${itemId}?${new URLSearchParams({
      tipo,
      ...(promocion ? { promocion } : {}),
      ...(oferta ? { oferta } : {}),
    })}`,
    { method: "DELETE" }
  );

/* Le agrega otro plan de cuotas a un perfume que YA está publicado: hereda del
   User Product la ficha, las fotos, el nombre y el stock, así que solo viajan
   el plan y el precio. ESCRIBE EN ML, siempre tras una confirmación.
   -> { resultados, userProductId, sincronizacion } (como publicarEnML) */
export const publicarCondicionML = (pedido) =>
  pedir("/publicar/condicion", { method: "POST", body: JSON.stringify(pedido) });

/* ---- Publicar (ver ml-publicar.js) ---- */

/* -> { base, existe, carpetas: [{ nombre, existe, fotos: [{archivo, ancho, alto, bytes}], txt }] }
   `existe` de cada carpeta = si tiene la subcarpeta Mercadolibre. */
export const leerCarpetasML = () => pedir("/carpetas");

/* Una foto o el texto (publicacion_ml.txt) de `<carpeta>/Mercadolibre/`. */
export const urlDeCarpetaML = (carpeta, archivo) =>
  `${URL_ML}/carpetas/${encodeURIComponent(carpeta)}/${encodeURIComponent(archivo)}`;

export const leerTxtDeCarpetaML = async (carpeta, archivo) => {
  if (!archivo) return "";
  const r = await fetch(urlDeCarpetaML(carpeta, archivo));
  return r.ok ? r.text() : "";
};

/* -> { ATRIBUTO: [valores posibles] } de la categoría de perfumes. */
export const leerFichaML = async () => (await pedir("/ficha")).listas;

/* No publica: sube las fotos y le pregunta a ML si aceptaría cada plan. */
export const validarPublicacionML = (pedido) =>
  pedir("/publicar/validar", { method: "POST", body: JSON.stringify(pedido) });

/* ESCRIBE EN ML: crea las publicaciones. Solo después de una confirmación. */
export const publicarEnML = (pedido) => pedir("/publicar", { method: "POST", body: JSON.stringify(pedido) });

/* ---- Actualizar una que ya existe (ver ml-publicar.js) ---- */

/* -> { id, familyName, vendidas, userProductId, catalogo, fotos: [{id, url}], attributes, descripcion } */
export const leerPublicacionML = (id) => pedir(`/publicacion/${id}`);

/* ESCRIBE EN ML. `itemIds`: una normal por producto de usuario. `fotos`: la tira
   final (`{tipo: "ml", id}` | `{tipo: "carpeta", archivo}`). Solo después de una
   confirmación. -> { fotos (ids finales, en orden) | null, resultados: [{itemId, ok, errores, advertencias}] } */
export const actualizarEnML = (pedido) => pedir("/actualizar", { method: "POST", body: JSON.stringify(pedido) });

/* Relee varias para ver si ML ya les pasó los cambios. */
export const estadoDePublicacionesML = async (ids) =>
  (await pedir(`/publicaciones/estado?${new URLSearchParams({ ids: ids.join(",") })}`)).publicaciones;

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

/* Cómo se llama cada tipo de promo en pantalla. Lo que importa no es el nombre
   técnico sino quién paga el descuento: las co-fondeadas las pone ML en parte. */
const NOMBRES_DE_PROMO = {
  PRICE_DISCOUNT: "descuento tuyo",
  DEAL: "campaña de ML",
  SELLER_CAMPAIGN: "campaña tuya",
  DOD: "oferta del día",
  LIGHTNING: "oferta relámpago",
  MARKETPLACE_CAMPAIGN: "campaña co-fondeada",
  SMART: "campaña co-fondeada automática",
  PRICE_MATCHING: "precios competitivos",
  PRE_NEGOTIATED: "descuento pre-acordado",
  VOLUME: "descuento por cantidad",
  UNHEALTHY_STOCK: "liquidación de stock Full",
  SELLER_COUPON_CAMPAIGN: "cupones",
};

export const nombreDeTipoPromo = (tipo) => NOMBRES_DE_PROMO[tipo] ?? (tipo ? tipo.toLowerCase() : "promoción");

/* La promo que manda para mostrar: la que está corriendo y tiene precio. Un
   ítem puede tener varias (una activa y otras como candidato o programadas). */
export const promoVigente = (promos) =>
  (promos ?? []).find((p) => p.activa && p.paga != null) ?? null;

/* La promo vigente de cada plan del perfume, cruzando por el vínculo guardado
   —nunca por nombre, como en Ventas—.

   Mira solo la publicación NORMAL: a la de catálogo no se le mandan precios (ML
   la sincroniza sola), así que su promo no es una decisión que se tome acá.
   -> { "1": promo, "6": promo } con los planes que tengan una. */
export function promosPorPlan(perfume, promosPorItem) {
  const salida = {};
  for (const [plan, itemId] of Object.entries(vinculosDe(perfume))) {
    const vigente = promoVigente(promosPorItem?.[itemId]);
    if (vigente) salida[plan] = vigente;
  }
  return salida;
}

/* El precio de LISTA de una publicación, que es contra el que se compara el
   del catálogo. Con una promo activa ML baja `precio` y deja el de lista en
   `precioLista`; sin promo los dos son el mismo. Todo lugar que compare
   precios tiene que pasar por acá y no por `pub.precio`. */
export const precioListaDe = (pub) => Number(pub?.precioLista ?? pub?.precio) || 0;

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
      const precioML = precioListaDe(pub);
      if (!(precioCatalogo > 0) || precioCatalogo === precioML) continue;
      cambios.push({
        perfumeId: p.id,
        nombre: p.nombre,
        plan,
        itemId,
        titulo: pub.titulo,
        detalle: detallePublicacion(pub),
        variaciones: pub.variaciones,
        precioML,
        precioCatalogo,
      });
    }
  }
  return { cambios, perdidos };
}
