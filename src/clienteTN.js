import { descuentoVisto, precioTachadoTN } from "./precios.js";

/* ============================================================
   Cliente de /api/tn (ver vite-plugin-tn.js) y las cuentas puras de la
   conexión con Tiendanube. Se llama clienteTN y no tiendanube.js: en Windows
   chocaría con TiendaNube.jsx (ver clienteML.js).

   El vínculo vive en el perfume: `publicacionTN = { productId, variantId }`.
   Lo pone Franco eligiendo, nunca se adivina.

   Precio promocional: el precio de la app (`precioTN`) es lo que paga el
   cliente. Con promoción va en `promotional_price` y el normal (`price`) se
   infla para mostrarse tachado; sin promoción va en `price` y el promocional
   se saca. Se decide al mandar, no se guarda en el catálogo.
   ============================================================ */

const URL_TN = "/api/tn";

const pedir = async (ruta, opciones = {}) => {
  const r = await fetch(`${URL_TN}${ruta}`, {
    ...opciones,
    headers: opciones.body ? { "Content-Type": "application/json" } : undefined,
  });
  let datos = {};
  try {
    datos = await r.json();
  } catch {
    /* sin cuerpo JSON: el server de la app no está (build estático) */
  }
  if (!r.ok) throw new Error(datos.error || `HTTP ${r.status}`);
  return datos;
};

/* -> { conectado, tienda?, falta? } */
export const estadoTN = () => pedir("/estado");
export const pedirAutorizacionTN = () => pedir("/autorizar", { method: "POST" });
export const enviarCodigoTN = (pegado) => pedir("/autorizar/codigo", { method: "POST", body: JSON.stringify({ pegado }) });

/* -> [{ id, nombre, publicado, imagen, variantes: [{ id, precio, promocional, stock, sku, valores }] }] */
export const leerProductosTN = async () => (await pedir("/productos")).productos;

/* ESCRIBE EN TIENDANUBE. Solo después de una confirmación. */
export const actualizarVarianteTN = (productId, variantId, cambios) =>
  pedir(`/variantes/${productId}/${variantId}`, { method: "PUT", body: JSON.stringify(cambios) });

export const vinculoTN = (perfume) => perfume?.publicacionTN ?? null;

/* Lo que paga hoy el cliente: el promocional si hay, si no el normal. */
export const pagaHoy = (variante) => variante?.promocional ?? variante?.precio ?? null;

/* Qué mandar para un precio de la app, con o sin promoción.
   -> { price, promotional_price } o null si no se puede (sin precio, o el
   tachado no sale). */
export function envioParaTN(precioApp, { conPromo, descuento, redondeo }) {
  const precio = Number(precioApp) || 0;
  if (!(precio > 0)) return null;
  if (!conPromo) return { price: precio, promotional_price: null };
  const tachado = precioTachadoTN(precio, descuento, redondeo);
  return tachado && tachado > precio ? { price: tachado, promotional_price: precio } : null;
}

/* El estado de cada perfume vinculado contra lo publicado.

   Recibe la lista RESUELTA (`perfumesResueltos`): ahí los clavados ya tienen su
   precio calculado. -> { renglones, perdidos }
   · renglones: uno por perfume vinculado con precio en la app, con lo que hay
     publicado (`actual`), si hoy tiene promoción y con qué %, y si lo que paga el
     cliente ya es el precio de la app (`coincide`).
   · perdidos: vinculados a un producto o variante que Tiendanube ya no devuelve.
   Un perfume sin precio en la app no se manda. */
export function cambiosParaTN(perfumes, productos) {
  const porId = new Map((productos ?? []).map((p) => [String(p.id), p]));
  const renglones = [];
  const perdidos = [];
  for (const p of perfumes ?? []) {
    const v = vinculoTN(p);
    if (!v) continue;
    const producto = porId.get(String(v.productId));
    const variante = producto?.variantes.find((x) => String(x.id) === String(v.variantId));
    if (!variante) {
      perdidos.push({ perfumeId: p.id, nombre: p.nombre, ...v });
      continue;
    }
    const precioApp = Number(p.precioTN) || 0;
    if (!(precioApp > 0)) continue;
    const conPromoHoy = variante.promocional != null && variante.promocional < (variante.precio ?? 0);
    renglones.push({
      perfumeId: p.id,
      nombre: p.nombre,
      productId: v.productId,
      variantId: v.variantId,
      titulo: producto.nombre + (variante.valores ? ` · ${variante.valores}` : ""),
      precioApp,
      actual: { precio: variante.precio, promocional: variante.promocional },
      conPromoHoy,
      descuentoHoy: conPromoHoy ? descuentoVisto(variante.promocional, variante.precio) : null,
      coincide: pagaHoy(variante) === precioApp,
    });
  }
  return { renglones, perdidos };
}
