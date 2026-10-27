import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { loadEnv } from "vite";

/* ============================================================
   Tiendanube, del lado del server. Mismo molde que vite-plugin-ml.js.

   El client secret y el token viven SOLO acá: el navegador habla con
   /api/tn/* y nunca ve ninguno de los dos.

   · App    → `.env.local` (ignorado por git): TN_CLIENT_ID y TN_CLIENT_SECRET
              (obligatorios). La app se crea en el portal de Partners de
              Tiendanube con el permiso `write_products` y la redirección a
              https://kukune.com.ar (Franco pega la dirección con ?code=…).
   · Token  → datos/tn/tokens.json (como todo `datos/`, fuera de git). El token
              de Tiendanube NO vence (doc "Authentication"): no hay renovación.

   Endpoints:
   · GET  /api/tn/estado                    ¿hay app? ¿hay token? ¿qué tienda?
   · POST /api/tn/autorizar                 la URL para autorizar la app
   · POST /api/tn/autorizar/codigo          {pegado} → canjea el código (dura 5 min)
   · GET  /api/tn/productos                 todos los productos con sus variantes
   · PUT  /api/tn/variantes/<prod>/<var>    {price?, promotional_price?, stock?} (ESCRIBE)
   · GET  /api/tn/cupones                   los cupones de la tienda (permiso de cupones)
   · POST /api/tn/cupones                   crea un cupón (ESCRIBE)
   · PUT  /api/tn/cupones/<id>              cambia un cupón, solo lo que cambió (ESCRIBE)

   Doc oficial: https://tiendanube.dev (la de antes era
   tiendanube.github.io/api-documentation). Versión 2025-03,
   `Authorization: Bearer`, `User-Agent` obligatorio (sin él da 400) y tope de
   2 pedidos por segundo: todo va de a uno.
   ============================================================ */

const API = "https://api.tiendanube.com/2025-03";
const AUTORIZAR = "https://www.tiendanube.com/apps";
// El portal de socios pide el correo de contacto como User-Agent.
const AGENTE = "KUKUNE (frankoespa@gmail.com)";
const POR_PAGINA = 200;
const POR_PAGINA_CUPONES = 100;

/* Lo que se pega puede ser la dirección entera (…?code=…&state=…) o el código
   solo. Pura y exportada para probarla desde Node. -> { code, state } o null. */
export function extraerCodigoTN(pegado) {
  const texto = String(pegado ?? "").trim();
  const code = texto.match(/[?&]code=([^&\s#]+)/);
  if (code) {
    const state = texto.match(/[?&]state=([^&\s#]+)/);
    return { code: decodeURIComponent(code[1]), state: state ? decodeURIComponent(state[1]) : null };
  }
  return /^[\w-]{10,}$/.test(texto) ? { code: texto, state: null } : null;
}

/* El nombre de un producto viene por idioma ({"es": "…"}). */
const nombreDe = (n) => (typeof n === "string" ? n : n?.es ?? Object.values(n ?? {})[0] ?? "");

const numero = (v) => (v == null || v === "" ? null : Number(v));

/* Lo que la pantalla necesita de una variante. `promocional` es lo que paga el
   cliente cuando hay promoción; si no, paga `precio`. */
export const resumirVariante = (v) => ({
  id: v.id,
  precio: numero(v.price),
  promocional: numero(v.promotional_price),
  stock: v.stock_management === false ? null : numero(v.stock), // null = infinito
  sku: v.sku ?? "",
  valores: (v.values ?? []).map(nombreDe).filter(Boolean).join(" · "),
});

export const resumirProducto = (p) => ({
  id: p.id,
  nombre: nombreDe(p.name),
  publicado: !!p.published,
  imagen: p.images?.[0]?.src ?? null,
  variantes: (p.variants ?? []).map(resumirVariante),
  // Para saber a qué productos les aplica un cupón restringido por categoría.
  categorias: (p.categories ?? []).map((c) => (typeof c === "object" ? c.id : c)),
});

/* Lo que se le manda a Tiendanube para crear o cambiar un cupón, revisado antes
   (doc "Coupons" 2025-03). Con `actual` (editar) devuelve solo lo que cambió.
   Pura y exportada para probarla desde Node. Tira Error con el motivo. */
export function pedidoDeCupon(entrada, actual = null) {
  const e = entrada ?? {};
  const salida = {};
  // Tiendanube devuelve "10000.00" y fechas con hora: se comparan normalizados.
  const normal = (v) => {
    if (v == null || v === "") return null;
    if (typeof v === "boolean") return v;
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return s !== "" && !Number.isNaN(Number(s)) ? Number(s) : s;
  };
  const poner = (campo, valor) => {
    if (!actual || normal(actual[campo]) !== normal(valor)) salida[campo] = valor;
  };
  const code = String(e.code ?? "").trim();
  if (!/^[A-Za-z0-9]+$/.test(code)) throw new Error("El código solo puede tener letras y números, sin espacios");
  poner("code", code);
  if (!["percentage", "absolute", "shipping"].includes(e.type)) throw new Error("Tipo de cupón inválido");
  poner("type", e.type);
  if (e.type !== "shipping") {
    const valor = Number(e.value);
    if (!(valor > 0)) throw new Error("El valor tiene que ser mayor a cero");
    if (e.type === "percentage" && valor > 100) throw new Error("Un porcentaje no puede pasar de 100");
    poner("value", String(valor));
  }
  const minimo = e.min_price == null || e.min_price === "" ? null : Number(e.min_price);
  if (minimo != null && !(minimo >= 0)) throw new Error("El mínimo tiene que ser cero o más");
  poner("min_price", minimo);
  for (const campo of ["start_date", "end_date"]) {
    const f = e[campo] ? String(e[campo]) : null;
    if (f && Number.isNaN(new Date(f).getTime())) throw new Error(`Fecha inválida: ${f}`);
    poner(campo, f);
  }
  const usos = e.max_uses == null || e.max_uses === "" ? null : Number(e.max_uses);
  if (usos != null && !(Number.isInteger(usos) && usos > 0)) throw new Error("La cantidad de usos tiene que ser un número entero");
  poner("max_uses", usos);
  for (const campo of ["first_consumer_purchase", "combines_with_other_discounts", "valid"])
    if (e[campo] != null) poner(campo, !!e[campo]);
  const productos = (e.products ?? []).map(Number).filter((n) => n > 0);
  const categorias = (e.categories ?? []).map(Number).filter((n) => n > 0);
  if (productos.length && categorias.length) throw new Error("Un cupón va por productos o por categorías, no las dos cosas");
  // Productos y categorías: al crear, solo si hay; al editar, solo si cambiaron.
  const ids = (lista) => (lista ?? []).map((x) => Number(typeof x === "object" ? x.id : x)).sort((a, b) => a - b).join();
  if (actual ? ids(actual.products) !== ids(productos) : productos.length) salida.products = productos;
  if (actual ? ids(actual.categories) !== ids(categorias) : categorias.length) salida.categories = categorias;
  return salida;
}

export default function pluginTN() {
  let appId = "";
  let secret = "";

  const montar = (server) => {
    const raiz = path.resolve(server.config.root, "datos", "tn");
    const archivoToken = path.join(raiz, "tokens.json");
    const faltantes = () => [!appId && "TN_CLIENT_ID", !secret && "TN_CLIENT_SECRET"].filter(Boolean);
    let estadoPendiente = null; // `state` del pedido de autorización, solo en memoria

    /* Un token de otra app (se cambió TN_CLIENT_ID) se lee como "no conectado". */
    const leerToken = async () => {
      try {
        const t = JSON.parse(await readFile(archivoToken, "utf8"));
        return t.app_id === appId ? t : null;
      } catch {
        return null;
      }
    };

    const guardarToken = async (r) => {
      const t = { access_token: r.access_token, store_id: r.user_id ?? r.store_id, app_id: appId, scope: r.scope };
      await mkdir(raiz, { recursive: true });
      const tmp = archivoToken.replace(/\.json$/, ".tmp.json");
      await writeFile(tmp, JSON.stringify(t, null, 2), "utf8");
      await rename(tmp, archivoToken);
      return t;
    };

    const tn = async (ruta, opciones = {}) => {
      const t = await leerToken();
      if (!t?.access_token) throw new ErrorTN(401, "Tiendanube no está conectado");
      const r = await fetch(`${API}/${t.store_id}${ruta}`, {
        ...opciones,
        headers: {
          Authorization: `Bearer ${t.access_token}`,
          "User-Agent": AGENTE,
          ...(typeof opciones.body === "string" ? { "content-type": "application/json" } : {}),
        },
      });
      const datos = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detalle = typeof datos.description === "string" ? datos.description : datos.description ? JSON.stringify(datos.description) : "";
        throw new ErrorTN(r.status, [datos.message, detalle].filter(Boolean).join(" — ") || `Error ${r.status}`);
      }
      return datos;
    };

    /* Todos los productos, de a 200 por página hasta que venga una página corta. */
    const productos = async () => {
      const lista = [];
      for (let pagina = 1; pagina <= 50; pagina++) {
        const q = new URLSearchParams({ per_page: String(POR_PAGINA), page: String(pagina), fields: "id,name,published,images,variants,categories" });
        let r;
        try {
          r = await tn(`/products?${q}`);
        } catch (e) {
          // Pasada la última página, Tiendanube responde 404 "Last page is …".
          if (e.codigo === 404 && pagina > 1) break;
          throw e;
        }
        lista.push(...r.map(resumirProducto));
        if (r.length < POR_PAGINA) break;
      }
      return lista;
    };

    /* Los cupones, todas las páginas. Sin el permiso de cupones Tiendanube
       responde 403/401: se avisa qué hacer en vez del error crudo. */
    const sinPermiso = (e) =>
      e.codigo === 403 || e.codigo === 401
        ? new ErrorTN(403, "Falta el permiso de cupones: agregá \"Coupons\" en Datos básicos de la app (portal de socios) y tocá \"Volver a conectar\": el permiso nuevo recién vale al autorizar la app otra vez")
        : e;
    const cupones = async () => {
      const lista = [];
      for (let pagina = 1; pagina <= 20; pagina++) {
        let r;
        try {
          r = await tn(`/coupons?per_page=${POR_PAGINA_CUPONES}&page=${pagina}`);
        } catch (e) {
          if (e.codigo === 404 && pagina > 1) break;
          throw sinPermiso(e);
        }
        lista.push(...r);
        if (r.length < POR_PAGINA_CUPONES) break;
      }
      return lista;
    };

    /* El stock va por POST /products/<p>/variants/stock (doc "Product Variant",
       tiendanube.dev): `replace` con el `id` de la variante escribe en la
       ubicación por defecto, haya o no Múltiples Ubicaciones. Si la variante
       tiene stock en más de una ubicación (`inventory_levels`, solo presente con
       Múltiples Ubicaciones) no se toca: habría que elegir en cuál. Se mira en la
       variante y no en GET /locations, que pediría el permiso `read_locations`. */
    const cambiarStock = async (producto, variante, n) => {
      const actual = await tn(`/products/${producto}/variants/${variante}`);
      if ((actual.inventory_levels?.length ?? 0) > 1)
        throw new ErrorTN(409, "Ese producto tiene stock en varias ubicaciones: cambialo desde Tiendanube");
      const r = await tn(`/products/${producto}/variants/stock`, {
        method: "POST",
        body: JSON.stringify({ action: "replace", value: n, id: Number(variante) }),
      });
      return (Array.isArray(r) ? r : []).find((v) => String(v.id) === String(variante)) ?? actual;
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

    server.middlewares.use("/api/tn", async (req, res) => {
      const ruta = (req.url || "/").split("?")[0].replace(/\/+$/, "") || "/";
      try {
        if (req.method === "GET" && ruta === "/estado") {
          const falta = faltantes();
          if (falta.length) return responder(res, { conectado: false, falta });
          const t = await leerToken();
          if (!t?.access_token) return responder(res, { conectado: false });
          const tienda = await tn("/store?fields=id,name");
          return responder(res, { conectado: true, tienda: nombreDe(tienda.name), storeId: t.store_id });
        }

        if (req.method === "POST" && ruta === "/autorizar") {
          const falta = faltantes();
          if (falta.length) throw new ErrorTN(400, `Falta ${falta.join(" y ")} en .env.local`);
          estadoPendiente = randomBytes(12).toString("hex");
          return responder(res, { url: `${AUTORIZAR}/${appId}/authorize?state=${estadoPendiente}` });
        }

        if (req.method === "POST" && ruta === "/autorizar/codigo") {
          const { pegado } = await cuerpo(req);
          const leido = extraerCodigoTN(pegado);
          if (!leido) throw new ErrorTN(400, "No encontré el código en lo que pegaste");
          if (leido.state && estadoPendiente && leido.state !== estadoPendiente)
            throw new ErrorTN(400, "Ese código es de otro pedido de autorización: volvé a tocar Conectar");
          const r = await fetch(`${AUTORIZAR}/authorize/token`, {
            method: "POST",
            headers: { "content-type": "application/json", "User-Agent": AGENTE },
            body: JSON.stringify({ client_id: appId, client_secret: secret, grant_type: "authorization_code", code: leido.code }),
          });
          const datos = await r.json().catch(() => ({}));
          if (!r.ok || !datos.access_token)
            throw new ErrorTN(r.status || 400, datos.error_description || datos.error || "Tiendanube rechazó el código (dura 5 minutos)");
          await guardarToken(datos);
          estadoPendiente = null;
          const tienda = await tn("/store?fields=id,name");
          return responder(res, { conectado: true, tienda: nombreDe(tienda.name) });
        }

        if (req.method === "GET" && ruta === "/productos") return responder(res, { productos: await productos() });

        // Cupones: leer, crear y editar. No se borran desde acá.
        if (req.method === "GET" && ruta === "/cupones") return responder(res, { cupones: await cupones() });
        if (req.method === "POST" && ruta === "/cupones") {
          let cuerpoTN;
          try {
            cuerpoTN = pedidoDeCupon(await cuerpo(req));
          } catch (e) {
            throw new ErrorTN(400, e.message);
          }
          try {
            return responder(res, { cupon: await tn("/coupons", { method: "POST", body: JSON.stringify(cuerpoTN) }) }, 201);
          } catch (e) {
            throw sinPermiso(e);
          }
        }
        const mc = ruta.match(/^\/cupones\/(\d+)$/);
        if (req.method === "PUT" && mc) {
          const pedido = await cuerpo(req);
          let actual;
          try {
            actual = await tn(`/coupons/${mc[1]}`);
          } catch (e) {
            throw sinPermiso(e);
          }
          let cambios;
          try {
            cambios = pedidoDeCupon(pedido, actual);
          } catch (e) {
            throw new ErrorTN(400, e.message);
          }
          if (!Object.keys(cambios).length) throw new ErrorTN(400, "No hay nada que cambiar");
          try {
            return responder(res, { cupon: await tn(`/coupons/${mc[1]}`, { method: "PUT", body: JSON.stringify(cambios) }) });
          } catch (e) {
            throw sinPermiso(e);
          }
        }

        const m = ruta.match(/^\/variantes\/(\d+)\/(\d+)$/);
        if (req.method === "PUT" && m) {
          const [, producto, variante] = m;
          const pedido = await cuerpo(req);
          const cambios = {};
          if (pedido.price != null) {
            if (!(Number(pedido.price) > 0)) throw new ErrorTN(400, "Precio inválido");
            cambios.price = Number(pedido.price);
          }
          if ("promotional_price" in pedido) {
            const promo = pedido.promotional_price;
            if (promo !== null && !(Number(promo) > 0)) throw new ErrorTN(400, "Precio promocional inválido");
            if (promo !== null && cambios.price && !(Number(promo) < cambios.price))
              throw new ErrorTN(400, "El promocional tiene que ser menor que el precio normal");
            cambios.promotional_price = promo === null ? null : Number(promo);
          }
          let stock = null;
          if (pedido.stock != null) {
            stock = Number(pedido.stock);
            if (!Number.isInteger(stock) || stock < 0) throw new ErrorTN(400, "Stock inválido");
          }
          if (!Object.keys(cambios).length && stock == null) throw new ErrorTN(400, "No hay nada que cambiar");
          let r = null;
          if (Object.keys(cambios).length) {
            const ruta = `/products/${producto}/variants/${variante}`;
            r = await tn(ruta, { method: "PUT", body: JSON.stringify(cambios) });
            /* Sacar la promoción: Tiendanube acepta `promotional_price: null` sin
               error pero puede dejar el promocional viejo, y con el precio normal
               bajado al mismo valor la tienda muestra "0% OFF" (le pasó a Franco).
               La doc no dice cómo se borra, así que se mira la respuesta: si
               quedó, se reintenta con texto vacío, y si sigue, se avisa en vez
               de dar por bueno algo que no lo es. */
            if (cambios.promotional_price === null && numero(r?.promotional_price) != null) {
              r = await tn(ruta, { method: "PUT", body: JSON.stringify({ promotional_price: "" }) });
              if (numero(r?.promotional_price) != null)
                throw new ErrorTN(
                  502,
                  `Tiendanube no sacó el precio promocional (quedó en $${numero(r.promotional_price)}). Sacalo a mano en el panel de Tiendanube.`
                );
            }
          }
          if (stock != null) r = await cambiarStock(producto, variante, stock);
          return responder(res, { variante: resumirVariante(r) });
        }

        responder(res, { error: "No existe" }, 404);
      } catch (e) {
        responder(res, { error: e.message }, e.codigo || 500);
      }
    });
  };

  return {
    name: "kukune-tn",
    configResolved(config) {
      const env = loadEnv(config.mode, config.root, "TN_");
      appId = (env.TN_CLIENT_ID || "").trim();
      secret = (env.TN_CLIENT_SECRET || "").trim();
    },
    configureServer: montar,
    configurePreviewServer: montar,
  };
}

class ErrorTN extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}
