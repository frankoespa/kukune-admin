import { useEffect, useMemo, useState } from "react";
import { NumberCell } from "./NumberCell";
import { pesos } from "./Catalogo";
import { pctSinMiles as pctCorto } from "./numeros";
import { resultadoDeCanal } from "./precios";
import { nombreDePlan, precioListaDe, promoVigente, vinculosDe } from "./clienteML";

/* ============================================================
   El descuento propio (PRICE_DISCOUNT): el que pone Franco, sin campaña de ML.

   Es el cuerpo del `Dialogo` y no un panel aparte: son tres campos. Lleva su
   estado adentro y lo escribe en el `estado` que le pasa el padre (un ref), que
   es el mismo gesto que `atarAlPasar` en "pasar costos al catálogo" —
   `Dialogo.onAceptar` solo devuelve un campo de texto.

   Reglas de ML, que el server vuelve a validar en `pedidoDePromo`: el descuento
   va entre 5% y 80%, dura 14 días como máximo, y el precio para los mejores
   compradores tiene que ser al menos 5% más bajo que el general.

   Lo paga el vendedor entero: acá no hay nada que ponga ML, así que lo que te
   llega es lo que paga el comprador.
   ============================================================ */

export const PLAZO_MAXIMO_DIAS = 14;

const ZONA = "America/Argentina/Buenos_Aires";
// AAAA-MM-DD en hora de Argentina (en-CA formatea justo así, como en Ventas).
const diaAR = (masDias = 0) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(Date.now() + masDias * 86400000)
  );

export function CuerpoDescuento({ perfume, planes, pubPorId, promos, ajustes, estado }) {
  const opciones = useMemo(
    () =>
      planes
        .map((plan) => ({ plan, itemId: vinculosDe(perfume)[plan] }))
        .filter((x) => x.itemId && pubPorId.get(x.itemId)),
    [perfume, planes, pubPorId]
  );
  const [plan, setPlan] = useState(opciones[0]?.plan ?? null);
  const elegido = opciones.find((x) => x.plan === plan) ?? opciones[0] ?? null;
  const pub = elegido ? pubPorId.get(elegido.itemId) : null;
  const lista = pub ? precioListaDe(pub) : 0;

  // Arranca en 10% off, que entra en el rango de ML sin tener que pensarlo.
  const [precio, setPrecio] = useState(0);
  const [desde, setDesde] = useState(diaAR());
  const [hasta, setHasta] = useState(diaAR(7));
  useEffect(() => {
    setPrecio(lista > 0 ? Math.round(lista * 0.9) : 0);
  }, [lista]);

  const puesta = elegido ? promoVigente(promos?.[elegido.itemId]) : null;
  const yaTiene = puesta?.tipo === "PRICE_DISCOUNT";

  const costo = Number(perfume.costo) || 0;
  const comision =
    (Number(ajustes.comisionML) || 0) + (plan === 1 ? 0 : Number(ajustes.cuotasML?.[plan]) || 0);
  const r = resultadoDeCanal({ costo, precio, comision, envio: ajustes.envioML });
  const hoy = resultadoDeCanal({ costo, precio: lista, comision, envio: ajustes.envioML });
  const descuento = lista > 0 && precio > 0 ? 1 - precio / lista : null;
  const dias = Math.round((new Date(hasta) - new Date(desde)) / 86400000) + 1;

  const problemas = [
    descuento != null && descuento < 0.05 && "El descuento tiene que ser de al menos 5%.",
    descuento != null && descuento > 0.8 && "El descuento no puede pasar el 80%.",
    dias > PLAZO_MAXIMO_DIAS && `Un descuento propio dura ${PLAZO_MAXIMO_DIAS} días como máximo.`,
    hasta < desde && "La fecha de fin es anterior a la de inicio.",
  ].filter(Boolean);

  // Lo que el padre va a mandar si se acepta. `null` = no se puede mandar.
  useEffect(() => {
    estado.current =
      elegido && precio > 0 && !problemas.length
        ? {
            accion: "descuento",
            tipo: "PRICE_DISCOUNT",
            itemId: elegido.itemId,
            precio,
            desde,
            hasta,
            lista,
            /* ML no deja encimar dos descuentos propios: si ya hay uno, el
               server lo quita antes de poner éste. */
            reemplaza: yaTiene,
            promocionId: yaTiene ? puesta.id : undefined,
            ofertaId: yaTiene ? puesta.ofertaId : undefined,
            // Para el aviso del padre; no viajan a ML.
            plan: elegido.plan,
            ganancia: r.ganancia,
          }
        : null;
  }, [elegido, precio, desde, hasta, lista, problemas.length, r.ganancia, yaTiene, puesta, estado]);

  if (!opciones.length)
    return <p>Este perfume todavía no tiene ninguna publicación vinculada en Mercado Libre.</p>;

  const campo = "rounded-[3px] border px-2 py-1 text-[12.5px]";
  const estiloCampo = { background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" };

  return (
    <div className="grid gap-2.5">
      {opciones.length > 1 && (
        <label className="flex items-center gap-2">
          <span className="k-col" style={{ color: "var(--humo)" }}>
            Publicación
          </span>
          <select
            value={plan ?? ""}
            onChange={(e) => setPlan(Number(e.target.value))}
            className={campo}
            style={estiloCampo}
          >
            {opciones.map((o) => (
              <option key={o.plan} value={o.plan}>
                {nombreDePlan(o.plan)} · {o.itemId}
              </option>
            ))}
          </select>
        </label>
      )}

      {yaTiene && (
        <p style={{ color: "var(--oxido)" }}>
          {nombreDePlan(elegido.plan)} ya tiene un descuento propio y el comprador paga{" "}
          {pesos(puesta.paga)}. Mercado Libre no deja modificarlo, así que al confirmar se{" "}
          <strong>quita ése y se pone éste</strong>, en un solo paso. Si lo nuevo fallara después de
          haberlo quitado, la publicación queda sin ningún descuento y lo dice.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
            Paga el comprador
          </span>
          <div className="w-[130px]">
            <NumberCell value={precio} onChange={setPrecio} />
          </div>
        </label>
        <label className="block">
          <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
            Desde
          </span>
          <input
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            className={`k-num ${campo}`}
            style={estiloCampo}
          />
        </label>
        <label className="block">
          <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
            Hasta
          </span>
          <input
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className={`k-num ${campo}`}
            style={estiloCampo}
          />
        </label>
      </div>

      <div className="rounded-[3px] px-3 py-2" style={{ background: "var(--zona-ml)" }}>
        <p>
          Precio publicado {pesos(lista)} ·{" "}
          <strong>{descuento == null ? "—" : `${pctCorto(descuento)} de descuento`}</strong> ·{" "}
          {dias > 0 ? `${dias} día${dias === 1 ? "" : "s"}` : "fechas al revés"}
        </p>
        <p className="mt-1">
          Te quedan{" "}
          <strong
            className="k-num"
            style={{
              color: r.ganancia == null ? "var(--humo)" : r.ganancia > 0 ? "var(--ambar)" : "var(--oxido)",
            }}
          >
            {r.ganancia == null ? "—" : pesos(r.ganancia)}
          </strong>{" "}
          por unidad
          {hoy.ganancia != null && r.ganancia != null && (
            <>
              {" "}
              — hoy, sin descuento, te quedan {pesos(hoy.ganancia)} (
              <span style={{ color: r.ganancia - hoy.ganancia >= 0 ? "var(--verde)" : "var(--oxido)" }}>
                {r.ganancia - hoy.ganancia >= 0 ? "+" : ""}
                {pesos(r.ganancia - hoy.ganancia)}
              </span>
              )
            </>
          )}
          .
        </p>
        <p className="mt-1" style={{ color: "var(--humo)" }}>
          Este descuento lo pagás vos entero: no hay nada que ponga Mercado Libre.
        </p>
      </div>

      {problemas.map((p) => (
        <p key={p} style={{ color: "var(--oxido)" }}>
          {p}
        </p>
      ))}
      <p style={{ color: "var(--humo)" }}>
        Se escribe en la publicación real: Mercado Libre no tiene modo de prueba. Puede rechazarlo si no
        considera creíble el descuento, y en ese caso lo dice.
      </p>
    </div>
  );
}
