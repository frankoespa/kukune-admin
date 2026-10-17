import { readFile, readdir, stat, writeFile, rename, mkdir, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { CATEGORIA_PERFUMES, NOMBRES_TXT, cuerpoDeItem, faltantes } from "./src/armadoML.js";

/* ============================================================
   Publicar en Mercado Libre, del lado del server. Lo engancha
   vite-plugin-ml.js, que le pasa cómo hablar con ML.

   · GET  /api/ml/carpetas                 carpetas de perfume y sus fotos
   · GET  /api/ml/carpetas/<carpeta>/<arch> una foto o el texto (publicacion_ml.txt)
   · GET  /api/ml/ficha                    valores de las listas de MLA1271
   · POST /api/ml/publicar/validar         sube fotos y corre /items/validate
   · POST /api/ml/publicar                 crea las publicaciones (ESCRIBE EN ML)
   · GET  /api/ml/publicacion/<MLA>        fotos, ficha, nombre y descripción de una
   · POST /api/ml/actualizar               cambia fotos, ficha, nombre o descripción
                                           de publicaciones normales (ESCRIBE EN ML)
   · GET  /api/ml/publicaciones/estado?ids  relee varias, para ver si sincronizaron

   Las fotos y el texto salen SOLO de `<base>/<Perfume>/Mercadolibre/`: nada de
   Tiendanube, cada canal con lo suyo (pedido de Franco). Esa carpeta se lee,
   nunca se escribe. `<base>` es KUKUNE_PUBLICACIONES en .env.local o, si
   falta, `../Mi Negocio/branding/publicaciones` al lado del proyecto.
   ============================================================ */

const SUB = "Mercadolibre";
const FOTOS = /\.(jpe?g|png)$/i;
const TIPOS = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".txt": "text/plain; charset=utf-8" };
// Cuántas veces y cada cuánto se pregunta si ML ya asoció la publicación nueva
// a un producto de catálogo (lo hace solo, pero no siempre en el acto).
const VUELTAS_CATALOGO = 4;
const ESPERA_CATALOGO = 2500;

/* Un nombre de carpeta o archivo que viene del navegador: sin barras, sin `..`,
   sin empezar con punto. Lo que no pase esto no toca el disco. */
const ITEM = /^MLA\d+$/;

const nombreSeguro = (s) =>
  typeof s === "string" && s.length > 0 && s.length < 200 && !/[\\/]|\.\./.test(s) && !s.startsWith(".");

/* Ancho y alto de una JPG o PNG leyendo solo la cabecera. Pura y exportada para
   probarla desde Node. -> { ancho, alto } o null si no se reconoce. */
export function medidasDeImagen(buf) {
  if (!buf || buf.length < 24) return null;
  // PNG: firma de 8 bytes y el bloque IHDR con ancho y alto.
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return { ancho: buf.readUInt32BE(16), alto: buf.readUInt32BE(20) };
  // JPG: se recorren los segmentos hasta un SOF (C0–CF salvo C4, C8, CC).
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marca = buf[i + 1];
    if (marca >= 0xc0 && marca <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marca))
      return { alto: buf.readUInt16BE(i + 5), ancho: buf.readUInt16BE(i + 7) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

const cabecera = async (archivo) => {
  const fh = await open(archivo, "r");
  try {
    const buf = Buffer.alloc(128 * 1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
};

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* Los avisos de ML vienen en `cause`: `type` error (bloquea) o warning. */
const causas = (datos) => {
  const lista = Array.isArray(datos?.cause) ? datos.cause : [];
  const errores = lista.filter((c) => c.type !== "warning").map((c) => c.message || c.code);
  const advertencias = lista.filter((c) => c.type === "warning").map((c) => c.message || c.code);
  if (!lista.length && datos?.message) errores.push(datos.message);
  return { errores, advertencias };
};

export function crearPublicador({ ml, mlCrudo, raizDatos, base }) {
  const archivoFotos = path.join(raizDatos, "fotos-subidas.json");
  let fichaEnMemoria = null;

  const carpetaML = (carpeta) => {
    if (!nombreSeguro(carpeta)) throw Object.assign(new Error("Carpeta inválida"), { codigo: 400 });
    return path.join(base, carpeta, SUB);
  };

  const fotosDe = async (carpeta) => {
    const dir = carpetaML(carpeta);
    let nombres = [];
    try {
      nombres = await readdir(dir);
    } catch {
      return { existe: false, fotos: [], txt: null };
    }
    const fotos = [];
    for (const archivo of nombres
      .filter((n) => FOTOS.test(n))
      .sort((a, b) => a.localeCompare(b, "es", { numeric: true }))) {
      const ruta = path.join(dir, archivo);
      const [info, cab] = await Promise.all([stat(ruta), cabecera(ruta)]);
      fotos.push({ archivo, bytes: info.size, ...(medidasDeImagen(cab) ?? { ancho: null, alto: null }) });
    }
    // El texto: el primero de NOMBRES_TXT que exista (publicacion_ml.txt primero).
    // La carpeta puede llamarse MercadoLibre: en Windows es la misma.
    const txt = NOMBRES_TXT.find((n) => nombres.some((x) => x.toLowerCase() === n)) ?? null;
    return { existe: true, fotos, txt };
  };

  const carpetas = async () => {
    let entradas = [];
    try {
      entradas = await readdir(base, { withFileTypes: true });
    } catch {
      return { base, existe: false, carpetas: [] };
    }
    const lista = [];
    for (const e of entradas.filter((x) => x.isDirectory() && nombreSeguro(x.name)))
      lista.push({ nombre: e.name, ...(await fotosDe(e.name)) });
    lista.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return { base, existe: true, carpetas: lista };
  };

  /* ---- Fotos: se suben una vez. El id que da ML se recuerda por el sha1 del
     archivo, así validar y después publicar no sube dos veces lo mismo. ---- */
  const leerSubidas = async () => {
    try {
      return JSON.parse(await readFile(archivoFotos, "utf8"));
    } catch {
      return {};
    }
  };
  const guardarSubidas = async (mapa) => {
    await mkdir(raizDatos, { recursive: true });
    const tmp = archivoFotos.replace(/\.json$/, ".tmp.json");
    await writeFile(tmp, JSON.stringify(mapa, null, 2), "utf8");
    await rename(tmp, archivoFotos);
  };

  const subirFotos = async (carpeta, archivos) => {
    if (!Array.isArray(archivos) || !archivos.length)
      throw Object.assign(new Error("Elegí al menos una foto"), { codigo: 400 });
    const dir = carpetaML(carpeta);
    const subidas = await leerSubidas();
    const ids = [];
    for (const archivo of archivos) {
      if (!nombreSeguro(archivo) || !FOTOS.test(archivo))
        throw Object.assign(new Error(`Foto inválida: ${archivo}`), { codigo: 400 });
      const buf = await readFile(path.join(dir, archivo));
      const sha = createHash("sha1").update(buf).digest("hex");
      if (subidas[sha]?.id) {
        ids.push(subidas[sha].id);
        continue;
      }
      const forma = new FormData();
      forma.append("file", new Blob([buf], { type: TIPOS[path.extname(archivo).toLowerCase()] }), archivo);
      const r = await mlCrudo("/pictures/items/upload", { method: "POST", body: forma });
      if (!r.ok || !r.datos?.id)
        throw Object.assign(new Error(`ML no aceptó la foto ${archivo}: ${causas(r.datos).errores.join(" · ") || r.status}`), {
          codigo: 502,
        });
      subidas[sha] = { id: r.datos.id, archivo: `${carpeta}/${archivo}`, fecha: new Date().toISOString() };
      ids.push(r.datos.id);
    }
    await guardarSubidas(subidas);
    return ids;
  };

  /* Lo que manda el navegador, revisado antes de tocar ML. -> lo mismo, limpio. */
  const pedidoValido = (p) => {
    const error = (m) => Object.assign(new Error(m), { codigo: 400 });
    const falta = faltantes(p.ficha);
    if (falta.length) throw error(`Falta en la ficha: ${falta.join(", ")}`);
    const familyName = String(p.familyName ?? "").trim();
    if (!familyName || familyName.length > 120) throw error("El nombre de la publicación tiene que tener entre 1 y 120 letras");
    const planes = (p.planes ?? []).map((x) => ({ plan: Number(x.plan), precio: Number(x.precio) }));
    if (!planes.length) throw error("Elegí al menos un plan");
    if (planes.some((x) => ![1, 3, 6, 9, 12].includes(x.plan) || !(x.precio > 0)))
      throw error("Hay un plan sin precio o que no existe");
    const stock = Number(p.stock);
    if (!Number.isInteger(stock) || stock < 0) throw error("Stock inválido");
    return { ...p, familyName, planes, stock };
  };

  const cuerpoPara = (p, plan, fotos) =>
    cuerpoDeItem({
      ficha: p.ficha,
      plan: plan.plan,
      precio: plan.precio,
      stock: p.stock,
      familyName: p.familyName,
      fotos,
      condiciones: p.condiciones,
    });

  const validar = async (p) => {
    const fotos = await subirFotos(p.carpeta, p.fotos);
    const resultados = [];
    for (const plan of p.planes) {
      const r = await mlCrudo("/items/validate", { method: "POST", body: JSON.stringify(cuerpoPara(p, plan, fotos)) });
      resultados.push({ plan: plan.plan, ok: r.ok, ...causas(r.datos) });
    }
    return { fotos, resultados };
  };

  /* Crea las publicaciones. Vuelve a validar primero: si alguna no pasa, no se
     crea ninguna. Después va de a una; lo que se crea queda creado aunque falle
     la siguiente, y se informa renglón por renglón. Nada se reintenta solo. */
  const publicar = async (p) => {
    const { fotos, resultados: previa } = await validar(p);
    if (previa.some((r) => !r.ok)) return { validacion: previa, resultados: [] };

    const resultados = [];
    for (const plan of p.planes) {
      const fila = { plan: plan.plan, itemId: null, catalogoId: null, errores: [], advertencias: [], avisos: [] };
      resultados.push(fila);
      const r = await mlCrudo("/items", { method: "POST", body: JSON.stringify(cuerpoPara(p, plan, fotos)) });
      if (!r.ok || !r.datos?.id) {
        Object.assign(fila, causas(r.datos));
        continue;
      }
      fila.itemId = r.datos.id;
      fila.advertencias.push(...(r.datos.warnings ?? []).map((w) => w.message || w.code));

      if (String(p.descripcion ?? "").trim()) {
        const d = await mlCrudo(`/items/${fila.itemId}/description`, {
          method: "POST",
          body: JSON.stringify({ plain_text: String(p.descripcion).trim() }),
        });
        if (!d.ok) fila.avisos.push(`La descripción no se cargó: ${causas(d.datos).errores.join(" · ") || d.status}`);
      }

      /* La de catálogo: ML asocia la publicación a su producto de catálogo por
         su cuenta, a veces con unos segundos de demora. Sin producto no se puede. */
      let producto = null;
      for (let vuelta = 0; vuelta < VUELTAS_CATALOGO && !producto; vuelta++) {
        if (vuelta) await espera(ESPERA_CATALOGO);
        const it = await mlCrudo(`/items/${fila.itemId}?attributes=id,catalog_product_id`);
        producto = it.datos?.catalog_product_id ?? null;
      }
      if (!producto) {
        fila.avisos.push("ML todavía no la asoció a un producto de catálogo: la de catálogo se vincula a mano cuando aparezca.");
        continue;
      }
      const c = await mlCrudo("/items/catalog_listings", {
        method: "POST",
        body: JSON.stringify({ item_id: fila.itemId, catalog_product_id: producto }),
      });
      if (c.ok && c.datos?.id) fila.catalogoId = c.datos.id;
      else fila.avisos.push(`No se pudo crear la de catálogo: ${causas(c.datos).errores.join(" · ") || c.status}`);
    }

    return { resultados, sincronizacion: await sincronizacion(resultados) };
  };

  /* Cómo quedaron, releído de ML: el caso bueno es el del Musamam, todas en el
     mismo User Product y cada normal atada a su de catálogo. Solo informa. */
  const sincronizacion = async (resultados) => {
    const ids = resultados.flatMap((r) => [r.itemId, r.catalogoId]).filter(Boolean);
    const leidas = {};
    for (const id of ids) {
      const r = await mlCrudo(`/items/${id}?attributes=id,user_product_id,item_relations`);
      if (r.ok) leidas[id] = r.datos;
    }
    const productos = [...new Set(Object.values(leidas).map((x) => x.user_product_id).filter(Boolean))];
    const sueltas = resultados
      .filter((r) => r.itemId && r.catalogoId)
      .filter((r) => !(leidas[r.itemId]?.item_relations ?? []).some((x) => x.id === r.catalogoId))
      .map((r) => r.itemId);
    return { productos, mismoProducto: productos.length <= 1, sueltas };
  };

  const ficha = async () => {
    if (fichaEnMemoria) return fichaEnMemoria;
    const atributos = await ml(`/categories/${CATEGORIA_PERFUMES}/attributes`);
    fichaEnMemoria = Object.fromEntries(
      atributos.filter((a) => a.values?.length).map((a) => [a.id, a.values.map((v) => v.name)])
    );
    return fichaEnMemoria;
  };

  /* ---- Actualizar una publicación que ya existe ----
     Solo las normales: las de catálogo llevan las fotos y la ficha del producto
     de catálogo de ML, no las del vendedor. Fotos, atributos y nombre se
     sincronizan solos entre las del mismo User Product: el navegador manda una
     publicación por producto de usuario. */
  const resumirParaActualizar = (it) => ({
    id: it.id,
    familyName: it.family_name ?? it.title ?? "",
    vendidas: Number(it.sold_quantity) || 0,
    userProductId: it.user_product_id ?? null,
    catalogo: !!it.catalog_listing,
    fotos: (it.pictures ?? []).map((p) => ({ id: p.id, url: p.secure_url || p.url })),
    attributes: it.attributes ?? [],
  });

  const leerPublicacion = async (id) => {
    if (!ITEM.test(id)) throw Object.assign(new Error("Id de publicación inválido"), { codigo: 400 });
    const r = await mlCrudo(`/items/${id}`);
    if (!r.ok) throw Object.assign(new Error(causas(r.datos).errores.join(" · ") || `Error ${r.status}`), { codigo: r.status });
    const d = await mlCrudo(`/items/${id}/description`);
    return { ...resumirParaActualizar(r.datos), descripcion: d.ok ? d.datos?.plain_text ?? "" : "" };
  };

  const actualizar = async (p) => {
    const error = (m) => Object.assign(new Error(m), { codigo: 400 });
    const ids = [...new Set(p.itemIds ?? [])];
    if (!ids.length || ids.some((id) => !ITEM.test(id))) throw error("Faltan las publicaciones a actualizar");
    const atributos = Array.isArray(p.atributos) ? p.atributos : [];
    const familyName = p.familyName ? String(p.familyName).trim() : null;
    if (familyName && familyName.length > 120) throw error("El nombre puede tener hasta 120 letras");
    const descripcion = p.descripcion ? String(p.descripcion).trim() : null;
    const fotos = p.fotos?.length ? await subirFotos(p.carpeta, p.fotos) : null;
    if (!fotos && !atributos.length && !familyName && !descripcion) throw error("No hay nada que cambiar");

    const resultados = [];
    for (const id of ids) {
      const fila = { itemId: id, ok: true, errores: [], advertencias: [] };
      resultados.push(fila);
      const actual = await mlCrudo(`/items/${id}?attributes=id,catalog_listing`);
      if (actual.datos?.catalog_listing) {
        Object.assign(fila, { ok: false, errores: ["Es una publicación de catálogo: no se actualiza desde acá"] });
        continue;
      }
      const cuerpo = {
        ...(fotos ? { pictures: fotos.map((f) => ({ id: f })) } : {}),
        ...(atributos.length ? { attributes: atributos } : {}),
        ...(familyName ? { family_name: familyName } : {}),
      };
      if (Object.keys(cuerpo).length) {
        const r = await mlCrudo(`/items/${id}`, { method: "PUT", body: JSON.stringify(cuerpo) });
        if (!r.ok) {
          Object.assign(fila, { ok: false, ...causas(r.datos) });
          continue;
        }
      }
      if (descripcion) {
        const d = await mlCrudo(`/items/${id}/description`, { method: "PUT", body: JSON.stringify({ plain_text: descripcion }) });
        if (!d.ok) Object.assign(fila, { ok: false, errores: [`La descripción no se cambió: ${causas(d.datos).errores.join(" · ") || d.status}`] });
      }
    }
    return { fotos, resultados };
  };

  const estado = async (ids) => {
    const salida = [];
    for (const id of ids.filter((x) => ITEM.test(x))) {
      const r = await mlCrudo(`/items/${id}`);
      if (r.ok) salida.push(resumirParaActualizar(r.datos));
    }
    return salida;
  };

  /* -> true si la ruta era de publicar (y ya respondió). */
  return async function rutas(req, res, ruta, { cuerpo, responder }) {
    if (req.method === "GET" && ruta === "/carpetas") return responder(res, await carpetas()), true;

    const m = ruta.match(/^\/carpetas\/([^/]+)\/([^/]+)$/);
    if (req.method === "GET" && m) {
      const [carpeta, archivo] = [decodeURIComponent(m[1]), decodeURIComponent(m[2])];
      if (!nombreSeguro(archivo) || !(FOTOS.test(archivo) || NOMBRES_TXT.includes(archivo)))
        return responder(res, { error: "Archivo inválido" }, 400), true;
      const buf = await readFile(path.join(carpetaML(carpeta), archivo)).catch(() => null);
      if (!buf) return responder(res, { error: "No existe" }, 404), true;
      res.statusCode = 200;
      res.setHeader("Content-Type", TIPOS[path.extname(archivo).toLowerCase()]);
      res.setHeader("Cache-Control", "no-store");
      res.end(buf);
      return true;
    }

    if (req.method === "GET" && ruta === "/ficha") return responder(res, { listas: await ficha() }), true;

    const mp = ruta.match(/^\/publicacion\/([^/]+)$/);
    if (req.method === "GET" && mp) return responder(res, await leerPublicacion(mp[1])), true;
    if (req.method === "POST" && ruta === "/actualizar") return responder(res, await actualizar(await cuerpo(req))), true;
    if (req.method === "GET" && ruta === "/publicaciones/estado") {
      const ids = (new URL(req.url, "http://x").searchParams.get("ids") ?? "").split(",").filter(Boolean).slice(0, 20);
      return responder(res, { publicaciones: await estado(ids) }), true;
    }
    if (req.method === "POST" && ruta === "/publicar/validar")
      return responder(res, await validar(pedidoValido(await cuerpo(req)))), true;
    if (req.method === "POST" && ruta === "/publicar")
      return responder(res, await publicar(pedidoValido(await cuerpo(req)))), true;
    return false;
  };
}
