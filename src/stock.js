/* ============================================================
   Stock: el único número de unidades que esta app posee.

   El modelo es: **stock base (sin publicar) + lo asignado a ML + lo asignado a
   Tiendanube**. El que se guarda es la base; el total se calcula.

   Esa dirección no es intercambiable con la inversa, y conviene tenerlo claro
   antes de "mejorarlo":

   · base guardada, total = base + ML + TN → ML vende uno y baja de 5 a 4 por su
     cuenta. La base no se mueve y el total baja a 9. Correcto: se fue una unidad.
   · total guardado, base = total − ML − TN → ML baja a 4, el total sigue en 10 y
     la base SUBE de 2 a 3. La venta aparece como una unidad que volvió al
     estante.

   Para que la inversa funcionara habría que descontarle al total cada venta de
   cada canal, y la app no las sabe: las de Tiendanube no se leen y las ventas en
   mano todavía no se registran.

   Por lo mismo, **las cantidades de los canales no se guardan**: se leen en vivo.
   Un espejo guardado habría que refrescarlo con cada lectura, o sea escribir en
   `perfumes.json` por entrar a una pantalla, que es justo lo que la app evita.

   Lo único que mueve la base:
     1. cerrar un pedido (las unidades que le pediste al proveedor llegaron),
     2. asignarle stock a un canal desde la app (sale de la base),
     3. a mano, en la celda.

   Que ML o Tiendanube bajen solos NO toca la base: esas unidades se vendieron y
   desaparecen del total por sí mismas.

   OJO, hueco conocido y a propósito: mientras no existan las ventas directas,
   una venta en mano no descuenta nada y la base se atrasa. Se corrige a mano.

   Puro y SIN IMPORTS: así se prueba desde Node (`node prueba.mjs`), igual que
   `historialCostos.js`, `dolar.js` y `precios.js`. Node pide la extensión en los
   imports y el resto del proyecto escribe `from "./x"` sin ella, así que un
   import acá rompería la prueba desde Node. Por eso los dos accesores de vínculo
   están repetidos abajo en vez de importados.
   ============================================================ */

/* Copia de `vinculosDe` (clienteML.js) y `vinculoTN` (clienteTN.js). Si allá
   cambia de qué clave sale un vínculo, hay que tocarlo acá también. */
const vinculosML = (perfume) => perfume?.publicacionesML ?? {};
const vinculoDeTN = (perfume) => perfume?.publicacionTN ?? null;

const num = (x) => Number(x) || 0;

/* El marcador de un aporte ya asentado. Va por fila y no por pedido para que,
   si se reabre un pedido y se le agrega una fila, al volver a cerrarlo entre
   solo la nueva. */
const yaAsentado = (perfume, pedidoId, filaId) =>
  (Array.isArray(perfume?.aportesStock) ? perfume.aportesStock : []).some(
    (a) => a.pedido === pedidoId && a.fila === filaId
  );

/* Qué unidades de este pedido todavía no se sumaron al stock, agrupadas por
   perfume. Es lo que el diálogo de cerrar muestra antes de escribir.

   Se saltean las filas sin perfume, las huérfanas (el perfume ya no está en el
   catálogo) y las de cantidad cero. Si el mismo perfume apareciera en dos filas
   —hoy la app no lo permite, pero un archivo viejo puede tenerlo— se suman.

   -> [{ perfumeId, nombre, unidades, filas: [{ id, unidades }] }], por nombre */
export function aportesPendientes(productos, perfumePorId, pedidoId) {
  const porPerfume = new Map();
  for (const f of Array.isArray(productos) ? productos : []) {
    if (!f.perfumeId) continue;
    const perfume = perfumePorId.get(f.perfumeId);
    if (!perfume) continue; // huérfana: no hay a quién sumarle
    const unidades = Math.trunc(num(f.cantidad));
    if (unidades <= 0) continue;
    if (yaAsentado(perfume, pedidoId, f.id)) continue;
    const acum = porPerfume.get(f.perfumeId) ?? {
      perfumeId: f.perfumeId,
      nombre: perfume.nombre,
      unidades: 0,
      filas: [],
    };
    acum.unidades += unidades;
    acum.filas.push({ id: f.id, unidades });
    porPerfume.set(f.perfumeId, acum);
  }
  return [...porPerfume.values()].sort((a, b) =>
    String(a.nombre).localeCompare(String(b.nombre), "es")
  );
}

/* La lista de perfumes con esos aportes sumados y asentados en `aportesStock`.
   Devuelve el MISMO array si no había nada que sumar, para no disparar un
   guardado al cerrar un pedido que ya había aportado. */
export function sumarAportes(perfumes, productos, perfumePorId, pedidoId, fecha = new Date().toISOString()) {
  const pendientes = aportesPendientes(productos, perfumePorId, pedidoId);
  if (!pendientes.length) return perfumes;
  const porId = new Map(pendientes.map((a) => [a.perfumeId, a]));
  return perfumes.map((p) => {
    const aporte = porId.get(p.id);
    if (!aporte) return p;
    const asientos = Array.isArray(p.aportesStock) ? p.aportesStock : [];
    return {
      ...p,
      stock: num(p.stock) + aporte.unidades,
      aportesStock: [
        ...asientos,
        ...aporte.filas.map((f) => ({ pedido: pedidoId, fila: f.id, unidades: f.unidades, fecha })),
      ],
    };
  });
}

/* Asignarle `nuevo` unidades a un canal que tenía `anterior` sale de la base.
   El anterior se lee de la publicación o la variante inmediatamente antes de
   escribir, así que el delta es correcto aunque el canal haya vendido en el
   medio: lo que vendió ya no está ni en el canal ni en el total, y la base no
   tiene por qué enterarse.

   Devuelve el MISMO objeto si no se mueve nada. Puede dejar la base en negativo
   —asignaste unidades que nunca registraste—; eso se avisa, no se traba. */
export function conStockAsignado(perfume, anterior, nuevo) {
  const delta = Math.trunc(num(nuevo)) - Math.trunc(num(anterior));
  if (!delta) return perfume;
  return { ...perfume, stock: num(perfume.stock) - delta };
}

/* ¿Este perfume está sin stock? Significa **una sola cosa: no hay unidades en
   ninguna parte, y lo sabemos**.

   Antes significaba dos, y por eso mentía. "El stock nunca se cargó" entraba sin
   mirar los canales, así que un perfume con 2 publicados en Tiendanube aparecía
   bajo "N sin stock" —tiene stock, lo que falta es decir cuántos quedan en el
   cajón—. En el catálogo real eran 13 de 24. Que falte cargarlo se ve en la
   fila, que muestra `—` en vez de un número; no es "no tengo".

   Las dos piezas de la regla:
   · **La base ausente cuenta como cero**, no como un caso aparte.
   · **Los canales ya vienen resueltos** por `stockPorPerfume`: un canal sin
     vínculo llega como `0` (no está publicado ahí, así que no hay unidades ahí)
     y `null` es *no se sabe* —vinculado pero sin leer, o sin conexión—. Con un
     `null` o un `"inf"` no se afirma nada: el contador solo marca lo que puede
     probar. */
export function estaSinStock(perfume, enCanales) {
  if (num(perfume?.stock) > 0) return false;
  const { ml, tn } = enCanales ?? { ml: null, tn: null };
  if ([ml, tn].some((u) => u == null || u === "inf")) return false; // no se sabe
  return num(ml) <= 0 && num(tn) <= 0;
}

/* El total en mano. `enML` y `enTN` son números, `null` si todavía no se leyeron
   e `"inf"` si el canal tiene la gestión de stock apagada (en Tiendanube,
   `stock: null` significa infinito).

   -> { total, parcial, infinito }
   · `infinito`: algún canal no lleva la cuenta, así que no hay total posible.
   · `parcial`: falta leer algún canal. Un total a medias es peor que ninguno, así
     que quien lo muestre tiene que decir que es solo la base. */
export function totalEnMano(base, enML, enTN) {
  const b = num(base);
  if (enML === "inf" || enTN === "inf") return { total: null, parcial: false, infinito: true };
  if (enML == null || enTN == null) return { total: b, parcial: true, infinito: false };
  return { total: b + num(enML) + num(enTN), parcial: false, infinito: false };
}

/* Cuántas unidades tiene cada perfume en cada canal, leído en vivo.

   `publicaciones` son las de ML (null = no se leyeron) y `productosTN` los de
   Tiendanube (null = no se leyeron). Para cada perfume:
     · `ml`: el stock de su publicación. **Un solo número, no la suma de las
       publicaciones**: ML comparte el stock entre las del mismo perfume (1 pago,
       6 cuotas, normal y catálogo son hasta cuatro del mismo User Product), así
       que sumarlas contaría cuatro veces lo mismo. Se toma la primera vinculada.
     · `tn`: el stock de su variante vinculada, o `"inf"` si la variante tiene la
       gestión de stock apagada (en Tiendanube eso llega como `stock: null`).
     · **Sin vínculo en ese canal = `0`**, que es un dato y no una incógnita: si
       el perfume no está publicado ahí, no tiene unidades ahí. Antes esto daba
       `null` igual que "no se leyó", y las dos cosas no son lo mismo: el total en
       mano de un perfume que solo se vende en mano quedaba sin calcular, y el
       contador de "sin stock" terminaba contradiciendo a la celda, que decía
       "no se sabe" mientras el botón afirmaba que no había nada.
     · `null` = **no se sabe**: vinculado pero sin leer todavía, o sin conexión.
       No es cero.
     · `mlPubId`: **a cuál de las publicaciones se le leyó** ese número. Sale acá
       porque quien quiera cambiarlo tiene que escribirle a esa misma y no elegir
       otra por su cuenta: comparten el stock, así que escribirle a la que no se
       leyó daría un delta calculado contra un número ajeno.

   -> Map(perfumeId -> { ml, tn, mlPubId }) */
export function stockPorPerfume(perfumes, publicaciones, productosTN) {
  const pubPorId = publicaciones ? new Map(publicaciones.map((x) => [String(x.id), x])) : null;
  let varPorId = null;
  if (productosTN) {
    varPorId = new Map();
    for (const p of productosTN) for (const v of p.variantes ?? []) varPorId.set(String(v.id), v);
  }
  const salida = new Map();
  for (const perfume of perfumes ?? []) {
    const idsML = Object.values(vinculosML(perfume));
    let ml = idsML.length ? null : 0; // sin vínculo no es incógnita: es cero
    let mlPubId = null;
    if (pubPorId) {
      for (const id of idsML) {
        const pub = pubPorId.get(String(id));
        if (pub && pub.stock != null) {
          ml = Number(pub.stock);
          mlPubId = pub.id;
          break; // comparten stock: con una alcanza
        }
      }
    }
    const v = vinculoDeTN(perfume);
    let tn = v ? null : 0;
    if (varPorId && v) {
      const variante = varPorId.get(String(v.variantId));
      if (variante) tn = variante.stock == null ? "inf" : Number(variante.stock);
    }
    salida.set(perfume.id, { ml, tn, mlPubId });
  }
  return salida;
}
