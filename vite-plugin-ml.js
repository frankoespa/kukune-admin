import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import { loadEnv } from "vite";

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
const ATRIBUTOS =
  "id,title,price,available_quantity,status,permalink,thumbnail,listing_type_id,variations,catalog_listing,catalog_product_id,tags";

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

export default function pluginML() {
  let secret = "";
  let appId = "";
  let redirectUri = REDIRECT_POR_DEFECTO;

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

    const ml = async (ruta, opciones = {}) => {
      const t = await tokenVigente();
      // Una URL entera va tal cual: es Mercado Pago (MP), que acepta el mismo token.
      const r = await fetch(ruta.startsWith("https://") ? ruta : `${API}${ruta}`, {
        ...opciones,
        headers: {
          Authorization: `Bearer ${t.access_token}`,
          ...(opciones.body ? { "content-type": "application/json" } : {}),
          ...(opciones.headers || {}),
        },
      });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) {
        // ML a veces explica en `cause` (lista) y no en `message`.
        const causa = Array.isArray(datos.cause) ? datos.cause.map((c) => c.message).join(" · ") : "";
        throw new ErrorML(r.status, [datos.message, causa].filter(Boolean).join(" — ") || `Error ${r.status}`);
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

    server.middlewares.use("/api/ml", async (req, res) => {
      const ruta = (req.url || "/").split("?")[0].replace(/\/+$/, "") || "/";
      try {
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
      const env = loadEnv(config.mode, config.root, "ML_");
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
