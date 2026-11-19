import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { loadEnv } from "vite";
import { crearPublicador } from "./ml-publicar.js";

/* ============================================================
   Mercado Libre, del lado del server.

   El client secret y los tokens viven SOLO acá: el navegador habla con
   /api/ml/* y nunca ve ninguno de los dos.

   · App     → `.env.local` (ignorado por git):
                 ML_CLIENT_ID       obligatorio
                 ML_CLIENT_SECRET   obligatorio
                 ML_REDIRECT_URI    opcional, si falta se usa REDIRECT_POR_DEFECTO
               Cambiar de app es tocar ese archivo y reiniciar, no el código.
   · Tokens  → datos/ml/tokens.json (ignorado por git, como todo `datos/`).
               Archivo aparte: no toca nada del negocio.

   Endpoints:
   · GET  /api/ml/estado                 ¿hay secret? ¿hay token? ¿de qué cuenta?
   · POST /api/ml/autorizar              arma la URL de autorización (PKCE)
   · POST /api/ml/autorizar/codigo       {pegado} → canjea el código por tokens
   · GET  /api/ml/publicaciones          todas las publicaciones del vendedor
   · PUT  /api/ml/publicaciones/<MLA…>   {price?, available_quantity?}
   · GET  /api/ml/ventas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
                                         órdenes del período + lo que cobró ML
                                         por cada envío + impuestos de cada
                                         pago (Mercado Pago). Solo lectura.

   El refresh token de ML ROTA en cada uso: el viejo deja de valer. Por eso el
   nuevo se guarda siempre y las renovaciones van de a una (`renovando`): dos
   pedidos simultáneos que renovaran a la vez quemarían el token.
   ============================================================ */

// Tiene que estar cargada EXACTA en la app de ML. ML no acepta localhost: por
// eso el código se copia de la barra del navegador y se pega en la app.
const REDIRECT_POR_DEFECTO = "https://kukune.com.ar";
const API = "https://api.mercadolibre.com";
const AUTH = "https://auth.mercadolibre.com.ar/authorization";

const ITEM_VALIDO = /^MLA\d+$/;
const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;
const POR_PAGINA = 50;
const TOPE_PAGINAS = 20; // 1000 órdenes
const A_LA_VEZ = 5;
const API_MP = "https://api.mercadopago.com";
const TOPE_PROMOS = 200;
const TOPE_PAGINAS_PROMO = 40; // 2000 ítems por campaña
const TIPO_PROMO_VALIDO = /^[A-Z_]{3,40}$/;
const ATRIBUTOS =
  "id,title,price,original_price,available_quantity,status,permalink,thumbnail,listing_type_id,variations,catalog_listing,catalog_product_id,tags";

/* Lo que se pega puede ser la dirección entera (…?code=TG-…&state=…) o solo el
   código. Pura y exportada para probarla desde Node. */
export function extraerCodigo(pegado) {
  const texto = String(pegado ?? "").trim();
  const m = texto.match(/[?&]code=([^&\s#]+)/);
  if (m) return decodeURIComponent(m[1]);
  return /^TG-[\w-]+$/.test(texto) ? texto : null;
}

const base64Url = (buf) =>
  buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

/* ---------- Promociones (seller-promotions) ----------

   Lo delicado, y la razón de que esto sea una función aparte: una promo tiene
   DOS precios distintos.

   · `price` es lo que PAGA EL COMPRADOR, y es la base de la comisión de ML.
   · Lo que RECIBE el vendedor depende de quién financia el descuento:
     - las que paga el vendedor (PRICE_DISCOUNT, DEAL, SELLER_CAMPAIGN, DOD,
       LIGHTNING) -> recibe el mismo `price`: el descuento se lo come entero;
     - las co-fondeadas -> ML pone `meli_percentage` y el vendedor
       `seller_percentage`, así que recibe `original_price × (1 − vendedor/100)`,
       que es MÁS que lo que paga el comprador (doc: lista 1000, el comprador
       paga 700, ML aporta 5 y el vendedor 25 -> le quedan 750, no 700).
   · El boost (`boosted_offer`) lo absorbe ML: baja lo que paga el comprador y
     no toca lo del vendedor.

   Puras y exportadas para probarlas desde Node. */
export const CO_FONDEADAS = [
  "MARKETPLACE_CAMPAIGN",
  "SMART",
  "PRICE_MATCHING",
  "PRE_NEGOTIATED",
  "VOLUME",
  "UNHEALTHY_STOCK",
];

export const esCoFondeada = (tipo) => CO_FONDEADAS.includes(String(tipo || "").toUpperCase());

const positivo = (v) => (Number(v) > 0 ? Number(v) : null);

/* Una promo de la API a la forma que usa la app. `tipoPorDefecto` es para la
   consulta por campaña, donde el tipo es de la campaña y no viene en cada fila. */
export function resumirPromo(x, tipoPorDefecto = null) {
  if (!x) return null;
  const tipo = String(x.type || tipoPorDefecto || "").toUpperCase() || null;
  const estado = String(x.status?.id ?? x.status ?? "").toLowerCase() || null;
  const lista = positivo(x.original_price);
  /* Un ítem candidato viene con `price: 0`. Cero no es un precio: es "todavía no
     entró". Tomarlo como precio sería mostrar un 100% de descuento inventado. */
  const base = positivo(x.price);
  // El boost mueve lo que paga el comprador, no lo que recibe el vendedor.
  const paga = x.boosted_offer ? positivo(x.total_price_for_boosted_offer) ?? base : base;
  const vendedorPct = x.seller_percentage == null ? null : Number(x.seller_percentage);
  const coFondeada = esCoFondeada(tipo);
  /* Sin el porcentaje del vendedor no hay forma de saber cuánto pone ML, así que
     se supone lo peor —que el descuento lo paga todo el vendedor— y el número
     que se muestra queda del lado seguro. */
  const recibe = coFondeada && lista && vendedorPct != null ? lista * (1 - vendedorPct / 100) : paga;
  return {
    id: x.id ?? null,
    tipo,
    subTipo: x.sub_type ?? null,
    nombre: x.name || null,
    estado,
    activa: estado === "started",
    coFondeada,
    lista,
    paga,
    recibe,
    // Segundo precio, solo para compradores con Mercado Puntos nivel 3 a 6.
    topPaga: positivo(x.top_deal_price ?? x.top_price),
    meliPct: x.meli_percentage == null ? null : Number(x.meli_percentage),
    vendedorPct,
    poneML: paga != null && recibe != null ? Math.max(0, recibe - paga) : null,
    boost: !!x.boosted_offer,
    /* Sugerencias de ML para decidir el precio. Solo vienen en DEAL,
       PRICE_DISCOUNT y SELLER_CAMPAIGN, y NO para ofertas ya creadas. */
    minimo: positivo(x.min_discounted_price),
    maximo: positivo(x.max_discounted_price),
    sugerido: positivo(x.suggested_discounted_price),
    descuento: lista && paga ? 1 - paga / lista : null,
    ofertaId: x.offer_id ?? x.ref_id ?? null,
    desde: x.start_date ?? null,
    hasta: x.finish_date ?? x.end_date ?? null,
  };
}

/* Las invitaciones a campañas del vendedor (GET /seller-promotions/users/<id>).
   `deadline_date` es el plazo para aceptar, que es el dato que apura. */
export function resumirCampana(x) {
  if (!x) return null;
  const b = x.benefits ?? {};
  return {
    id: x.id ?? null,
    tipo: String(x.type || "").toUpperCase() || null,
    nombre: x.name || null,
    estado: String(x.status ?? "").toLowerCase() || null,
    coFondeada: esCoFondeada(x.type),
    desde: x.start_date ?? null,
    hasta: x.finish_date ?? null,
    limite: x.deadline_date ?? null,
    beneficio: b.type ?? null,
    meliPct: b.meli_percent == null ? null : Number(b.meli_percent),
    vendedorPct: b.seller_percent == null ? null : Number(b.seller_percent),
    // Descuento por cantidad (3x2 y similares): viene en los beneficios.
    llevaPaga:
      b.buy_quantity && b.pay_quantity
        ? { lleva: Number(b.buy_quantity), paga: Number(b.pay_quantity), nombre: b.name ?? null }
        : null,
  };
}

export function resumirCampanas(lista) {
  const crudas = Array.isArray(lista) ? lista : lista?.results ?? [];
  return crudas.map(resumirCampana).filter(Boolean);
}

/* ---------- Escribir promociones ----------

   Qué se puede y qué no, según la doc:
   · Entrar a una campaña (co-fondeada o tradicional): POST, y en la tradicional
     el precio lo pone el vendedor.
   · Modificar: SOLO las tradicionales (DEAL) tienen PUT. Las co-fondeadas hay
     que salir y volver a entrar —y si el precio subió, ML ya no te deja—, y los
     descuentos individuales se borran y se rehacen.
   · Crear un descuento propio: PRICE_DISCOUNT, con fechas.

   Las validaciones van ACÁ y no en la pantalla porque son las reglas de ML, no
   de la UI, y porque sus errores vienen crudos: es mejor no llegar a pedírselo.
   Pura y exportada para probarla desde Node. */
export const TIPOS_CON_PRECIO = ["DEAL", "PRICE_DISCOUNT", "SELLER_CAMPAIGN", "DOD", "LIGHTNING"];

const DIA_MS = 86400000;
const PLAZO_MAXIMO_DIAS = 14;

/* ML pide las fechas en "formato local": con hora y SIN zona. Mandando solo el
   día ("2026-11-17") contesta 400 "Start and finish dates must be in local
   format" — pasó con la cuenta real. La doc igual ignora la hora: el descuento
   corre de las 00:00:00 del día de inicio a las 23:59:59 del de fin, así que se
   completa con esas dos y no con la hora de ahora. */
const aFechaML = (valor, finDelDia = false) => {
  const texto = String(valor ?? "").trim();
  if (!texto) return texto;
  const soloDia = texto.slice(0, 10);
  return `${soloDia}T${finDelDia ? "23:59:59" : "00:00:00"}`;
};

const falla = (mensaje) => {
  throw new ErrorML(400, mensaje);
};

/* El cuerpo del pedido a ML, ya validado.
   -> { metodo, cuerpo } */
export function pedidoDePromo({
  accion,
  tipo,
  promocionId = null,
  precio = null,
  precioTop = null,
  desde = null,
  hasta = null,
  lista = null,
}) {
  const t = String(tipo || "").toUpperCase();
  if (!t) falla("Falta el tipo de promoción");
  const p = Number(precio) || 0;
  const top = precioTop == null || precioTop === "" ? null : Number(precioTop) || 0;
  const l = Number(lista) || 0;

  if (accion === "entrar" && !TIPOS_CON_PRECIO.includes(t)) {
    // Co-fondeadas: el precio lo define ML, solo se acepta la invitación.
    if (!promocionId) falla("Falta la campaña");
    return { metodo: "POST", cuerpo: { promotion_id: promocionId, promotion_type: t } };
  }

  if (!(p > 0)) falla("Falta el precio de la promoción");
  if (l > 0 && p >= l) falla("El precio de la promoción tiene que ser menor al precio publicado");

  /* El descuento tiene que estar entre 5% y 80%, y si hay precio para los
     mejores compradores (Mercado Puntos nivel 3 a 6) tiene que ser al menos 5%
     más bajo que el general — 10% si el descuento general pasa el 35%. */
  const descuento = l > 0 ? 1 - p / l : null;
  if (descuento != null && (descuento < 0.05 || descuento > 0.8))
    falla(`El descuento tiene que estar entre 5% y 80% (ese precio da ${(descuento * 100).toFixed(1)}%)`);
  if (top != null) {
    if (!(top > 0)) falla("El precio para los mejores compradores no es válido");
    if (top >= p) falla("El precio para los mejores compradores tiene que ser menor al general");
    const minimo = descuento != null && descuento > 0.35 ? 0.1 : 0.05;
    if (1 - top / p < minimo)
      falla(
        `El precio para los mejores compradores tiene que ser al menos ${minimo * 100}% más bajo que el general`
      );
  }

  const cuerpo = { promotion_type: t, deal_price: p };
  if (top != null) cuerpo.top_deal_price = top;

  if (accion === "descuento") {
    if (t !== "PRICE_DISCOUNT") falla("Un descuento propio es de tipo PRICE_DISCOUNT");
    if (!desde || !hasta) falla("Faltan las fechas del descuento");
    const d = new Date(desde);
    const h = new Date(hasta);
    if (Number.isNaN(d.getTime()) || Number.isNaN(h.getTime())) falla("Fechas inválidas");
    if (h < d) falla("La fecha de fin es anterior a la de inicio");
    if ((h - d) / DIA_MS > PLAZO_MAXIMO_DIAS)
      falla(`Un descuento propio dura ${PLAZO_MAXIMO_DIAS} días como máximo`);
    cuerpo.start_date = aFechaML(desde);
    cuerpo.finish_date = aFechaML(hasta, true);
    return { metodo: "POST", cuerpo };
  }

  if (!promocionId) falla("Falta la campaña");
  cuerpo.promotion_id = promocionId;
  if (accion === "modificar") {
    // Solo las tradicionales se modifican; el resto se borra y se rehace.
    if (t !== "DEAL") falla("Esta promoción no se puede modificar: hay que quitarla y volver a ponerla");
    return { metodo: "PUT", cuerpo };
  }
  if (accion !== "entrar") falla(`No sé hacer "${accion}"`);
  return { metodo: "POST", cuerpo };
}

/* Los errores de ML vienen en inglés y por código. Traducidos, porque son los
   que Franco va a leer cuando algo no entre. */
const ERRORES_DE_PROMO = {
  ERROR_CREDIBILITY_DISCOUNTED_PRICE:
    "Mercado Libre no considera creíble ese descuento: tiene que ser más grande.",
  error_credibility_price:
    "Mercado Libre no considera creíble ese descuento: tiene que ser más grande.",
  buyer_discount_not_in_range: "El descuento tiene que estar entre 5% y 80%.",
  best_buyer_discount_not_in_range:
    "El descuento para los mejores compradores tiene que estar entre 5% y 80%.",
  discount_below_5_percent_difference:
    "El precio para los mejores compradores tiene que ser al menos 5% más bajo que el general.",
  discount_below_10_percent_difference:
    "Con más de 35% de descuento, el precio para los mejores compradores tiene que ser al menos 10% más bajo.",
  "423_ENTITY_LOCKED": "La publicación está trabada unos segundos. Probá de nuevo.",
};

export function errorDePromoEnCastellano(datos, status) {
  const codigos = [
    ...(Array.isArray(datos?.cause) ? datos.cause.map((c) => c.error_code || c.code || c.message) : []),
    datos?.error,
    datos?.message,
  ].filter(Boolean);
  for (const c of codigos) {
    const traducido = ERRORES_DE_PROMO[c] ?? ERRORES_DE_PROMO[String(c).trim()];
    if (traducido) return traducido;
  }
  if (status === 423) return ERRORES_DE_PROMO["423_ENTITY_LOCKED"];
  if (status === 403) return "La app no tiene permiso para cambiar promociones.";
  const crudo = [datos?.message, ...(Array.isArray(datos?.cause) ? datos.cause.map((c) => c.error_message || c.message) : [])]
    .filter(Boolean)
    .join(" — ");
  return crudo || `Error ${status}`;
}

/* GET /seller-promotions/items/<MLA> devuelve una lista de promos del ítem. */
export function resumirPromos(lista, tipoPorDefecto = null) {
  const crudas = Array.isArray(lista) ? lista : lista?.results ?? [];
  return crudas.map((x) => resumirPromo(x, tipoPorDefecto)).filter(Boolean);
}

export default function pluginML() {
  let secret = "";
  let appId = "";
  let redirectUri = REDIRECT_POR_DEFECTO;
  let basePublicaciones = "";

  const montar = (server) => {
    const raiz = path.resolve(server.config.root, "datos", "ml");
    const archivoTokens = path.join(raiz, "tokens.json");

    const faltantes = () =>
      [!appId && "ML_CLIENT_ID", !secret && "ML_CLIENT_SECRET"].filter(Boolean);

    let verificador = null; // PKCE pendiente, solo en memoria
    let renovando = null;

    /* Tokens de otra app (se cambió ML_CLIENT_ID) se leen como "no conectado":
       usarlos daría errores raros de ML en vez de pedir que se conecte de nuevo. */
    const leerTokens = async () => {
      try {
        const t = JSON.parse(await readFile(archivoTokens, "utf8"));
        return t.app_id === appId ? t : null;
      } catch (e) {
        return null;
      }
    };

    const guardarTokens = async (r) => {
      const t = {
        access_token: r.access_token,
        refresh_token: r.refresh_token,
        user_id: r.user_id,
        // De qué app son: si se cambia de app, estos tokens no sirven más.
        app_id: appId,
        // Cinco minutos de margen para no usar uno que vence en el camino.
        expira: Date.now() + (Number(r.expires_in) - 300) * 1000,
      };
      await mkdir(raiz, { recursive: true });
      const tmp = archivoTokens.replace(/\.json$/, ".tmp.json");
      await writeFile(tmp, JSON.stringify(t, null, 2), "utf8");
      await rename(tmp, archivoTokens);
      return t;
    };

    const pedirToken = async (campos) => {
      const r = await fetch(`${API}/oauth/token`, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ client_id: appId, client_secret: secret, ...campos }),
      });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) throw new ErrorML(r.status, datos.message || datos.error || "ML rechazó el token");
      return guardarTokens(datos);
    };

    const tokenVigente = async () => {
      const t = await leerTokens();
      if (!t?.refresh_token) throw new ErrorML(401, "Mercado Libre no está conectado");
      if (Date.now() < t.expira) return t;
      renovando ??= pedirToken({ grant_type: "refresh_token", refresh_token: t.refresh_token }).finally(
        () => {
          renovando = null;
        }
      );
      return renovando;
    };

    /* Sin tirar error: -> { ok, status, datos }. Lo usa publicar, que necesita
       leer los avisos de ML (`cause`) también cuando la respuesta es un 400. */
    const mlCrudo = async (ruta, opciones = {}) => {
      const t = await tokenVigente();
      // Una URL entera va tal cual: es Mercado Pago (MP), que acepta el mismo token.
      const r = await fetch(ruta.startsWith("https://") ? ruta : `${API}${ruta}`, {
        ...opciones,
        headers: {
          Authorization: `Bearer ${t.access_token}`,
          // JSON solo si el cuerpo es texto: una foto va como FormData y el
          // fetch le pone su propio content-type multipart.
          ...(typeof opciones.body === "string" ? { "content-type": "application/json" } : {}),
          ...(opciones.headers || {}),
        },
      });
      const datos = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, datos };
    };

    const ml = async (ruta, opciones = {}) => {
      const { ok, status, datos } = await mlCrudo(ruta, opciones);
      if (!ok) {
        // ML a veces explica en `cause` (lista) y no en `message`.
        const causa = Array.isArray(datos.cause) ? datos.cause.map((c) => c.message).join(" · ") : "";
        throw new ErrorML(status, [datos.message, causa].filter(Boolean).join(" — ") || `Error ${status}`);
      }
      return datos;
    };

    /* Todas las publicaciones del vendedor, activas y pausadas. `scan` permite
       pasar del tope de 1000 de la búsqueda normal. */
    const publicaciones = async (userId) => {
      const ids = [];
      let scrollId = null;
      for (let vuelta = 0; vuelta < 100; vuelta++) {
        const q = new URLSearchParams({ search_type: "scan", limit: "100" });
        if (scrollId) q.set("scroll_id", scrollId);
        const r = await ml(`/users/${userId}/items/search?${q}`);
        if (!r.results?.length) break;
        ids.push(...r.results);
        scrollId = r.scroll_id;
        if (!scrollId) break;
      }
      const items = [];
      for (let i = 0; i < ids.length; i += 20) {
        const lote = ids.slice(i, i + 20).join(",");
        const r = await ml(`/items?ids=${lote}&attributes=${ATRIBUTOS}`);
        for (const x of r) if (x.code === 200) items.push(resumir(x.body));
      }
      return items;
    };

    /* Ventas del período, por fecha de cierre (cuando se acreditó el pago, que
       es también como ordena ML para el vendedor). Se traen todas las páginas
       hasta TOPE_PAGINAS; si quedan más, se avisa con `truncado`. */
    const ventas = async (userId, desde, hasta) => {
      const ordenes = [];
      let total = 0;
      for (let pagina = 0; pagina < TOPE_PAGINAS; pagina++) {
        const q = new URLSearchParams({
          seller: String(userId),
          "order.date_closed.from": `${desde}T00:00:00.000-03:00`,
          "order.date_closed.to": `${hasta}T23:59:59.000-03:00`,
          sort: "date_desc",
          offset: String(pagina * POR_PAGINA),
          limit: String(POR_PAGINA),
        });
        const r = await ml(`/orders/search?${q}`);
        total = r.paging?.total ?? 0;
        ordenes.push(...(r.results ?? []).map(resumirOrden));
        if (!r.results?.length || ordenes.length >= total) break;
      }

      /* Lo que ML le cobró al vendedor por cada envío: `senders[].cost` de
         /shipments/<id>/costs. Las órdenes de un mismo carrito comparten el
         envío, así que se pide una vez por envío. */
      // Solo los de órdenes que cuentan (ESTADOS_QUE_CUENTAN en gananciasML.js):
      // el envío de una cancelada no se usa.
      const cuentan = ordenes.filter((o) => o.estado === "paid" || o.estado === "partially_refunded");
      const envios = await deAPocos(
        [...new Set(cuentan.map((o) => o.envioId).filter(Boolean))],
        async (id) => {
          const c = await ml(`/shipments/${id}/costs`, { headers: { "x-format-new": "true" } });
          const yo = (c.senders ?? []).find((s) => String(s.user_id) === String(userId));
          return { costoVendedor: Number(yo?.cost) || 0, pagoComprador: Number(c.receiver?.cost) || 0 };
        }
      );

      /* Impuestos y retenciones (IIBB, etc.): no vienen en la orden, los descuenta
         Mercado Pago del cobro. Están en el pago, en `charges_details` con
         `type: "tax"` que paga el vendedor (`accounts.from: "collector"`).
         Mismo token que ML. */
      const pagos = await deAPocos(
        [...new Set(cuentan.flatMap((o) => o.pagos.filter((p) => p.estado === "approved").map((p) => p.id)))],
        async (id) => resumirPago(await ml(`${API_MP}/v1/payments/${id}`))
      );
      return { ordenes, envios, pagos, total, truncado: ordenes.length < total };
    };

    /* Las invitaciones a campañas. Solo lectura. */
    const campanas = async (userId) => {
      const r = await mlCrudo(`/seller-promotions/users/${userId}?app_version=v2`);
      if (r.status === 403) return { campanas: [], sinPermiso: true };
      if (!r.ok) throw new ErrorML(r.status, r.datos?.message || `Error ${r.status}`);
      return { campanas: resumirCampanas(r.datos), sinPermiso: false };
    };

    /* Los ítems de una campaña: los candidatos (que todavía no entraron) y los
       que ya participan. Pagina con `search_after`, de a 50 como máximo, y ese
       token VENCE A LOS 5 MINUTOS: se recorre de una pasada, sin pausas.
       El `id` de cada fila es el de la PUBLICACIÓN, no el de la promo. */
    const itemsDeCampana = async (promocionId, tipo) => {
      const items = [];
      let desde = null;
      for (let vuelta = 0; vuelta < TOPE_PAGINAS_PROMO; vuelta++) {
        const q = new URLSearchParams({ promotion_type: tipo, app_version: "v2", limit: "50" });
        if (desde) q.set("search_after", desde);
        const r = await mlCrudo(
          `/seller-promotions/promotions/${encodeURIComponent(promocionId)}/items?${q}`
        );
        if (r.status === 403) return { items: [], sinPermiso: true, truncado: false };
        if (!r.ok) throw new ErrorML(r.status, r.datos?.message || `Error ${r.status}`);
        const lote = r.datos?.results ?? [];
        items.push(
          ...lote.map((x) => ({ ...resumirPromo(x, tipo), id: promocionId, itemId: x.id ?? null }))
        );
        desde = r.datos?.search_after ?? r.datos?.searchAfter ?? null;
        if (!desde || !lote.length) return { items, sinPermiso: false, truncado: false };
      }
      return { items, sinPermiso: false, truncado: true };
    };

    /* Las promociones de cada publicación. Solo lectura, no escribe nada.
       Un 403 es el permiso de la app y no el ítem, así que se avisa aparte: la
       sección lo muestra y el resto de la pestaña sigue funcionando. */
    const promocionesDeItems = async (ids) => {
      let sinPermiso = false;
      const crudas = await deAPocos(ids, async (id) => {
        const r = await mlCrudo(`/seller-promotions/items/${id}?app_version=v2`);
        if (r.status === 403) {
          sinPermiso = true;
          throw new ErrorML(403, "La app no tiene permiso para ver promociones");
        }
        if (!r.ok) throw new ErrorML(r.status, r.datos?.message || `Error ${r.status}`);
        return resumirPromos(r.datos);
      });
      const promos = {};
      const errores = {};
      for (const [id, v] of Object.entries(crudas)) {
        if (Array.isArray(v)) promos[id] = v;
        else errores[id] = v.error;
      }
      return { promos, errores, sinPermiso };
    };

    /* De a A_LA_VEZ en paralelo: con un mes de ventas son decenas de pedidos. Si
       uno falla queda `{ error }` y la venta se muestra igual, sin ese dato. */
    const deAPocos = async (ids, traer) => {
      const salida = {};
      for (let i = 0; i < ids.length; i += A_LA_VEZ)
        await Promise.all(
          ids.slice(i, i + A_LA_VEZ).map(async (id) => {
            try {
              salida[id] = await traer(id);
            } catch (e) {
              salida[id] = { error: e.message };
            }
          })
        );
      return salida;
    };

    const cuerpo = async (req) => {
      const partes = [];
      for await (const parte of req) partes.push(parte);
      const texto = Buffer.concat(partes).toString("utf8");
      return texto ? JSON.parse(texto) : {};
    };

    const responder = (res, datos, codigo = 200) => {
      res.statusCode = codigo;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify(datos));
    };

    // Publicar perfumes (fotos de la carpeta Mercadolibre de cada uno): ml-publicar.js.
    const rutasDePublicar = crearPublicador({
      ml,
      mlCrudo,
      raizDatos: raiz,
      base: basePublicaciones || path.resolve(server.config.root, "..", "Mi Negocio", "branding", "publicaciones"),
    });

    server.middlewares.use("/api/ml", async (req, res) => {
      const ruta = (req.url || "/").split("?")[0].replace(/\/+$/, "") || "/";
      try {
        if (await rutasDePublicar(req, res, ruta, { cuerpo, responder })) return;

        if (req.method === "GET" && ruta === "/estado") {
          const falta = faltantes();
          if (falta.length) return responder(res, { conectado: false, falta });
          const t = await leerTokens();
          if (!t?.refresh_token) return responder(res, { conectado: false });
          const yo = await ml("/users/me");
          return responder(res, { conectado: true, nickname: yo.nickname, userId: yo.id });
        }

        if (req.method === "POST" && ruta === "/autorizar") {
          const falta = faltantes();
          if (falta.length) throw new ErrorML(400, `Falta ${falta.join(" y ")} en .env.local`);
          verificador = base64Url(randomBytes(32));
          const desafio = base64Url(createHash("sha256").update(verificador).digest());
          const q = new URLSearchParams({
            response_type: "code",
            client_id: appId,
            redirect_uri: redirectUri,
            code_challenge: desafio,
            code_challenge_method: "S256",
          });
          return responder(res, { url: `${AUTH}?${q}` });
        }

        if (req.method === "POST" && ruta === "/autorizar/codigo") {
          const { pegado } = await cuerpo(req);
          const code = extraerCodigo(pegado);
          if (!code) throw new ErrorML(400, "No encontré el código (empieza con TG-) en lo que pegaste");
          if (!verificador) throw new ErrorML(400, "Volvé a tocar Conectar: el pedido de autorización se perdió");
          await pedirToken({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            code_verifier: verificador,
          });
          verificador = null;
          const yo = await ml("/users/me");
          return responder(res, { conectado: true, nickname: yo.nickname, userId: yo.id });
        }

        if (req.method === "GET" && ruta === "/publicaciones") {
          const yo = await ml("/users/me");
          return responder(res, { publicaciones: await publicaciones(yo.id) });
        }

        if (req.method === "GET" && ruta === "/campanas") {
          const yo = await ml("/users/me");
          return responder(res, await campanas(yo.id));
        }

        const mCamp = ruta.match(/^\/campanas\/([^/]+)\/items$/);
        if (req.method === "GET" && mCamp) {
          const q = new URL(req.url, "http://x").searchParams;
          const tipo = (q.get("tipo") ?? "").toUpperCase();
          if (!TIPO_PROMO_VALIDO.test(tipo)) throw new ErrorML(400, "Tipo de campaña inválido");
          return responder(res, await itemsDeCampana(decodeURIComponent(mCamp[1]), tipo));
        }

        if (req.method === "GET" && ruta === "/promociones") {
          const q = new URL(req.url, "http://x").searchParams;
          const ids = [...new Set((q.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
          if (!ids.length) throw new ErrorML(400, "Faltan los ids de las publicaciones");
          const malo = ids.find((id) => !ITEM_VALIDO.test(id));
          if (malo) throw new ErrorML(400, `Id de publicación inválido: ${malo}`);
          if (ids.length > TOPE_PROMOS)
            throw new ErrorML(400, `Máximo ${TOPE_PROMOS} publicaciones por pedido`);
          return responder(res, await promocionesDeItems(ids));
        }

        if (req.method === "GET" && ruta === "/ventas") {
          const q = new URL(req.url, "http://x").searchParams;
          const desde = q.get("desde") ?? "";
          const hasta = q.get("hasta") ?? "";
          if (!FECHA_VALIDA.test(desde) || !FECHA_VALIDA.test(hasta))
            throw new ErrorML(400, "Fechas inválidas (AAAA-MM-DD)");
          if (desde > hasta) throw new ErrorML(400, "La fecha de inicio es posterior a la de fin");
          const yo = await ml("/users/me");
          return responder(res, { userId: yo.id, ...(await ventas(yo.id, desde, hasta)) });
        }

        const mPromo = ruta.match(/^\/promociones\/([^/]+)$/);
        if (mPromo && (req.method === "POST" || req.method === "DELETE")) {
          const id = mPromo[1];
          if (!ITEM_VALIDO.test(id)) throw new ErrorML(400, "Id de publicación inválido");

          if (req.method === "DELETE") {
            const q = new URL(req.url, "http://x").searchParams;
            const tipo = (q.get("tipo") ?? "").toUpperCase();
            if (!TIPO_PROMO_VALIDO.test(tipo)) throw new ErrorML(400, "Tipo de promoción inválido");
            const params = new URLSearchParams({ promotion_type: tipo, app_version: "v2" });
            if (q.get("promocion")) params.set("promotion_id", q.get("promocion"));
            if (q.get("oferta")) params.set("offer_id", q.get("oferta"));
            const r = await mlCrudo(`/seller-promotions/items/${id}?${params}`, { method: "DELETE" });
            if (!r.ok) throw new ErrorML(r.status, errorDePromoEnCastellano(r.datos, r.status));
            return responder(res, { ok: true });
          }

          const pedido = await cuerpo(req);
          const { metodo, cuerpo: body } = pedidoDePromo(pedido);
          const r = await mlCrudo(`/seller-promotions/items/${id}?app_version=v2`, {
            method: metodo,
            body: JSON.stringify(body),
          });
          if (!r.ok) throw new ErrorML(r.status, errorDePromoEnCastellano(r.datos, r.status));
          /* Se relee la publicación: con la promo puesta ML baja su `price` y la
             celda "En ML" tiene que comparar contra el de lista. */
          const promos = await mlCrudo(`/seller-promotions/items/${id}?app_version=v2`);
          return responder(res, {
            ok: true,
            mandado: body,
            resultado: r.datos,
            promos: promos.ok ? resumirPromos(promos.datos) : null,
          });
        }

        const m = ruta.match(/^\/publicaciones\/([^/]+)$/);
        if (req.method === "PUT" && m) {
          const id = m[1];
          if (!ITEM_VALIDO.test(id)) throw new ErrorML(400, "Id de publicación inválido");
          const pedido = await cuerpo(req);
          const cambios = {};
          if (pedido.price != null) {
            if (!(Number(pedido.price) > 0)) throw new ErrorML(400, "Precio inválido");
            cambios.price = Number(pedido.price);
          }
          if (pedido.available_quantity != null) {
            const n = Number(pedido.available_quantity);
            if (!Number.isInteger(n) || n < 0) throw new ErrorML(400, "Stock inválido");
            cambios.available_quantity = n;
          }
          if (!Object.keys(cambios).length) throw new ErrorML(400, "No hay nada que cambiar");
          // Con variaciones el precio y el stock van por variación: no se tocan
          // desde acá hasta que aparezca una y se trate a propósito.
          const actual = await ml(`/items/${id}?attributes=id,variations`);
          if (actual.variations?.length)
            throw new ErrorML(409, "Esta publicación tiene variaciones: cambiala desde Mercado Libre");
          const r = await ml(`/items/${id}`, { method: "PUT", body: JSON.stringify(cambios) });
          return responder(res, { publicacion: resumir(r) });
        }

        responder(res, { error: "No existe" }, 404);
      } catch (e) {
        responder(res, { error: e.message }, e.codigo || 500);
      }
    });
  };

  return {
    name: "kukune-ml",
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, ["ML_", "KUKUNE_"]);
      basePublicaciones = (env.KUKUNE_PUBLICACIONES || "").trim();
      secret = (env.ML_CLIENT_SECRET || "").trim();
      appId = (env.ML_CLIENT_ID || "").trim();
      redirectUri = (env.ML_REDIRECT_URI || "").trim() || REDIRECT_POR_DEFECTO;
    },
    configureServer: montar,
    configurePreviewServer: montar,
  };
}

class ErrorML extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

const resumir = (x) => ({
  id: x.id,
  titulo: x.title,
  precio: x.price,
  /* El precio de LISTA. Con una promo activa ML baja `price` y deja el de lista
     en `original_price`, así que comparar contra `price` haría figurar la
     publicación como "precio distinto" y mandar el de lista le pisaría la promo.
     Con `??` vale igual si ML no bajara `price`: ahí los dos son el mismo. */
  precioLista: x.original_price ?? x.price,
  stock: x.available_quantity,
  estado: x.status,
  link: x.permalink,
  miniatura: x.thumbnail,
  tipo: x.listing_type_id,
  variaciones: x.variations?.length ?? 0,
  // Una publicación de catálogo es otra publicación, con su MLA y su precio,
  // aunque tenga el mismo título que la "normal" del mismo perfume.
  catalogo: !!x.catalog_listing,
  // Las cuotas que ofrece viven en los tags (3x_campaign…): ver cuotasDePublicacion.
  tags: x.tags ?? [],
});

/* Lo que la pantalla de ventas necesita de una orden. `unit_price` ya viene con
   los descuentos aplicados; `sale_fee` es la comisión por unidad. La comisión de
   los pagos (`marketplace_fee`) va aparte para poder cruzarla. */
const resumirOrden = (o) => ({
  id: o.id,
  fecha: o.date_closed || o.date_created,
  estado: o.status,
  packId: o.pack_id ?? null,
  envioId: o.shipping?.id ?? null,
  pagos: (o.payments ?? []).map((p) => ({ id: p.id, estado: p.status })),
  comisionPagos: (o.payments ?? [])
    .filter((p) => p.status === "approved")
    .reduce((s, p) => s + (Number(p.marketplace_fee) || 0), 0),
  items: (o.order_items ?? []).map((x) => ({
    itemId: x.item?.id,
    titulo: x.item?.title,
    variacion: x.item?.variation_id ?? null,
    cantidad: Number(x.quantity) || 0,
    precioUnitario: Number(x.unit_price) || 0,
    comisionUnitaria: Number(x.sale_fee) || 0,
    tipo: x.listing_type_id,
  })),
});

/* Del pago de Mercado Pago, lo que el vendedor paga en impuestos y retenciones:
   `charges_details` con `type: "tax"` desde el vendedor (`collector`), menos
   lo devuelto. El nombre viene como "tax_withholding-santa_fe". El neto es para
   cruzar contra la cuenta de la app. */
const resumirPago = (p) => {
  const impuestos = (p.charges_details ?? [])
    .filter((c) => c.type === "tax" && c.accounts?.from === "collector")
    .map((c) => ({
      nombre: c.name,
      monto: (Number(c.amounts?.original) || 0) - (Number(c.amounts?.refunded) || 0),
    }))
    .filter((c) => c.monto !== 0);
  return { impuestos, neto: Number(p.transaction_details?.net_received_amount) || null };
};
