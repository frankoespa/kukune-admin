import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Minus, Plus, Search, X } from "lucide-react";
import { NumberCell } from "./NumberCell";
import { buscarPerfumes, pesos } from "./Catalogo";
import { urlFoto } from "./almacenamiento";
import { pctSinMiles } from "./numeros";
import { condicionesDeCupon, describirCupon } from "./TiendaNube";
import { cuponDeTiendanube, estadoDeCupon, IVA } from "./precios";
import { precioEnCarrito, sePuedeSimular, simularCarrito } from "./cuentasCarrito";

/* ============================================================
   Simulador de carrito de Tiendanube.

   Arma un carrito a mano —frascos y decants mezclados, con cantidades— y
   muestra qué te queda con cada forma de pago, con la promo por cantidad y el
   cupón encima. Es la pregunta que el detalle de un precio no contesta: ese
   mira un perfume solo, y la calculadora del envío gratis busca el peor
   carrito posible.

   Todo es estado de esta banda: no escribe nada, no se guarda, y se pierde al
   salir de la pestaña. Las cuentas están en `cuentasCarrito.js`.
   ============================================================ */

const CUPON_VACIO = { porcentaje: 0, monto: 0, combinable: true, minimo: 0, deLaTienda: "" };
const PROMO_VACIA = { tipo: "ninguna", x: 3, y: 2, unidades: 2, pct: 10 };

const Rotulo = ({ children }) => (
  <span className="k-col pb-2" style={{ color: "var(--tinta)" }}>
    {children}
  </span>
);

const colorGanancia = (g) => (g === null || g === undefined ? "var(--humo-claro)" : g >= 0 ? "var(--verde)" : "var(--oxido)");
const selectorEstilo = { borderColor: "var(--linea)", background: "var(--papel)", color: "var(--tinta)" };

/* Buscador para agregar: lista en un portal al body, como `BuscadorPerfume`, y
   los botones con `onMouseDown` + `preventDefault` para ganarle al blur. */
function Agregar({ items, tn, onAgregar }) {
  const [consulta, setConsulta] = useState("");
  const [abierto, setAbierto] = useState(false);
  const campo = useRef(null);
  const opciones = useMemo(() => buscarPerfumes(items, consulta).slice(0, 12), [items, consulta]);
  const caja = abierto && campo.current ? campo.current.getBoundingClientRect() : null;

  return (
    <div className="relative">
      <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--humo)" }} />
      <input
        ref={campo}
        value={consulta}
        onChange={(e) => {
          setConsulta(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setAbierto(false)}
        placeholder="Agregar un perfume o un decant…"
        aria-label="Agregar al carrito"
        className="w-[320px] max-w-full rounded-[3px] border py-1.5 pl-8 pr-2 text-[12.5px]"
        style={{ background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" }}
      />
      {caja &&
        createPortal(
          <ul
            className="fixed z-[70] max-h-[320px] overflow-auto rounded-[3px] border shadow-lg"
            style={{ left: caja.left, top: caja.bottom + 2, width: Math.max(caja.width, 380), background: "var(--papel)", borderColor: "var(--linea)" }}
          >
            {opciones.length === 0 ? (
              <li className="px-3 py-2 text-[12px]" style={{ color: "var(--humo)" }}>
                Nada coincide. Solo aparecen los que tienen costo y precio en Tiendanube.
              </li>
            ) : (
              opciones.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onAgregar(p);
                      setConsulta("");
                      // Cerrada: abierta tapaba los +/− de las líneas recién agregadas.
                      setAbierto(false);
                    }}
                    className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[12.5px] transition hover:bg-[var(--vidrio-hondo)]"
                    style={{ color: "var(--tinta)" }}
                  >
                    <span>{p.nombre}</span>
                    <span className="k-num" style={{ color: "var(--humo)" }}>
                      {pesos(precioEnCarrito(p, tn))}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>,
          document.body
        )}
    </div>
  );
}

export default function SimuladorCarrito({ perfumes, tn, cuponesTienda = [], productosTN = [] }) {
  const [abierto, setAbierto] = useState(false);
  // [{id, cantidad, enPromo}]: el ítem se busca en vivo, así sigue a los precios.
  const [lineas, setLineas] = useState([]);
  const [promo, setPromo] = useState(PROMO_VACIA);
  const [cupon, setCupon] = useState(CUPON_VACIO);
  // La forma con la que se miran los aportes de cada línea (null = la que menos deja).
  const [formaAporte, setFormaAporte] = useState(null);

  const items = useMemo(() => (perfumes ?? []).filter((p) => sePuedeSimular(p, tn)), [perfumes, tn]);
  const porId = useMemo(() => new Map((perfumes ?? []).map((p) => [p.id, p])), [perfumes]);
  // Una línea cuyo ítem ya no existe (se sacó el decant) queda afuera de la cuenta.
  const enCuenta = lineas.filter((l) => porId.has(l.id));

  const promoCuenta =
    promo.tipo === "xy" && promo.x > promo.y && promo.y >= 1
      ? { tipo: "xy", x: promo.x, y: promo.y }
      : promo.tipo === "progresivo" && promo.unidades >= 1 && promo.pct > 0
        ? { tipo: "progresivo", unidades: promo.unidades, pct: Math.min(promo.pct, 99) / 100 }
        : null;
  const cuponReal = cuponesTienda.find((c) => String(c.id) === String(cupon.deLaTienda)) ?? null;
  const vigentes = cuponesTienda.filter((c) => estadoDeCupon(c) === "vigente");
  const hayCupon = cupon.porcentaje > 0 || cupon.monto > 0;

  const r = useMemo(
    () =>
      enCuenta.length
        ? simularCarrito({
            lineas: enCuenta.map((l) => ({ item: porId.get(l.id), cantidad: l.cantidad, enPromo: l.enPromo })),
            ajustesTN: tn,
            promo: promoCuenta,
            cupon: hayCupon
              ? { porcentaje: cupon.porcentaje / 100, monto: cupon.monto, combinable: cupon.combinable, minimo: cupon.minimo, real: cuponReal }
              : null,
            productosTN,
          })
        : null,
    // promoCuenta y cuponReal se derivan de promo, cupon y cuponesTienda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enCuenta, porId, tn, promo, cupon, cuponesTienda, productosTN]
  );

  const agregar = (p) =>
    setLineas((ls) =>
      ls.some((l) => l.id === p.id)
        ? ls.map((l) => (l.id === p.id ? { ...l, cantidad: l.cantidad + 1 } : l))
        : [...ls, { id: p.id, cantidad: 1, enPromo: true }]
    );
  const cambiarLinea = (id, campos) => setLineas((ls) => ls.map((l) => (l.id === id ? { ...l, ...campos } : l)));
  const quitar = (id) => setLineas((ls) => ls.filter((l) => l.id !== id));
  const elegirCuponTienda = (id) => {
    const c = cuponesTienda.find((x) => String(x.id) === String(id));
    if (!c) return setCupon(CUPON_VACIO);
    const s = cuponDeTiendanube(c);
    setCupon({ porcentaje: s.porcentaje * 100, monto: s.monto, combinable: s.combinable, minimo: s.minimo, deLaTienda: String(c.id) });
  };

  // La forma de los aportes: la elegida si aplica, si no la que menos deja.
  const iAporte = r
    ? (() => {
        const i = r.formas.findIndex((f) => f.forma.id === formaAporte);
        return i >= 0 && r.formas[i].aplica && r.formas[i].valida ? i : r.define;
      })()
    : -1;
  const envio = r?.envioAplicado ?? 0;
  const conPromo = !!promoCuenta && (r?.promoMonto ?? 0) > 0;

  const th = "k-col px-2.5 py-2 text-right font-normal";
  const td = "k-num px-2.5 py-2 text-right text-[12.5px]";

  return (
    <div className="mb-5 rounded-[4px] border px-4 py-3" style={{ borderColor: "var(--zona-tn-honda)", background: "var(--zona-tn)" }}>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          className="k-col flex items-center gap-1 rounded-[3px] border px-2.5 py-[7px] transition"
          style={{ borderColor: "var(--zona-tn-honda)", color: "var(--tinta)", background: "var(--papel)" }}
        >
          Simular carrito
          <ChevronDown size={13} style={{ transform: abierto ? "rotate(180deg)" : undefined }} />
        </button>
        <span className="text-[12px]" style={{ color: "var(--humo)" }}>
          {r
            ? `${r.unidades} ${r.unidades === 1 ? "unidad" : "unidades"} · ${pesos(r.subtotal)}${
                r.ganancia !== null ? ` · te deja al menos ${pesos(r.ganancia)}` : ""
              }`
            : "Armá un carrito con frascos y decants y mirá cuánto te queda con cada forma de pago, con promo y cupón."}
        </span>
      </div>

      {abierto && (
        <div className="mt-3 rounded-[4px] border px-4 py-3" style={{ borderColor: "var(--zona-tn-honda)", background: "var(--papel)" }}>
          <div className="flex flex-wrap items-center gap-2">
            <Agregar items={items} tn={tn} onAgregar={agregar} />
            {lineas.length > 0 && (
              <button
                type="button"
                onClick={() => setLineas([])}
                className="k-col rounded-[3px] border px-2.5 py-[6px] transition"
                style={{ borderColor: "var(--linea)", color: "var(--humo)", background: "var(--papel)" }}
              >
                Vaciar
              </button>
            )}
          </div>

          {/* ---------- Las líneas ---------- */}
          {r && (
            <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--linea)", color: "var(--humo)" }}>
                  <th className={`${th} text-left`}>En el carrito</th>
                  <th className={th}>Precio</th>
                  <th className={`${th} text-center`}>Cantidad</th>
                  {promoCuenta && <th className={`${th} text-center`}>Entra en la promo</th>}
                  <th className={th}>Subtotal</th>
                  <th className={th} title="Cuánto más ganás por tener esta línea en el carrito, con la forma de pago elegida abajo">
                    Suma a tu ganancia
                  </th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {r.filas.map((f) => {
                  const l = enCuenta[f.i];
                  const aporte = f.aporte?.[iAporte] ?? null;
                  const precioTN = Number(f.item.precioTN) || 0;
                  return (
                    <tr key={l.id} className="border-b" style={{ borderColor: "var(--linea)" }}>
                      <td className="px-2.5 py-1.5 text-[12.5px]" style={{ color: "var(--tinta)" }}>
                        <span className="flex items-center gap-2">
                          {f.item.foto ? (
                            <img src={urlFoto(f.item.foto)} alt="" className="h-8 w-8 rounded-[2px] object-cover" />
                          ) : (
                            <span className="h-8 w-8 rounded-[2px]" style={{ background: "var(--vidrio-hondo)" }} />
                          )}
                          <span>
                            {f.item.nombre}
                            {f.alcanceCupon === "no" && (
                              <small className="block text-[10.5px]" style={{ color: "var(--oxido)" }}>
                                el cupón no aplica a este
                              </small>
                            )}
                            {f.alcanceCupon === "no se sabe" && (
                              <small className="block text-[10.5px]" style={{ color: "var(--humo)" }}>
                                sin vincular: el cupón se simula igual
                              </small>
                            )}
                          </span>
                        </span>
                      </td>
                      <td className={td} style={{ color: "var(--tinta)" }}>
                        {pesos(f.precio)}
                        {f.precio < precioTN && (
                          <small className="block text-[10.5px]" style={{ color: "var(--humo)" }}>
                            oferta · era <span className="line-through">{pesos(precioTN)}</span>
                          </small>
                        )}
                      </td>
                      <td className="px-2.5 py-1.5">
                        <span className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            onClick={() => (l.cantidad > 1 ? cambiarLinea(l.id, { cantidad: l.cantidad - 1 }) : quitar(l.id))}
                            aria-label={`Una menos de ${f.item.nombre}`}
                            className="rounded-[3px] border p-1 transition"
                            style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
                          >
                            <Minus size={12} />
                          </button>
                          <span className="k-num w-6 text-center text-[13px]" style={{ color: "var(--tinta)" }}>
                            {l.cantidad}
                          </span>
                          <button
                            type="button"
                            onClick={() => cambiarLinea(l.id, { cantidad: l.cantidad + 1 })}
                            aria-label={`Una más de ${f.item.nombre}`}
                            className="rounded-[3px] border p-1 transition"
                            style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
                          >
                            <Plus size={12} />
                          </button>
                        </span>
                      </td>
                      {promoCuenta && (
                        <td className="px-2.5 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={l.enPromo !== false}
                            onChange={(e) => cambiarLinea(l.id, { enPromo: e.target.checked })}
                            aria-label={`${f.item.nombre} entra en la promo`}
                          />
                          {f.promo > 0 && (
                            <small className="k-num block text-[10.5px]" style={{ color: "var(--humo)" }}>
                              −{pesos(f.promo)}
                            </small>
                          )}
                        </td>
                      )}
                      <td className={td} style={{ color: "var(--tinta)" }}>
                        {pesos(f.trasPromo)}
                      </td>
                      <td className={`${td} font-semibold`} style={{ color: colorGanancia(aporte) }}>
                        {aporte === null ? "—" : `${aporte >= 0 ? "+" : "−"}${pesos(Math.abs(aporte))}`}
                      </td>
                      <td className="px-1 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => quitar(l.id)}
                          aria-label={`Sacar ${f.item.nombre}`}
                          className="rounded-[3px] p-1 transition"
                          style={{ color: "var(--humo)" }}
                        >
                          <X size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}

          {/* ---------- Promo y cupón: el mismo molde que el detalle del precio ---------- */}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Rotulo>Promoción por cantidad</Rotulo>
            <select
              value={promo.tipo}
              onChange={(e) => setPromo((p) => ({ ...p, tipo: e.target.value }))}
              aria-label="Tipo de promoción por cantidad"
              className="rounded-[3px] border px-2 py-[6px] text-[12.5px]"
              style={selectorEstilo}
            >
              <option value="ninguna">Ninguna</option>
              <option value="xy">Llevá X, pagá Y</option>
              <option value="progresivo">Progresivo (% desde N unidades)</option>
            </select>
            {promo.tipo === "xy" && (
              <>
                <span className="k-col pb-2" style={{ color: "var(--humo)" }}>
                  llevá
                </span>
                <label className="block w-[64px]" title="Unidades que lleva">
                  <NumberCell value={promo.x} onChange={(v) => setPromo((p) => ({ ...p, x: Math.max(2, Math.round(v)) }))} />
                </label>
                <span className="k-col pb-2" style={{ color: "var(--humo)" }}>
                  pagá
                </span>
                <label className="block w-[64px]" title="Unidades que paga">
                  <NumberCell value={promo.y} onChange={(v) => setPromo((p) => ({ ...p, y: Math.max(1, Math.round(v)) }))} />
                </label>
              </>
            )}
            {promo.tipo === "progresivo" && (
              <>
                <span className="k-col pb-2" style={{ color: "var(--humo)" }}>
                  desde
                </span>
                <label className="block w-[64px]" title="Unidades desde las que aplica">
                  <NumberCell value={promo.unidades} onChange={(v) => setPromo((p) => ({ ...p, unidades: Math.max(1, Math.round(v)) }))} suffix="u." />
                </label>
                <label className="block w-[72px]" title="Descuento">
                  <NumberCell value={promo.pct} onChange={(v) => setPromo((p) => ({ ...p, pct: Math.max(0, Math.min(99, v)) }))} suffix="%" />
                </label>
              </>
            )}
            {promo.tipo === "xy" && !(promo.x > promo.y) && (
              <span className="pb-2 text-[11.5px]" style={{ color: "var(--oxido)" }}>
                Tiene que llevar más de lo que paga.
              </span>
            )}
            {promoCuenta && (
              <span className="w-full text-[11px]" style={{ color: "var(--humo)" }}>
                {promoCuenta.tipo === "xy"
                  ? `Cada ${promoCuenta.x} unidades que entran en la promo, ${promoCuenta.x - promoCuenta.y} va${
                      promoCuenta.x - promoCuenta.y === 1 ? "" : "n"
                    } gratis: se supone que son las más baratas.`
                  : `Con ${promoCuenta.unidades} o más unidades en la promo, −${pctSinMiles(promoCuenta.pct, 0)} sobre esas unidades.`}{" "}
                Va antes del cupón y del descuento del medio de pago, y se supone que se combina con ellos. La casilla de cada
                línea dice si ese producto entra (en Tiendanube la promo se arma para productos o categorías).
              </span>
            )}
          </div>

          {cuponesTienda.length > 0 && (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Rotulo>Cupón de la tienda</Rotulo>
              <select
                value={cupon.deLaTienda}
                onChange={(e) => elegirCuponTienda(e.target.value)}
                aria-label="Cupón de la tienda"
                className="rounded-[3px] border px-2 py-[6px] text-[12.5px]"
                style={selectorEstilo}
              >
                <option value="">A mano (abajo)</option>
                {vigentes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {describirCupon(c)}
                  </option>
                ))}
              </select>
              {cuponReal && (
                <span className="pb-2 text-[11.5px]" style={{ color: r && hayCupon && !r.cuponAplica ? "var(--oxido)" : "var(--humo)" }}>
                  {cuponReal.type === "shipping"
                    ? "Es de envío gratis: no cambia la cuenta, la app ya supone que el envío lo pagás vos."
                    : r && !r.cuponAplica
                      ? r.baseCupon > 0
                        ? `Pide una compra de al menos ${pesos(cupon.minimo)}: con este carrito no aplica.`
                        : "No aplica a nada de este carrito."
                      : condicionesDeCupon(cuponReal)}
                </span>
              )}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <Rotulo>Cupón</Rotulo>
            <label className="block w-[80px]" title="Porcentaje del cupón">
              <NumberCell
                value={cupon.porcentaje}
                onChange={(v) => setCupon((c) => ({ ...c, porcentaje: Math.max(0, Math.min(100, v)), deLaTienda: "", minimo: 0 }))}
                suffix="%"
              />
            </label>
            <span className="k-col pb-2" style={{ color: "var(--humo)" }}>
              +
            </span>
            <label className="block w-[104px]" title="Monto fijo del cupón, en pesos">
              <NumberCell
                value={cupon.monto}
                onChange={(v) => setCupon((c) => ({ ...c, monto: Math.max(0, v), deLaTienda: "", minimo: 0 }))}
                suffix="$"
              />
            </label>
            {hayCupon && (
              <button
                type="button"
                onClick={() => setCupon(CUPON_VACIO)}
                className="k-col mb-1 rounded-[3px] border px-2.5 py-[5px] transition"
                style={{ borderColor: "var(--linea)", color: "var(--humo)", background: "var(--papel)" }}
              >
                Quitar cupón
              </button>
            )}
            <label className="mb-1.5 flex cursor-pointer items-center gap-1.5 text-[12px]" style={{ color: "var(--tinta)" }}>
              <input
                type="checkbox"
                checked={cupon.combinable}
                onChange={(e) => setCupon((c) => ({ ...c, combinable: e.target.checked, deLaTienda: "" }))}
              />
              Se combina con el descuento del medio de pago
            </label>
          </div>

          {/* ---------- El resultado ---------- */}
          {!r ? (
            <p className="py-6 text-center text-[12.5px]" style={{ color: "var(--humo-claro)" }}>
              El carrito está vacío. Buscá arriba un perfume o un decant para agregarlo.
            </p>
          ) : (
            <>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]" style={{ color: "var(--tinta)" }}>
                <span>
                  Subtotal <b className="k-num">{pesos(r.subtotalLista)}</b>
                </span>
                {conPromo && (
                  <span>
                    Promo <b className="k-num">−{pesos(r.promoMonto)}</b>
                  </span>
                )}
                {r.cuponAplica && (
                  <span>
                    Cupón <b className="k-num">−{pesos(r.cuponMonto)}</b>
                  </span>
                )}
                <span>
                  Costo de lo que se lleva <b className="k-num">{pesos(r.costoTotal)}</b>
                </span>
              </div>
              {r.umbralEnvio > 0 && (
                <p className="mt-1 text-[12px]" style={{ color: "var(--humo)" }}>
                  {r.envioCalifica ? (
                    <>
                      Llega a <span className="k-num">{pesos(r.umbralEnvio)}</span>: el envío es gratis para el cliente y lo
                      pagás vos (<span className="k-num">{pesos(envio)}</span>, ya descontado abajo).
                    </>
                  ) : (
                    <>
                      Faltan <span className="k-num">{pesos(r.faltaEnvio)}</span> para el envío gratis: el envío lo paga el
                      cliente, pero la comisión de cada forma sobre ese envío (calculada con{" "}
                      <span className="k-num">{pesos(r.envioCliente)}</span>) sale de lo tuyo.
                    </>
                  )}{" "}
                  Se mide contra el subtotal con la promo, antes del cupón y del descuento del medio de pago.
                </p>
              )}

              <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--linea)", color: "var(--humo)" }}>
                    <th className={`${th} text-left`}>Si paga con</th>
                    <th className={th}>Paga el cliente</th>
                    <th className={th}>Comisión + IVA</th>
                    <th className={th}>Te llega</th>
                    <th className={th}>{envio > 0 ? "Ganás (ya sin envío)" : "Ganás"}</th>
                    <th className={th}>Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {r.formas.map((f, i) => {
                    const nombre = (
                      <td className="px-2.5 py-2 text-[12.5px]" style={{ color: "var(--tinta)" }}>
                        {f.forma.nombre}
                        {i === r.define && (
                          <span
                            className="k-col ml-1.5 whitespace-nowrap rounded-full px-1.5 py-px text-[9px]"
                            style={{ background: "var(--tinta)", color: "var(--papel)" }}
                          >
                            la que menos deja
                          </span>
                        )}
                      </td>
                    );
                    if (!f.valida)
                      return (
                        <tr key={f.forma.id} className="border-b" style={{ borderColor: "var(--linea)" }}>
                          {nombre}
                          <td colSpan={5} className="px-2.5 py-2 text-[12px]" style={{ color: "var(--oxido)" }}>
                            Revisá los porcentajes: comisión más descuento no pueden llegar al 100%.
                          </td>
                        </tr>
                      );
                    if (!f.aplica)
                      return (
                        <tr key={f.forma.id} className="border-b" style={{ borderColor: "var(--linea)" }}>
                          {nombre}
                          <td colSpan={5} className="px-2.5 py-2 text-[12px]" style={{ color: "var(--humo-claro)" }}>
                            No se ofrece: el carrito paga {pesos(f.paga)} y pide al menos {pesos(f.minimo)}
                          </td>
                        </tr>
                      );
                    const sinEnvio = envio + (f.comisionEnvio || 0);
                    const siRetira = f.ganancia === null || sinEnvio <= 0 ? null : f.ganancia + sinEnvio;
                    const margen = f.ganancia === null || !(r.costoTotal > 0) ? null : f.ganancia / r.costoTotal;
                    const elegida = i === iAporte;
                    return (
                      <tr
                        key={f.forma.id}
                        onClick={() => setFormaAporte(f.forma.id)}
                        className="cursor-pointer border-b"
                        title='Clic para ver con esta forma de pago cuánto suma cada línea ("Suma a tu ganancia", arriba)'
                        style={{ borderColor: "var(--linea)", background: elegida ? "var(--zona-tn)" : undefined }}
                      >
                        {nombre}
                        <td className={td} style={{ color: "var(--tinta)" }}>
                          {pesos(f.paga)}
                          {(() => {
                            const partes = [];
                            if (conPromo) partes.push(`−${pesos(r.promoMonto)} promo`);
                            if (r.cuponAplica) partes.push(`−${pesos(r.cuponMonto)} cupón`);
                            if ((Number(f.forma.descuento) || 0) > 0)
                              partes.push(
                                f.conDescuento
                                  ? `−${pctSinMiles(f.forma.descuento, 0)} desc.`
                                  : `sin su −${pctSinMiles(f.forma.descuento, 0)} (no combina)`
                              );
                            return partes.length ? (
                              <small className="block text-[10.5px]" style={{ color: "var(--humo-claro)" }}>
                                {partes.join(" · ")}
                              </small>
                            ) : null;
                          })()}
                        </td>
                        <td className={td} style={{ color: "var(--humo)" }}>
                          −{pesos(f.total)}
                          <small className="block text-[10.5px]" style={{ color: "var(--humo-claro)" }}>
                            {pctSinMiles(f.tasaReal, 2)} · IVA {pctSinMiles(IVA, 0)} sobre la pasarela
                          </small>
                          {f.comisionEnvio > 0 && (
                            <small className="block text-[10.5px]" style={{ color: "var(--humo)" }}>
                              −{pesos(f.comisionEnvio)} s/envío
                            </small>
                          )}
                        </td>
                        <td className={td} style={{ color: "var(--tinta)" }}>
                          {pesos(f.llega)}
                        </td>
                        <td className={`${td} font-semibold`} style={{ color: colorGanancia(f.ganancia) }}>
                          {f.ganancia === null ? "—" : pesos(f.ganancia)}
                          {siRetira !== null && (
                            <small className="block text-[10.5px] font-normal" style={{ color: "var(--verde)" }}>
                              {pesos(siRetira)} si retira
                            </small>
                          )}
                        </td>
                        <td className={td} style={{ color: margen === null ? "var(--humo-claro)" : margen >= 0 ? "var(--verde)" : "var(--oxido)" }}>
                          {margen === null ? "—" : pctSinMiles(margen, 1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              <p className="mt-2 text-[11.5px]" style={{ color: "var(--humo)" }}>
                Es el carrito entero en una sola compra: un solo envío y los mínimos de cada forma de pago contra el total.
                {iAporte >= 0 &&
                  ` "Suma a tu ganancia" es cuánto más ganás por tener esa línea en el carrito, pagando con "${r.formas[iAporte].forma.nombre}" (clic en otra forma para cambiarla): el envío y las comisiones fijas ya los paga el resto, por eso los aportes no suman el total. "—" es que sin esa línea esa forma de pago no se ofrece.`}
                {envio > 0 && ` "Si retira" es lo que te queda si lo retira en mano: ahí no pagás el envío.`} Es una prueba: no se
                guarda ni toca ningún precio.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
