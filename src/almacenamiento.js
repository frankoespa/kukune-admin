/* ============================================================
   Dónde viven los datos.

   Un archivo por pedido en `datos/pedidos/<id>.json` y el catálogo en
   `datos/perfumes.json`, todo servido por el dev server (ver
   vite-plugin-datos.js). No hay caché en localStorage: ahí solo queda cuál
   pedido estabas mirando. Sin servidor la app no funciona — las fotos también
   salen de él — así que una caché no serviría de nada.
   ============================================================ */

const URL_PEDIDOS = "/api/pedidos";

/* -> { estado: "ok", pedidos } | { estado: "sin-servidor" } */
export async function listarPedidos() {
  try {
    const r = await fetch(URL_PEDIDOS);
    if (!r.ok) return { estado: "sin-servidor", pedidos: [] };
    const d = await r.json();
    return { estado: "ok", pedidos: Array.isArray(d.pedidos) ? d.pedidos : [] };
  } catch (e) {
    // No hay endpoint: el build servido como estático, o el server caído.
    return { estado: "sin-servidor", pedidos: [] };
  }
}

export async function leerPedido(id) {
  try {
    const r = await fetch(`${URL_PEDIDOS}/${id}`);
    if (r.status === 404) return { estado: "no-existe" };
    if (!r.ok) return { estado: "sin-servidor" };
    return { estado: "ok", datos: await r.json() };
  } catch (e) {
    return { estado: "sin-servidor" };
  }
}

/* Devuelve { bytes, id, ruta }. Tira si el guardado falló — quien llama avisa. */
export async function escribirPedido(id, estado) {
  const r = await fetch(`${URL_PEDIDOS}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(estado),
  });
  if (!r.ok) {
    let detalle = `HTTP ${r.status}`;
    try {
      detalle = (await r.json()).error ?? detalle;
    } catch (e) {
      /* la respuesta de error no era JSON */
    }
    throw new Error(detalle);
  }
  return r.json();
}

export async function crearPedido({ nombre, globals, productos }) {
  const r = await fetch(URL_PEDIDOS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre, globals, productos }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* No borra: manda el archivo a datos/papelera/. */
export async function borrarPedido(id) {
  const r = await fetch(`${URL_PEDIDOS}/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* Para el guardado pendiente al cerrar la pestaña: sendBeacon solo hace POST. */
export function urlDePedido(id) {
  return `${URL_PEDIDOS}/${id}`;
}

/* En qué pedidos está usado cada perfume, según los archivos.
   Lo pide el catálogo para avisar antes de borrar. Solo lectura. */
export async function leerUsos() {
  try {
    const r = await fetch("/api/usos");
    if (!r.ok) return { estado: "sin-servidor", usos: {} };
    const d = await r.json();
    return { estado: "ok", usos: d.usos ?? {} };
  } catch (e) {
    return { estado: "sin-servidor", usos: {} };
  }
}

/* ---------- Catálogo de perfumes ----------
   El nombre y la foto de cada perfume viven una sola vez acá; las filas de los
   pedidos apuntan por id. Las fotos son archivos servidos desde /datos/fotos/,
   no base64: el JSON del catálogo pesa unos pocos KB. */

const URL_PERFUMES = "/api/perfumes";
const URL_FOTOS = "/api/fotos";

export const urlFoto = (archivo) => (archivo ? `/datos/fotos/${archivo}` : null);

/* Ajustes del catálogo: lo que cada canal se lleva. Van acá y no en cada pedido
   porque el precio de lista no depende de a quién le compraste.

   Son valores de arranque para un archivo que todavía no tiene la clave: lo
   guardado siempre manda (ver el merge en `leerPerfumes`). `cuotasML` es la
   comisión EXTRA de cada plan, en fracción, y `envioLocal` el envío en Rosario
   que se le suma al precio cuando hay entrega. */
export const AJUSTES_POR_DEFECTO = {
  comisionML: 0.1532,
  envioML: 7470,
  envioLocal: 0,
  cuotasML: { 3: 0, 6: 0, 9: 0, 12: 0 },
};

export async function leerPerfumes() {
  try {
    const r = await fetch(URL_PERFUMES);
    if (!r.ok) return { estado: "sin-servidor", perfumes: [], ajustes: AJUSTES_POR_DEFECTO };
    const datos = await r.json();
    return {
      estado: "ok",
      perfumes: Array.isArray(datos.perfumes) ? datos.perfumes : [],
      // El merge es shallow, así que `cuotasML` se mezcla aparte: si no, un
      // archivo con un solo plan cargado se lleva puestos los otros tres.
      ajustes: {
        ...AJUSTES_POR_DEFECTO,
        ...(datos.ajustes || {}),
        cuotasML: { ...AJUSTES_POR_DEFECTO.cuotasML, ...(datos.ajustes?.cuotasML || {}) },
      },
    };
  } catch (e) {
    return { estado: "sin-servidor", perfumes: [], ajustes: AJUSTES_POR_DEFECTO };
  }
}

export async function escribirPerfumes(perfumes, ajustes) {
  const r = await fetch(URL_PERFUMES, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ perfumes, ajustes }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* Sube la foto y devuelve el nombre del archivo con que quedó guardada.
   El servidor la nombra por el hash de su contenido, así que subir dos veces
   la misma imagen no duplica nada. */
export async function subirFoto(dataUrl) {
  const r = await fetch(URL_FOTOS, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).archivo;
}

/* El PDF necesita los bytes de la foto, no una URL. */
export async function fotoComoDataUrl(archivo) {
  if (!archivo) return null;
  try {
    const blob = await (await fetch(urlFoto(archivo))).blob();
    return await new Promise((resolver) => {
      const lector = new FileReader();
      lector.onload = () => resolver(lector.result);
      lector.onerror = () => resolver(null);
      lector.readAsDataURL(blob);
    });
  } catch (e) {
    return null;
  }
}
