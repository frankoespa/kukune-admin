import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, X, ChevronDown } from "lucide-react";
import { CampoProtegido } from "./CampoProtegido";
import { NumberCell } from "./NumberCell";
import { analisisTiendaNube, comisionRealTN, IVA } from "./precios";
import { pctSinMiles } from "./numeros";

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
   una lista de cuatro renglones y cerrada no le roba altura a la tabla.

   Todo lo que se tipea va detrás de un doble clic (`CampoProtegido`): cada uno
   de estos números mueve el precio de todos los perfumes con margen clavado.
   Quitar una forma de pago pide confirmación, por la misma razón. */
export function AjustesTiendaNube({ tn, onCambiar, onConfirmar }) {
  const [abierto, setAbierto] = useState(false);
  // La forma recién agregada nace con el nombre abierto para escribir.
  const [recienCreada, setRecienCreada] = useState(null);
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
        <div className="block">
          {rotulo("Envio gratis")}
          <div className="w-[104px]">
            <CampoProtegido
              valor={tn.envioGratis || 0}
              onCambiar={(v) => cambiar({ envioGratis: v })}
              mostrar={pesos}
              etiqueta="el envio gratis"
            />
          </div>
        </div>
        <div className="block" title="Se suma a la comision de cada forma de pago, y lleva IVA">
          {rotulo("Comision TN")}
          <div className="w-[88px]">
            <CampoProtegido
              valor={+((tn.comision || 0) * 100).toFixed(2)}
              onCambiar={(v) => cambiar({ comision: v / 100 })}
              mostrar={(v) => porcentaje((v || 0) / 100)}
              suffix="%"
              etiqueta="la comision de Tiendanube"
            />
          </div>
        </div>
        <SelectorRedondeo valor={tn.redondeo} onCambiar={(redondeo) => cambiar({ redondeo })} />
        {/* Solo el que se PROPONE al mandar precios con promoción: no cambia
            ninguna cuenta ni ningún precio del catálogo. */}
        <div className="block" title="El que se propone al mandar precios a Tiendanube con precio promocional. No cambia ninguna cuenta.">
          {rotulo("Descuento a mostrar")}
          <div className="w-[88px]">
            <CampoProtegido
              valor={+((tn.descuentoMostrado ?? 0.2) * 100).toFixed(2)}
              onCambiar={(v) => cambiar({ descuentoMostrado: Math.min(Math.max(v, 0), 90) / 100 })}
              mostrar={(v) => porcentaje((v || 0) / 100)}
              suffix="%"
              etiqueta="el descuento a mostrar"
            />
          </div>
        </div>
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
                nueva={f.id === recienCreada}
                onCambiar={(campos) => cambiarForma(f.id, campos)}
                onQuitar={() =>
                  onConfirmar({
                    titulo: `¿Quitar "${f.nombre}" de las formas de pago?`,
                    texto: "Los precios de Tiendanube con margen clavado se recalculan sin ella.",
                    etiquetaOk: "Quitar",
                    peligro: true,
                    onAceptar: () => cambiar({ formas: formas.filter((x) => x.id !== f.id) }),
                  })
                }
              />
            ))}
          </div>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={() => {
                const id = crypto.randomUUID();
                setRecienCreada(id);
                cambiar({
                  formas: [...formas, { id, nombre: "Nueva forma de pago", comision: 0, descuento: 0, minimo: 0 }],
                });
              }}
              className="k-col flex items-center gap-1 rounded-[3px] border border-dashed px-2.5 py-[6px] transition"
              style={{ borderColor: "var(--humo-claro)", color: "var(--tinta)" }}
            >
              <Plus size={13} /> Agregar forma de pago
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilaForma({ forma, tn, nueva, onCambiar, onQuitar }) {
  const pct = (v) => porcentaje((v || 0) / 100);
  return (
    <>
      <CampoProtegido
        texto
        valor={forma.nombre}
        onCambiar={(v) => onCambiar({ nombre: v })}
        mostrar={(v) => v || "Sin nombre"}
        etiqueta="el nombre de la forma de pago"
        abiertoAlInicio={nueva}
      />
      <div title={`Con IVA: ${porcentaje(comisionRealTN(forma, tn))}`}>
        <CampoProtegido
          valor={+((forma.comision || 0) * 100).toFixed(2)}
          onCambiar={(v) => onCambiar({ comision: v / 100 })}
          mostrar={pct}
          suffix="%"
          etiqueta={`la comision de ${forma.nombre}`}
        />
      </div>
      <CampoProtegido
        valor={+((forma.descuento || 0) * 100).toFixed(2)}
        onCambiar={(v) => onCambiar({ descuento: v / 100 })}
        mostrar={pct}
        suffix="%"
        etiqueta={`el descuento de ${forma.nombre}`}
      />
      <CampoProtegido
        valor={forma.minimo || 0}
        onCambiar={(v) => onCambiar({ minimo: v })}
        mostrar={pesos}
        etiqueta={`el minimo de ${forma.nombre}`}
      />
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
  /* Cupón simulado: vale para todas las formas de pago y se acumula con su
     descuento. Es una prueba —vive solo mientras el panel está abierto— y no
     toca ningún precio. Porcentaje en número entero (10 = 10%), monto en pesos. */
  const [cupon, setCupon] = useState({ porcentaje: 0, monto: 0, combinable: true });
  const conCupon = cupon.porcentaje > 0 || cupon.monto > 0;
  // Sin cupón: lo que define el precio. Con cupón: lo que te queda si lo usan.
  const base = analisisTiendaNube({ costo: perfume.costo, precio, ajustesTN: tn });
  const r = conCupon
    ? analisisTiendaNube({
        costo: perfume.costo,
        precio,
        ajustesTN: tn,
        cupon: { porcentaje: cupon.porcentaje / 100, monto: cupon.monto, combinable: cupon.combinable },
      })
    : base;
  const costo = Number(perfume.costo) || 0;
  const envio = Number(tn.envioGratis) || 0;
  const define = base.define >= 0 ? base.formas[base.define] : null;

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
                {conCupon ? "Con el cupón ganás al menos " : "Vas a ganar al menos "}
                <span className="k-num">{pesos(r.ganancia)}</span> por venta
                {r.margen !== null && <span className="k-num"> ({pctSinMiles(r.margen, 1)})</span>}
                {conCupon && base.ganancia !== null && (
                  <span className="font-normal" style={{ color: "var(--humo)" }}>
                    {" "}
                    · sin cupón <span className="k-num">{pesos(base.ganancia)}</span>
                    <span className="k-num"> ({pctSinMiles(base.margen, 1)})</span>
                  </span>
                )}
              </p>
            )}
            {define && (
              <p className="mt-1 max-w-[640px] text-[12px]" style={{ color: "var(--humo)" }}>
                Lo define "{define.forma.nombre}", la que más te cobra. Con esa te quedan{" "}
                <span className="k-num">{pesos(define.llega)}</span> ({pesos(costo)} de costo
                {envio > 0 ? ` + ${pesos(envio)} de envío` : ""} + {pesos(define.ganancia)} de ganancia).
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <span className="k-col pb-2" style={{ color: "var(--tinta)" }}>
                Simular cupón
              </span>
              <label className="block w-[80px]" title="Porcentaje del cupón">
                <NumberCell
                  value={cupon.porcentaje}
                  onChange={(v) => setCupon((c) => ({ ...c, porcentaje: Math.max(0, Math.min(100, v)) }))}
                  suffix="%"
                />
              </label>
              <span className="k-col pb-2" style={{ color: "var(--humo)" }}>
                +
              </span>
              <label className="block w-[104px]" title="Monto fijo del cupón, en pesos">
                <NumberCell
                  value={cupon.monto}
                  onChange={(v) => setCupon((c) => ({ ...c, monto: Math.max(0, v) }))}
                  suffix="$"
                />
              </label>
              {conCupon && (
                <button
                  type="button"
                  onClick={() => setCupon((c) => ({ ...c, porcentaje: 0, monto: 0 }))}
                  className="k-col mb-1 rounded-[3px] border px-2.5 py-[5px] transition"
                  style={{ borderColor: "var(--linea)", color: "var(--humo)", background: "var(--papel)" }}
                >
                  Quitar cupón
                </button>
              )}
              <label
                className="flex w-full cursor-pointer items-center gap-1.5 text-[12px]"
                style={{ color: "var(--tinta)" }}
                title="Como la casilla 'Combinar con' de la promoción en Tiendanube"
              >
                <input
                  type="checkbox"
                  checked={cupon.combinable}
                  onChange={(e) => setCupon((c) => ({ ...c, combinable: e.target.checked }))}
                />
                Se combina con el descuento del medio de pago
              </label>
              <span className="w-full text-[11px]" style={{ color: "var(--humo)" }}>
                Vale para todas las formas de pago. Primero se aplica el cupón y después,
                si se combina, el descuento de la forma de pago sobre lo que quedó; si no se
                combina, la forma pierde su descuento. Es una prueba: no cambia el precio
                ni se guarda.
              </span>
            </div>
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

        <table className="w-full min-w-[800px] border-collapse">
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--linea)", color: "var(--humo)" }}>
              <th className={`${th} text-left`}>Si paga con</th>
              <th className={th}>Paga el cliente</th>
              <th className={th}>Comisión</th>
              <th className={th}>IVA</th>
              <th className={th}>Total comisión</th>
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
                      {conCupon ? "la que menos deja" : "define el precio"}
                    </span>
                  )}
                </td>
              );
              if (!f.valida)
                return (
                  <tr key={f.forma.id} className="border-b" style={{ borderColor: "var(--linea)" }}>
                    {nombre}
                    <td colSpan={7} className="px-2.5 py-2 text-[12px]" style={{ color: "var(--oxido)" }}>
                      Revisá los porcentajes: comisión más descuento no pueden llegar al 100%.
                    </td>
                  </tr>
                );
              if (!f.aplica)
                return (
                  <tr key={f.forma.id} className="border-b" style={{ borderColor: "var(--linea)" }}>
                    {nombre}
                    <td colSpan={7} className="px-2.5 py-2 text-[12px]" style={{ color: "var(--humo-claro)" }}>
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
                    {(() => {
                      // Qué se descontó del precio: el de la forma y el del cupón.
                      // En el orden en que se aplican: primero el cupón.
                      const partes = [];
                      if (conCupon && cupon.porcentaje > 0) partes.push(`−${porcentaje(cupon.porcentaje / 100)} cupón`);
                      if (conCupon && cupon.monto > 0) partes.push(`−${pesos(cupon.monto)} cupón`);
                      if ((Number(f.forma.descuento) || 0) > 0)
                        partes.push(
                          f.conDescuento
                            ? `−${porcentaje(f.forma.descuento)} desc.`
                            : `sin su −${porcentaje(f.forma.descuento)} (no combina)`
                        );
                      return partes.length ? (
                        <small className="block text-[10.5px]" style={{ color: "var(--humo-claro)" }}>
                          {partes.join(" · ")}
                        </small>
                      ) : null;
                    })()}
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
                  {/* Ganancia sobre el costo: la misma base que la columna Margen del
                      catálogo, así los números se comparan tal cual. */}
                  <td
                    className={td}
                    style={{
                      color:
                        f.ganancia === null ? "var(--humo-claro)" : f.ganancia >= 0 ? "var(--verde)" : "var(--oxido)",
                    }}
                  >
                    {f.ganancia === null || !(costo > 0) ? "—" : pctSinMiles(f.ganancia / costo, 1)}
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
