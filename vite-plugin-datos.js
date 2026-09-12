import { readFile, writeFile, rename, mkdir, copyFile, stat, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

/* ============================================================
   Guardado en archivo, servido por el propio dev server.

   · Pedidos  → datos/pedidos/<id>.json      (/api/pedidos, /api/pedidos/<id>)
   · Borrados → datos/papelera/<id>.json     (no se borra nada de verdad)
   · Catálogo → datos/perfumes.json          (/api/perfumes)
                datos/fotos/<hash>.jpg       (/datos/fotos/…)

   Un archivo por pedido, y no uno solo con todos adentro: cada pedido tiene su
   propio historial de versiones en OneDrive y se puede recuperar sin pisar los
   demás. Además solo se reescribe el que se está tocando.

   Las fotos son archivos sueltos, no base64 adentro del JSON. El nombre del
   archivo es el hash de su contenido, así que la misma foto no se duplica.

   Toda escritura es atómica: primero a un .tmp y después `rename`, que es una
   operación única del sistema de archivos. Nunca queda un JSON a medio escribir.
   ============================================================ */

const DIR = "datos";
const PEDIDOS = "pedidos";
const PAPELERA = "papelera";
const LEGADO = "analisis-pedido";
const CATALOGO = "perfumes";
const FOTOS = "fotos";

const TIPOS = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const ID_VALIDO = /^[a-f0-9-]{36}$/i;

export default function pluginDatos() {
  const montar = (server) => {
    const raiz = path.resolve(server.config.root, DIR);
    const dirPedidos = path.join(raiz, PEDIDOS);
    const dirPapelera = path.join(raiz, PAPELERA);
    const dirFotos = path.join(raiz, FOTOS);
    const archivoPedido = (id) => path.join(dirPedidos, `${id}.json`);

    /* --- utilidades --- */
    const escribirAtomico = async (destino, texto) => {
      await mkdir(path.dirname(destino), { recursive: true });
      try {
        await copyFile(destino, destino.replace(/\.json$/, ".bak.json"));
      } catch (e) {
        /* la primera vez no hay nada que respaldar */
      }
      const tmp = destino.replace(/\.json$/, ".tmp.json");
      await writeFile(tmp, texto, "utf8");
      await rename(tmp, destino);
      return (await stat(destino)).size;
    };

    const cuerpo = async (req) => {
      const partes = [];
      for await (const parte of req) partes.push(parte);
      return Buffer.concat(partes).toString("utf8");
    };

    const guardarFoto = async (dataUrl) => {
      const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
      const archivo = createHash("sha1").update(bytes).digest("hex").slice(0, 16) + ".jpg";
      await mkdir(dirFotos, { recursive: true });
      try {
        await stat(path.join(dirFotos, archivo)); // misma foto, mismo archivo
      } catch (e) {
        await writeFile(path.join(dirFotos, archivo), bytes);
      }
      return archivo;
    };

    const json = (res) => res.setHeader("Content-Type", "application/json; charset=utf-8");
    const responder = (res, datos, codigo = 200) => {
      res.statusCode = codigo;
      json(res);
      res.end(JSON.stringify(datos));
    };

    /* --- Migraciones, todas una sola vez y sin borrar nada --- */
    const normalizar = (s) =>
      String(s || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .trim()
        .toLowerCase();

    // 1) del pedido con las fotos adentro al catálogo aparte
    const migrarCatalogo = async () => {
      try {
        await stat(path.join(raiz, `${CATALOGO}.json`));
        return;
      } catch (e) {
        /* sigue */
      }
      let pedido;
      try {
        pedido = JSON.parse(await readFile(path.join(raiz, `${LEGADO}.json`), "utf8"));
      } catch (e) {
        return;
      }
      if (!Array.isArray(pedido.productos)) return;
      await copyFile(
        path.join(raiz, `${LEGADO}.json`),
        path.join(raiz, `${LEGADO}.pre-catalogo.json`)
      );
      const porNombre = new Map();
      const perfumes = [];
      const productos = [];
      for (const p of pedido.productos) {
        const clave = normalizar(p.producto);
        let entrada = clave ? porNombre.get(clave) : null;
        if (!entrada) {
          entrada = {
            id: randomUUID(),
            nombre: (p.producto || "").trim(),
            foto: p.foto ? await guardarFoto(p.foto) : null,
          };
          perfumes.push(entrada);
          if (clave) porNombre.set(clave, entrada);
        } else if (!entrada.foto && p.foto) {
          entrada.foto = await guardarFoto(p.foto);
        }
        const { foto, ...resto } = p;
        productos.push({ ...resto, perfumeId: entrada.id, producto: entrada.nombre });
      }
      await escribirAtomico(path.join(raiz, `${CATALOGO}.json`), JSON.stringify({ perfumes }));
      await escribirAtomico(
        path.join(raiz, `${LEGADO}.json`),
        JSON.stringify({ ...pedido, productos })
      );
    };

    // 2) del pedido único a la carpeta de pedidos
    const migrarPedidos = async () => {
      try {
        await stat(dirPedidos);
        return;
      } catch (e) {
        /* sigue */
      }
      await mkdir(dirPedidos, { recursive: true });
      let viejo;
      try {
        viejo = JSON.parse(await readFile(path.join(raiz, `${LEGADO}.json`), "utf8"));
      } catch (e) {
        return; // no había nada: la app creará el primero
      }
      if (!Array.isArray(viejo.productos)) return;
      const id = randomUUID();
      // El archivo viejo queda donde está, entero. Esto es una copia.
      await escribirAtomico(
        archivoPedido(id),
        JSON.stringify({
          id,
          nombre: "Pedido 1",
          actualizado: new Date().toISOString(),
          globals: viejo.globals,
          productos: viejo.productos,
        })
      );
    };

    const migrar = async () => {
      await migrarCatalogo();
      await migrarPedidos();
    };

    const listar = async () => {
      await mkdir(dirPedidos, { recursive: true });
      const archivos = (await readdir(dirPedidos)).filter(
        (a) => a.endsWith(".json") && !a.endsWith(".bak.json") && !a.endsWith(".tmp.json")
      );
      const pedidos = [];
      for (const a of archivos) {
        try {
          const d = JSON.parse(await readFile(path.join(dirPedidos, a), "utf8"));
          pedidos.push({
            id: d.id,
            nombre: d.nombre || "Sin nombre",
            actualizado: d.actualizado || null,
            filas: Array.isArray(d.productos) ? d.productos.length : 0,
          });
        } catch (e) {
          /* un archivo ilegible no debe voltear la lista entera */
        }
      }
      return pedidos.sort((a, b) => String(b.actualizado).localeCompare(String(a.actualizado)));
    };

    /* --- Pedidos --- */
    server.middlewares.use("/api/pedidos", async (req, res) => {
      try {
        await migrar();
        const ruta = (req.url || "/").split("?")[0].replace(/^\//, "");
        const id = ruta || null;
        if (id && !ID_VALIDO.test(id)) return responder(res, { error: "Id inválido" }, 400);

        if (req.method === "GET" && !id) return responder(res, { pedidos: await listar() });

        if (req.method === "GET" && id) {
          try {
            json(res);
            res.end(await readFile(archivoPedido(id), "utf8"));
          } catch (e) {
            responder(res, { error: "No existe ese pedido" }, 404);
          }
          return;
        }

        if (req.method === "POST" && !id) {
          const datos = JSON.parse(await cuerpo(req));
          const nuevo = {
            id: randomUUID(),
            nombre: String(datos.nombre || "Pedido nuevo").trim(),
            actualizado: new Date().toISOString(),
            globals: datos.globals || {},
            productos: Array.isArray(datos.productos) ? datos.productos : [],
          };
          await escribirAtomico(archivoPedido(nuevo.id), JSON.stringify(nuevo));
          return responder(res, nuevo);
        }

        if ((req.method === "PUT" || req.method === "POST") && id) {
          const datos = JSON.parse(await cuerpo(req));
          if (!Array.isArray(datos.productos))
            return responder(res, { error: "El cuerpo no tiene una lista de productos." }, 400);
          const guardado = { ...datos, id, actualizado: new Date().toISOString() };
          const bytes = await escribirAtomico(archivoPedido(id), JSON.stringify(guardado));
          return responder(res, { ok: true, bytes, id, ruta: `${DIR}/${PEDIDOS}/${id}.json` });
        }

        if (req.method === "DELETE" && id) {
          // A la papelera, no al vacío.
          await mkdir(dirPapelera, { recursive: true });
          const sello = new Date().toISOString().replace(/[:.]/g, "-");
          await rename(archivoPedido(id), path.join(dirPapelera, `${sello}__${id}.json`));
          return responder(res, { ok: true, papelera: `${DIR}/${PAPELERA}` });
        }

        responder(res, { error: "Método no permitido" }, 405);
      } catch (e) {
        responder(res, { error: String(e?.message ?? e) }, 500);
      }
    });

    /* --- Catálogo --- */
    server.middlewares.use("/api/perfumes", async (req, res) => {
      try {
        await migrar();
        if (req.method === "GET") {
          try {
            json(res);
            res.end(await readFile(path.join(raiz, `${CATALOGO}.json`), "utf8"));
          } catch (e) {
            responder(res, { perfumes: [] });
          }
          return;
        }
        if (req.method === "PUT") {
          const texto = await cuerpo(req);
          if (!Array.isArray(JSON.parse(texto).perfumes))
            return responder(res, { error: "El cuerpo no tiene una lista de perfumes." }, 400);
          const bytes = await escribirAtomico(path.join(raiz, `${CATALOGO}.json`), texto);
          return responder(res, { ok: true, bytes });
        }
        responder(res, { error: "Método no permitido" }, 405);
      } catch (e) {
        responder(res, { error: String(e?.message ?? e) }, 500);
      }
    });

    /* --- Subir una foto: recibe el data URL, devuelve el archivo --- */
    server.middlewares.use("/api/fotos", async (req, res) => {
      try {
        if (req.method !== "POST" && req.method !== "PUT")
          return responder(res, { error: "Método no permitido" }, 405);
        const { dataUrl } = JSON.parse(await cuerpo(req));
        if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/"))
          return responder(res, { error: "Se esperaba un data URL de imagen." }, 400);
        responder(res, { archivo: await guardarFoto(dataUrl) });
      } catch (e) {
        responder(res, { error: String(e?.message ?? e) }, 500);
      }
    });

    /* --- Servir las fotos. El nombre es un hash: se valida contra eso, así no
           hay forma de pedir `..` ni salirse de datos/fotos. --- */
    server.middlewares.use(`/${DIR}/${FOTOS}`, async (req, res) => {
      const nombre = decodeURIComponent((req.url || "").split("?")[0].replace(/^\//, ""));
      if (!/^[a-f0-9]{6,64}\.(jpg|jpeg|png|webp)$/i.test(nombre)) {
        res.statusCode = 400;
        res.end();
        return;
      }
      try {
        const bytes = await readFile(path.join(dirFotos, nombre));
        res.setHeader("Content-Type", TIPOS[path.extname(nombre).toLowerCase()] || "image/jpeg");
        // El nombre ES el hash del contenido: si cambia la foto, cambia la URL.
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        res.end(bytes);
      } catch (e) {
        res.statusCode = 404;
        res.end();
      }
    });
  };

  return {
    name: "kukune-datos",
    // El watcher no debe mirar `datos/`: si no, cada guardado automático se ve
    // como un cambio de archivo y Vite recarga la página mientras se escribe.
    config: () => ({ server: { watch: { ignored: [`**/${DIR}/**`] } } }),
    configureServer: montar,
    configurePreviewServer: montar,
  };
}
