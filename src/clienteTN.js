import { descuentoVisto, ofertaDeTN, precioTachadoTN } from "./precios.js";

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

   Oferta REAL (`perfume.ofertaTN`, ésa sí se guarda): el normal es el precio de
   la app y el promocional, el de oferta (`ofertaDeTN`). Excluye a la promoción
   inflada. Además, si está elegida la categoría de ofertas
   (`ajustesTN.categoriaOfertas`), el producto entra o sale de ella: es lo que
   arma la sección Ofertas de la web.
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

/* Las categorías de la tienda, solo lectura: [{ id, nombre }]. */
export const leerCategoriasTN = async () => (await pedir("/categorias")).categorias;

/* ESCRIBE EN TIENDANUBE: mete o saca un producto de una categoría sin tocar
   las demás (`{ agregar: id }` o `{ quitar: id }`). Solo tras confirmar. */
export const moverCategoriaTN = (productId, cambio) =>
  pedir(`/productos/${productId}/categorias`, { method: "PUT", body: JSON.stringify(cambio) });

/* Cupones (API "Coupons"): leer no escribe nada; crear y editar ESCRIBEN EN
   TIENDANUBE, solo después de una confirmación. */
export const leerCuponesTN = async () => (await pedir("/cupones")).cupones;
export const crearCuponTN = (cupon) => pedir("/cupones", { method: "POST", body: JSON.stringify(cupon) });
export const editarCuponTN = (id, cupon) => pedir(`/cupones/${id}`, { method: "PUT", body: JSON.stringify(cupon) });

export const vinculoTN = (perfume) => perfume?.publicacionTN ?? null;

/* Lo que paga hoy el cliente: el promocional si hay, si no el normal. */
export const pagaHoy = (variante) => variante?.promocional ?? variante?.precio ?? null;

/* Qué mandar para un precio de la app, con o sin promoción.
   -> { price, promotional_price } o null si no se puede (sin precio, o el
   tachado no sale). */
export function envioParaTN(precioApp, { conPromo, descuento, redondeo, oferta }) {
  const precio = Number(precioApp) || 0;
  if (!(precio > 0)) return null;
  // Oferta real: el tachado es el precio de la app y el cliente paga menos.
  if (oferta != null) return oferta > 0 && oferta < precio ? { price: precio, promotional_price: oferta } : null;
  if (!conPromo) return { price: precio, promotional_price: null };
  const tachado = precioTachadoTN(precio, descuento, redondeo);
  return tachado && tachado > precio ? { price: tachado, promotional_price: precio } : null;
}

/* El estado de cada perfume vinculado contra lo publicado.

   Recibe la lista RESUELTA (`perfumesResueltos`): ahí los clavados ya tienen su
   precio calculado. -> { renglones, perdidos }
   · renglones: uno por perfume vinculado con precio en la app, con lo que hay
     publicado (`actual`), si hoy tiene promoción y de qué tipo, la oferta de la
     app si hay, y si ya está todo como en la app (`coincide`).
   · perdidos: vinculados a un producto o variante que Tiendanube ya no devuelve.
   Un perfume sin precio en la app no se manda.

   Qué promoción tiene hoy: la INFLADA deja el normal por encima del precio de la
   app (el tachado de mentira); la OFERTA real lo deja en el precio de la app o
   debajo. Si el producto está en la categoría de ofertas, se lee como oferta
   aunque el precio de la app haya cambiado desde que se mandó. */
export function cambiosParaTN(perfumes, productos, ajustesTN = {}) {
  const porId = new Map((productos ?? []).map((p) => [String(p.id), p]));
  const categoria = ajustesTN.categoriaOfertas != null ? String(ajustesTN.categoriaOfertas) : null;
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
    // Un promocional igual o mayor al precio normal se ve "0% OFF" en la tienda:
    // no coincide aunque el cliente pague lo de la app, y se manda sin promoción.
    const promoRota = variante.promocional != null && !conPromoHoy;
    const enCategoriaHoy = categoria != null && (producto.categorias ?? []).map(String).includes(categoria);
    const ofertaHoy = conPromoHoy && (enCategoriaHoy || (variante.precio ?? 0) <= precioApp);
    const oferta = ofertaDeTN(p, ajustesTN);
    const preciosIguales =
      oferta != null
        ? variante.precio === precioApp && variante.promocional === oferta
        : pagaHoy(variante) === precioApp && !promoRota;
    // La categoría solo se mueve si está elegida: sin ella, la sección no se toca.
    const categoriaCambia = categoria != null && enCategoriaHoy !== (oferta != null) ? (oferta != null ? "agregar" : "quitar") : null;
    renglones.push({
      perfumeId: p.id,
      nombre: p.nombre,
      productId: v.productId,
      variantId: v.variantId,
      titulo: producto.nombre + (variante.valores ? ` · ${variante.valores}` : ""),
      precioApp,
      actual: { precio: variante.precio, promocional: variante.promocional },
      conPromoHoy,
      // La inflada (la de vidriera): la única que el panel ofrece conservar.
      infladaHoy: conPromoHoy && !ofertaHoy,
      ofertaHoy,
      descuentoHoy: conPromoHoy ? descuentoVisto(variante.promocional, variante.precio) : null,
      promoRota,
      oferta,
      descuentoOferta: oferta != null ? Number(p.ofertaTN.descuento) : null,
      categoriaCambia,
      coincide: preciosIguales && !categoriaCambia,
    });
  }
  return { renglones, perdidos };
}
