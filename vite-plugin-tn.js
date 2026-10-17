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

   Doc oficial: tiendanube.github.io/api-documentation. Versión 2025-03,
   `Authorization: Bearer`, `User-Agent` obligatorio (sin él da 400) y tope de
   2 pedidos por segundo: todo va de a uno.
   ============================================================ */

const API = "https://api.tiendanube.com/2025-03";
const AUTORIZAR = "https://www.tiendanube.com/apps";
const AGENTE = "KUKUNE (https://kukune.com.ar)";
const POR_PAGINA = 200;

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
});

export default function pluginTN() {
  let appId = "";
  let secret = "";

  const montar = (server) => {
    const raiz = path.resolve(server.config.root, "datos", "tn");
    const archivoToken = path.join(raiz, "tokens.json");
    const faltantes = () => [!appId && "TN_CLIENT_ID", !secret && "TN_CLIENT_SECRET"].filter(Boolean);
    let estadoPendiente = null; // `state` del pedido de autorización, solo en memoria
    let ubicaciones = null; // GET /locations, se pregunta una vez

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
        const q = new URLSearchParams({ per_page: String(POR_PAGINA), page: String(pagina), fields: "id,name,published,images,variants" });
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

    /* Si la tienda usa ubicaciones (Multiple Locations), el stock se cambia por
       `inventory_levels`; con una sola, sin `location_id`. Con varias no se toca
       desde acá: habría que elegir en cuál. */
    const leerUbicaciones = async () => {
      if (ubicaciones) return ubicaciones;
      try {
        const r = await tn("/locations");
        ubicaciones = Array.isArray(r) ? r : [];
      } catch {
        ubicaciones = [];
      }
      return ubicaciones;
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
          if (pedido.stock != null) {
            const n = Number(pedido.stock);
            if (!Number.isInteger(n) || n < 0) throw new ErrorTN(400, "Stock inválido");
            const ubic = await leerUbicaciones();
            if (ubic.length > 1)
              throw new ErrorTN(409, "La tienda tiene varias ubicaciones: cambiá ese stock desde Tiendanube");
            if (ubic.length === 1) cambios.inventory_levels = [{ stock: n }];
            else cambios.stock = n;
          }
          if (!Object.keys(cambios).length) throw new ErrorTN(400, "No hay nada que cambiar");
          const r = await tn(`/products/${producto}/variants/${variante}`, { method: "PUT", body: JSON.stringify(cambios) });
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
