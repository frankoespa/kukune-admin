import { costoEnFecha } from "./historialCostos.js";

/* ============================================================
   Ventas de Mercado Libre: qué se vendió y cuánto dejó.

   Recibe lo que devuelve GET /api/ml/ventas (órdenes resumidas, el costo de
   cada envío para el vendedor y los impuestos de cada pago) y la lista
   RESUELTA del catálogo. Cruza cada
   ítem vendido con su perfume por `publicacionesML` (plan → MLA): el vínculo
   que eligió Franco, nunca un emparejado por nombre.

   Por ítem vendido:
   · ingreso  = unit_price × cantidad  (unit_price ya viene con descuentos)
   · comisión = sale_fee × cantidad    (sale_fee es por unidad)
   · envío    = lo que ML le cobró al vendedor por ese envío. Un carrito
                comparte un envío entre varias órdenes: se reparte entre sus
                ítems en proporción al ingreso, y la suma cierra exacta.
   · impuestos = retenciones e impuestos que Mercado Pago descontó del cobro
                (IIBB y demás), de los pagos aprobados de la orden. Se reparten
                entre los ítems de la orden igual que el envío.
   · costo    = el costo del catálogo que regía cuando se vendió
                (`historialCostos`), × cantidad.
   · ganancia = ingreso − comisión − envío − impuestos − costo; margen = ganancia ÷ costo,
                la misma cuenta que la columna Margen de los pedidos.

   Lo que no tiene vínculo no inventa costo: va en `sinVincular`, sin ganancia.
   Pura y sin React: se prueba desde Node.
   ============================================================ */

export const ESTADOS_QUE_CUENTAN = new Set(["paid", "partially_refunded"]);
const ESTADOS_CANCELADOS = new Set(["cancelled", "invalid"]);

// Más que esto de diferencia entre Σ sale_fee×cantidad y la comisión de los
// pagos y la orden se marca: el supuesto "sale_fee es por unidad" no cerró.
const TOLERANCIA_COMISION = 1;

const redondear = (n) => Math.round(n * 100) / 100;

/* Mercado Pago nombra los impuestos como "tax_withholding-santa_fe". Las
   retenciones con nombre de provincia son de Ingresos Brutos (IIBB). Lo que no
   se reconoce se muestra legible tal cual: mejor eso que adivinar. */
const PROVINCIAS = new Set(
  "buenos_aires caba capital_federal catamarca chaco chubut cordoba corrientes entre_rios formosa jujuy la_pampa la_rioja mendoza misiones neuquen rio_negro salta san_juan san_luis santa_cruz santa_fe santiago_del_estero tierra_del_fuego tucuman".split(" ")
);
const SIGLAS = { iva: "IVA", iibb: "IIBB" };
const legible = (s) => SIGLAS[s] ?? s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export function nombreDeImpuesto(nombre) {
  const [tipo, resto] = String(nombre ?? "").split("-");
  if (tipo === "tax_withholding" && resto)
    return PROVINCIAS.has(resto) ? `Retención IIBB ${legible(resto)}` : `Retención ${legible(resto)}`;
  return legible(String(nombre ?? "Impuesto"));
}

/* MLA → { perfume, plan, catalogo }. Entran las dos de cada plan: la normal
   (`publicacionesML`) y la de catálogo (`publicacionesCatalogoML`). Si dos
   perfumes apuntan a la misma publicación (no debería: el buscador lo marca),
   gana el primero. */
export function indiceDePublicaciones(perfumes) {
  const m = new Map();
  for (const p of perfumes ?? [])
    for (const [campo, catalogo] of [
      ["publicacionesML", false],
      ["publicacionesCatalogoML", true],
    ])
      for (const [plan, itemId] of Object.entries(p[campo] ?? {}))
        if (itemId && !m.has(itemId)) m.set(itemId, { perfume: p, plan: Number(plan), catalogo });
  return m;
}

export function gananciasDeVentas(ordenes, envios, perfumes, pagos) {
  const indice = indiceDePublicaciones(perfumes);
  const excluidas = { canceladas: 0, sinPagar: 0 };
  const cuentan = [];
  for (const o of ordenes ?? []) {
    if (ESTADOS_QUE_CUENTAN.has(o.estado)) cuentan.push(o);
    else if (ESTADOS_CANCELADOS.has(o.estado)) excluidas.canceladas++;
    else excluidas.sinPagar++;
  }

  // Una fila por ítem vendido, todavía sin envío.
  const filas = [];
  for (const o of cuentan) {
    const comisionItems = o.items.reduce((s, x) => s + x.comisionUnitaria * x.cantidad, 0);
    const comisionNoCierra =
      o.comisionPagos > 0 && Math.abs(comisionItems - o.comisionPagos) > TOLERANCIA_COMISION;
    o.items.forEach((x, i) => {
      const vinculo = indice.get(x.itemId) ?? null;
      filas.push({
        clave: `${o.id}-${i}`,
        ordenId: o.id,
        packId: o.packId,
        envioId: o.envioId,
        fecha: o.fecha,
        estado: o.estado,
        reintegroParcial: o.estado === "partially_refunded",
        itemId: x.itemId,
        titulo: x.titulo,
        cantidad: x.cantidad,
        ingreso: redondear(x.precioUnitario * x.cantidad),
        comision: redondear(x.comisionUnitaria * x.cantidad),
        comisionNoCierra,
        envio: 0,
        envioDesconocido: false,
        impuestos: 0,
        detalleImpuestos: [],
        impuestosDesconocidos: false,
        vinculo,
      });
    });
  }

  /* El envío: una sola vez por envío, repartido por ingreso entre los ítems que
     lo comparten. El último se lleva el resto del redondeo. Sin envío (retiro,
     acordar con el vendedor) es cero, y no es "desconocido". */
  const porEnvio = new Map();
  for (const f of filas) {
    if (!f.envioId) continue;
    if (!porEnvio.has(f.envioId)) porEnvio.set(f.envioId, []);
    porEnvio.get(f.envioId).push(f);
  }
  for (const [id, grupo] of porEnvio) {
    const e = envios?.[id];
    if (!e || e.error != null || e.costoVendedor == null) {
      for (const f of grupo) f.envioDesconocido = true;
      continue;
    }
    repartir(grupo, Number(e.costoVendedor) || 0, "envio");
  }

  /* Los impuestos, por orden: la suma de los de sus pagos aprobados. Si falta
     alguno de esos pagos (Mercado Pago no lo devolvió), la orden se marca y se
     cuenta sin impuestos, como el envío desconocido. */
  for (const o of cuentan) {
    const grupo = filas.filter((f) => f.ordenId === o.id);
    const aprobados = (o.pagos ?? []).filter((p) => p.estado === "approved");
    const leidos = aprobados.map((p) => pagos?.[p.id]);
    if (leidos.some((p) => !p || p.error != null)) {
      for (const f of grupo) f.impuestosDesconocidos = true;
      continue;
    }
    const detalle = leidos.flatMap((p) => p.impuestos ?? []);
    repartir(grupo, detalle.reduce((s, x) => s + x.monto, 0), "impuestos");
    for (const f of grupo) f.detalleImpuestos = detalle;
  }

  const vinculadas = [];
  const sinVincular = [];
  for (const { vinculo, ...f } of filas) {
    const neto = f.ingreso - f.comision - f.envio - f.impuestos;
    if (!vinculo) {
      sinVincular.push({ ...f, neto: redondear(neto), costo: null, ganancia: null, margen: null });
      continue;
    }
    const { perfume, plan, catalogo } = vinculo;
    const { costo: unitario, aproximado } = costoEnFecha(perfume, f.fecha);
    const conCosto = unitario > 0;
    const costo = conCosto ? redondear(unitario * f.cantidad) : null;
    const ganancia = conCosto ? redondear(neto - costo) : null;
    vinculadas.push({
      ...f,
      perfumeId: perfume.id,
      nombre: perfume.nombre,
      foto: perfume.foto ?? null,
      plan,
      catalogo,
      neto: redondear(neto),
      costoUnitario: conCosto ? unitario : null,
      costoAproximado: conCosto && aproximado,
      costo,
      ganancia,
      margen: conCosto ? ganancia / costo : null,
    });
  }

  return { vinculadas, sinVincular, excluidas, totales: totalesDe(vinculadas, sinVincular) };
}

/* Reparte `total` entre las filas del grupo en proporción al ingreso y lo
   escribe en `campo`. El último se lleva el resto del redondeo: la suma cierra
   exacta. */
function repartir(grupo, total, campo) {
  const base = grupo.reduce((s, f) => s + f.ingreso, 0);
  let repartido = 0;
  grupo.forEach((f, i) => {
    const parte =
      i === grupo.length - 1
        ? redondear(total - repartido)
        : redondear(base > 0 ? (total * f.ingreso) / base : total / grupo.length);
    f[campo] = parte;
    repartido += parte;
  });
}

/* Ingreso, comisión, envío e impuestos suman todo lo vendido. Costo y ganancia solo lo que
   tiene costo: sumar una ganancia sin costo sería sumar el ingreso entero. */
function totalesDe(vinculadas, sinVincular) {
  const todas = [...vinculadas, ...sinVincular];
  const suma = (lista, campo) => redondear(lista.reduce((s, f) => s + (f[campo] ?? 0), 0));
  const conGanancia = vinculadas.filter((f) => f.ganancia !== null);
  const costo = suma(conGanancia, "costo");
  const ganancia = suma(conGanancia, "ganancia");
  return {
    ventas: new Set(todas.map((f) => f.ordenId)).size,
    unidades: todas.reduce((s, f) => s + f.cantidad, 0),
    ingreso: suma(todas, "ingreso"),
    comision: suma(todas, "comision"),
    envio: suma(todas, "envio"),
    impuestos: suma(todas, "impuestos"),
    costo,
    ganancia,
    margen: costo > 0 ? ganancia / costo : null,
    conGanancia: conGanancia.length,
    sinCosto: vinculadas.length - conGanancia.length,
    costoAproximado: conGanancia.filter((f) => f.costoAproximado).length,
    sinEnvio: todas.filter((f) => f.envioDesconocido).length,
    sinImpuestos: new Set(todas.filter((f) => f.impuestosDesconocidos).map((f) => f.ordenId)).size,
    comisionNoCierra: new Set(todas.filter((f) => f.comisionNoCierra).map((f) => f.ordenId)).size,
    sinVincular: sinVincular.length,
  };
}
