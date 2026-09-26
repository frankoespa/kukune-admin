import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X, ChevronDown } from "lucide-react";
import { NumberCell } from "./NumberCell";
import { FORMAS_TN_POR_DEFECTO } from "./almacenamiento";
import { analisisTiendaNube, comisionRealTN, IVA } from "./precios";

/* ============================================================
   Tiendanube en el catálogo: la caja de ajustes (con las formas de pago) y el
   panel con el detalle de un precio. Las cuentas viven en `precios.js`.
   ============================================================ */

export const pesos = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);

const porcentaje = (fraccion) =>
  `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2, useGrouping: false }).format(
    (fraccion || 0) * 100
  )}%`;

const REDONDEOS = [
  { valor: 1, texto: "Sin redondear" },
  { valor: 100, texto: "$100" },
  { valor: 500, texto: "$500" },
  { valor: 1000, texto: "$1.000" },
];

const rotulo = (texto) => (
  <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
    {texto}
  </span>
);

/* "Redondear arriba a", el mismo en los tres canales. Solo toca los precios que
   salen de una cuenta (margen clavado y `=`); los puestos a mano, nunca. */
export function SelectorRedondeo({ valor, onCambiar }) {
  return (
    <label
      className="block"
      title="Solo redondea los precios calculados (margen clavado y =). Los que pusiste a mano no cambian."
    >
      {rotulo("Redondear arriba a")}
      <select
        value={valor || 1}
        onChange={(e) => onCambiar(Number(e.target.value))}
        className="k-num rounded-[3px] border px-1.5 py-[5px] text-[12.5px]"
        style={{ background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" }}
      >
        {REDONDEOS.map((r) => (
          <option key={r.valor} value={r.valor}>
            {r.texto}
          </option>
        ))}
      </select>
    </label>
  );
}

/* La caja de ajustes del canal. Las formas de pago se despliegan aparte: son
   una lista de cuatro renglones y cerrada no le roba altura a la tabla. */
export function AjustesTiendaNube({ tn, onCambiar }) {
  const [abierto, setAbierto] = useState(false);
  const formas = tn.formas ?? [];
  const cambiar = (campos) => onCambiar({ ...tn, ...campos });
  const cambiarForma = (id, campos) =>
    cambiar({ formas: formas.map((f) => (f.id === id ? { ...f, ...campos } : f)) });

  return (
    <div
      className="rounded-[4px] border px-3 py-2.5"
      style={{ background: "var(--zona-tn)", borderColor: "var(--zona-tn-honda)" }}
    >
      <span className="k-col mb-2 block" style={{ color: "var(--tinta)" }}>
        Tiendanube
      </span>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="block">
          {rotulo("Envio gratis")}
          <div className="w-[96px]">
            <NumberCell value={tn.envioGratis || 0} onChange={(v) => cambiar({ envioGratis: v })} />
          </div>
        </label>
        <label className="block" title="Se suma a la comision de cada forma de pago, y lleva IVA">
          {rotulo("Comision TN")}
          <div className="w-[80px]">
            <NumberCell
              value={+((tn.comision || 0) * 100).toFixed(2)}
              onChange={(v) => cambiar({ comision: v / 100 })}
              suffix="%"
            />
          </div>
        </label>
        <SelectorRedondeo valor={tn.redondeo} onCambiar={(redondeo) => cambiar({ redondeo })} />
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          className="k-col flex items-center gap-1 rounded-[3px] border px-2.5 py-[7px] transition"
          style={{ borderColor: "var(--zona-tn-honda)", color: "var(--tinta)", background: "var(--papel)" }}
        >
          Formas de pago ({formas.length})
          <ChevronDown size={13} style={{ transform: abierto ? "rotate(180deg)" : undefined }} />
        </button>
      </div>
      <p className="mt-1.5 max-w-[420px] text-[11px]" style={{ color: "var(--humo)" }}>
        El envio gratis lo pagas vos: entra en la cuenta. El precio sale de la forma de pago
        que mas te cobra.
      </p>

      {abierto && (
        <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--zona-tn-honda)" }}>
          <p className="mb-2 max-w-[560px] text-[11px]" style={{ color: "var(--humo)" }}>
            Comision como figura en la pantalla del medio de pago, <b>sin IVA</b> (se suma sola).
            Si hay varias —comision + financiacion o CPT— sumalas. "Desde" es la compra minima
            para que aplique (0 = siempre).
          </p>
          <div
            className="grid items-end gap-x-2 gap-y-2"
            style={{ gridTemplateColumns: "minmax(220px,1fr) 88px 80px 104px 28px" }}
          >
            {rotulo("Forma de pago")}
            {rotulo("Comision")}
            {rotulo("Descuento")}
            {rotulo("Desde")}
            <span />
            {formas.map((f) => (
              <FilaForma
                key={f.id}
                forma={f}
                tn={tn}
                onCambiar={(campos) => cambiarForma(f.id, campos)}
                onQuitar={() => cambiar({ formas: formas.filter((x) => x.id !== f.id) })}
              />
            ))}
          </div>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() =>
                cambiar({
                  formas: [
                    ...formas,
                    { id: crypto.randomUUID(), nombre: "Nueva forma de pago", comision: 0, descuento: 0, minimo: 0 },
                  ],
                })
              }
              className="k-col flex items-center gap-1 rounded-[3px] border border-dashed px-2.5 py-[6px] transition"
              style={{ borderColor: "var(--humo-claro)", color: "var(--tinta)" }}
            >
              <Plus size={13} /> Agregar forma de pago
            </button>
            <button
              type="button"
              onClick={() => cambiar({ formas: FORMAS_TN_POR_DEFECTO.map((f) => ({ ...f })) })}
              className="k-col rounded-[3px] border px-2.5 py-[6px] transition"
              style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
            >
              Volver a los ejemplos
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilaForma({ forma, tn, onCambiar, onQuitar }) {
  return (
    <>
      <input
        value={forma.nombre}
        onChange={(e) => onCambiar({ nombre: e.target.value })}
        aria-label="Nombre de la forma de pago"
        className="w-full rounded-[3px] border px-2 py-1.5 text-[12.5px]"
        style={{ background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" }}
      />
      <div title={`Con IVA: ${porcentaje(comisionRealTN(forma, tn))}`}>
        <NumberCell
          value={+((forma.comision || 0) * 100).toFixed(2)}
          onChange={(v) => onCambiar({ comision: v / 100 })}
          suffix="%"
        />
      </div>
      <NumberCell
        value={+((forma.descuento || 0) * 100).toFixed(2)}
        onChange={(v) => onCambiar({ descuento: v / 100 })}
        suffix="%"
      />
      <NumberCell value={forma.minimo || 0} onChange={(v) => onCambiar({ minimo: v })} />
      <button
        type="button"
        onClick={onQuitar}
        title={`Quitar "${forma.nombre}"`}
        aria-label={`Quitar ${forma.nombre}`}
        className="rounded-[3px] p-1 transition"
        style={{ color: "var(--humo)" }}
      >
        <X size={14} />
      </button>
      {/* El IVA a la vista debajo de cada comisión: es el número que de verdad se cobra. */}
      <span />
      <span className="k-num -mt-1.5 text-right text-[10.5px]" style={{ color: "var(--humo-claro)" }}>
        = {porcentaje(comisionRealTN(forma, tn))} c/IVA
      </span>
      <span className="col-span-3" />
    </>
  );
}

/* El detalle de un precio de Tiendanube: qué pasa con cada forma de pago.
   En un portal al body: la fila del catálogo tiene `overflow: hidden`. */
export function DetalleTiendaNube({ perfume, precio, tn, onCerrar }) {
  const [copiado, setCopiado] = useState(false);
  const r = analisisTiendaNube({ costo: perfume.costo, precio, ajustesTN: tn });
  const costo = Number(perfume.costo) || 0;
  const envio = Number(tn.envioGratis) || 0;
  const define = r.define >= 0 ? r.formas[r.define] : null;

  useEffect(() => {
    const tecla = (e) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);

  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 1600);
    return () => clearTimeout(t);
  }, [copiado]);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(String(Math.round(precio)));
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };

  const th = "k-col px-2.5 py-2 text-right font-normal";
  const td = "k-num px-2.5 py-2 text-right text-[12.5px]";

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center p-4"
      style={{ background: "rgba(34,32,28,0.35)" }}
      onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Tiendanube · ${perfume.nombre}`}
        className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-[6px] border shadow-xl"
        style={{ background: "var(--papel)", borderColor: "var(--linea)" }}
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4" style={{ background: "var(--zona-tn)" }}>
          <div>
            <span className="k-col block" style={{ color: "var(--humo)" }}>
              Tiendanube · {perfume.nombre}
            </span>
            <span className="k-col mt-2 block" style={{ color: "var(--humo)" }}>
              Precio de venta
            </span>
            <div className="flex items-center gap-3">
              <span className="k-num text-[34px] font-semibold leading-tight" style={{ color: "var(--tinta)" }}>
                {pesos(precio)}
              </span>
              <button
                type="button"
                onClick={copiar}
                className="k-col rounded-[3px] px-3 py-[7px] text-white transition"
                style={{ background: "var(--tinta)" }}
              >
                {copiado ? "Copiado" : "Copiar número"}
              </button>
            </div>
            {r.ganancia !== null && (
              <p className="mt-1 text-[12.5px] font-semibold" style={{ color: r.ganancia >= 0 ? "var(--ambar)" : "var(--oxido)" }}>
                Vas a ganar al menos <span className="k-num">{pesos(r.ganancia)}</span> por venta
              </p>
            )}
            {define && (
              <p className="mt-1 max-w-[640px] text-[12px]" style={{ color: "var(--humo)" }}>
                Lo define "{define.forma.nombre}", la que más te cobra. Con esa te quedan{" "}
                <span className="k-num">{pesos(define.llega)}</span> ({pesos(costo)} de costo
                {envio > 0 ? ` + ${pesos(envio)} de envío` : ""} + {pesos(define.ganancia)} de ganancia).
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded-[3px] p-1 transition"
            style={{ color: "var(--humo)" }}
          >
            <X size={18} />
          </button>
        </div>

        <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--linea)", color: "var(--humo)" }}>
              <th className={`${th} text-left`}>Si paga con</th>
              <th className={th}>Paga el cliente</th>
              <th className={th}>Comisión</th>
              <th className={th}>IVA</th>
              <th className={th}>Total comisión</th>
              <th className={th}>Te llega</th>
              <th className={th}>{envio > 0 ? "Ganás (ya sin envío)" : "Ganás"}</th>
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
                      define el precio
                    </span>
                  )}
                </td>
              );
              if (!f.valida)
                return (
                  <tr key={f.forma.id} className="border-b" style={{ borderColor: "var(--linea)" }}>
                    {nombre}
                    <td colSpan={6} className="px-2.5 py-2 text-[12px]" style={{ color: "var(--oxido)" }}>
                      Revisá los porcentajes: comisión más descuento no pueden llegar al 100%.
                    </td>
                  </tr>
                );
              if (!f.aplica)
                return (
                  <tr key={f.forma.id} className="border-b" style={{ borderColor: "var(--linea)" }}>
                    {nombre}
                    <td colSpan={6} className="px-2.5 py-2 text-[12px]" style={{ color: "var(--humo-claro)" }}>
                      No aplica: la compra es menor a {pesos(f.minimo)}
                    </td>
                  </tr>
                );
              return (
                <tr
                  key={f.forma.id}
                  className="border-b"
                  style={{
                    borderColor: "var(--linea)",
                    background: i === r.define ? "var(--zona-tn)" : undefined,
                  }}
                >
                  {nombre}
                  <td className={td} style={{ color: "var(--tinta)" }}>
                    {pesos(f.paga)}
                    {(Number(f.forma.descuento) || 0) > 0 && (
                      <small className="block text-[10.5px]" style={{ color: "var(--humo-claro)" }}>
                        −{porcentaje(f.forma.descuento)} desc.
                      </small>
                    )}
                  </td>
                  <td className={td} style={{ color: "var(--humo)" }}>
                    −{pesos(f.comision)}
                    <small className="block text-[10.5px]" style={{ color: "var(--humo-claro)" }}>
                      {porcentaje(f.tasaBase)}
                    </small>
                  </td>
                  <td className={td} style={{ color: "var(--humo)" }}>
                    −{pesos(f.iva)}
                    <small className="block text-[10.5px]" style={{ color: "var(--humo-claro)" }}>
                      {porcentaje(IVA)}
                    </small>
                  </td>
                  <td className={td} style={{ color: "var(--tinta)" }}>
                    <b>−{pesos(f.total)}</b>
                    <small className="block text-[10.5px]" style={{ color: "var(--humo-claro)" }}>
                      {porcentaje(f.tasaReal)}
                    </small>
                  </td>
                  <td className={td} style={{ color: "var(--tinta)" }}>
                    {pesos(f.llega)}
                  </td>
                  <td
                    className={`${td} font-semibold`}
                    style={{ color: f.ganancia === null ? "var(--humo-claro)" : f.ganancia >= 0 ? "var(--ambar)" : "var(--oxido)" }}
                  >
                    {f.ganancia === null ? "—" : pesos(f.ganancia)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="px-5 py-3 text-[11.5px]" style={{ color: "var(--humo)" }}>
          El precio sale de la forma de pago que más te cuesta: con todas las demás ganás igual o más.
        </p>
      </div>
    </div>,
    document.body
  );
}
