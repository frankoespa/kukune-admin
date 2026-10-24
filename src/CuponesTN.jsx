import { useMemo, useState } from "react";
import { ChevronDown, Plus, RefreshCw } from "lucide-react";
import { NumberCell } from "./NumberCell";
import { estadoDeCupon, impactoDeCupon } from "./precios";
import { condicionesDeCupon, describirCupon, pesos } from "./TiendaNube";
import { crearCuponTN, editarCuponTN, vinculoTN } from "./clienteTN";

/* ============================================================
   Los cupones de la tienda (API "Coupons" 2025-03), en la pestaña Tiendanube.

   · Lista con estado y condiciones, y para cada cupón vigente el AVISO DE
     PÉRDIDA: qué le queda a cada perfume si lo usan pagando con la forma que
     menos deja (`impactoDeCupon` en precios.js).
   · Crear y editar: ESCRIBE EN TIENDANUBE, siempre con confirmación y mostrando
     antes el mismo aviso con el cupón como quedaría. No se borran desde acá:
     se desactivan o se borran en Tiendanube.
   · Las promociones del panel (2x1, progresivo) no están en la API: se simulan
     en el detalle de cada precio, no se listan acá.
   ============================================================ */

const COLOR_ESTADO = { vigente: "var(--verde)", desactivado: "var(--humo-claro)", "por empezar": "var(--humo)", vencido: "var(--humo-claro)", agotado: "var(--humo-claro)" };
const caja = { borderColor: "var(--linea)", background: "var(--papel)", color: "var(--tinta)" };
const boton = "k-col rounded-[3px] border px-2.5 py-[5px] transition disabled:opacity-40";

export default function CuponesTN({ cupones, error, cargando, perfumes, ajustesTN, productos, onRecargar, onConfirmar, onReconectar }) {
  const [abierto, setAbierto] = useState(null); // id del cupón con el aviso desplegado
  const [editando, setEditando] = useState(null); // null | "nuevo" | cupón

  return (
    <div className="mb-5 rounded-[4px] border px-4 py-3" style={{ borderColor: "var(--linea)", background: "var(--papel)" }}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="k-rotulo">Cupones de la tienda</span>
        <button type="button" onClick={onRecargar} disabled={cargando} className={`${boton} ml-auto flex items-center gap-1`} style={{ borderColor: "var(--linea)", color: "var(--humo)" }}>
          <RefreshCw size={11} className={cargando ? "animate-spin" : ""} /> Volver a leer
        </button>
        <button type="button" onClick={() => setEditando("nuevo")} disabled={!!error || !cupones} className={`${boton} flex items-center gap-1`} style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}>
          <Plus size={11} /> Nuevo cupón
        </button>
      </div>

      {error && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[12.5px]" style={{ color: "var(--oxido)" }}>
            {error}
          </p>
          {onReconectar && /permiso/i.test(error) && (
            <button type="button" onClick={onReconectar} className={boton} style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}>
              Volver a conectar
            </button>
          )}
        </div>
      )}
      {!error && !cupones && (
        <p className="text-[12.5px]" style={{ color: "var(--humo)" }}>
          Leyendo los cupones…
        </p>
      )}
      {!error && cupones?.length === 0 && (
        <p className="text-[12.5px]" style={{ color: "var(--humo)" }}>
          La tienda no tiene cupones.
        </p>
      )}

      {cupones?.length > 0 && (
        <ul className="grid gap-1.5">
          {cupones.map((c) => (
            <FilaCupon
              key={c.id}
              cupon={c}
              abierto={abierto === c.id}
              onAbrir={() => setAbierto((a) => (a === c.id ? null : c.id))}
              onEditar={() => setEditando(c)}
              perfumes={perfumes}
              ajustesTN={ajustesTN}
              productos={productos}
            />
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px]" style={{ color: "var(--humo)" }}>
        El aviso cuenta cada perfume con precio pagando con la forma que menos te deja y usando el cupón. Las promociones por cantidad
        (2x1, progresivo) no se pueden leer de Tiendanube: probalas en el detalle de cada precio.
      </p>

      {editando && (
        <FormCupon
          cupon={editando === "nuevo" ? null : editando}
          perfumes={perfumes}
          ajustesTN={ajustesTN}
          productos={productos}
          onCerrar={() => setEditando(null)}
          onConfirmar={onConfirmar}
          onGuardado={() => {
            setEditando(null);
            onRecargar();
          }}
        />
      )}
    </div>
  );
}

function FilaCupon({ cupon, abierto, onAbrir, onEditar, perfumes, ajustesTN, productos }) {
  const estado = estadoDeCupon(cupon);
  const cuenta = estado === "vigente" && cupon.type !== "shipping";
  const impacto = useMemo(() => (cuenta ? impactoDeCupon(cupon, perfumes, ajustesTN, productos) : null), [cuenta, cupon, perfumes, ajustesTN, productos]);
  return (
    <li className="rounded-[3px] border px-3 py-2" style={{ borderColor: "var(--linea)" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
        <b className="k-num" style={{ color: "var(--tinta)" }}>
          {cupon.code}
        </b>
        <span className="k-num" style={{ color: "var(--tinta)" }}>
          {describirCupon(cupon)}
        </span>
        <span style={{ color: "var(--humo)" }}>{condicionesDeCupon(cupon)}</span>
        <span className="k-col rounded-full px-1.5 py-px text-[9px]" style={{ background: COLOR_ESTADO[estado], color: "var(--papel)" }}>
          {estado}
        </span>
        <button type="button" onClick={onEditar} className={`${boton} ml-auto`} style={{ borderColor: "var(--linea)", color: "var(--humo)" }}>
          Editar
        </button>
      </div>
      {cupon.type === "shipping" && (
        <p className="mt-1 text-[11.5px]" style={{ color: "var(--humo)" }}>
          Es de envío gratis: no cambia tu cuenta, la app ya supone que el envío lo pagás vos.
        </p>
      )}
      {impacto && <AvisoDePerdida impacto={impacto} abierto={abierto} onAbrir={onAbrir} />}
    </li>
  );
}

/* "Con este cupón, N pierden y el que menos deja gana $X", desplegable a la
   lista de peor a mejor. Ganancia en ámbar; en óxido si es negativa. */
function AvisoDePerdida({ impacto, abierto, onAbrir }) {
  const { filas, pierden, peor, noSeSabe } = impacto;
  const nombresFormas = filas[0]?.formas.map((fo) => fo.nombre) ?? [];
  const nFormas = nombresFormas.length;
  if (!filas.length && !noSeSabe.length)
    return (
      <p className="mt-1 text-[11.5px]" style={{ color: "var(--humo)" }}>
        No le aplica a ningún perfume con precio.
      </p>
    );
  return (
    <div className="mt-1">
      <button type="button" onClick={onAbrir} className="flex items-center gap-1 text-left text-[12px]" style={{ color: pierden ? "var(--oxido)" : "var(--tinta)" }}>
        <ChevronDown size={12} style={{ transform: abierto ? "rotate(180deg)" : "none" }} />
        {pierden ? `${pierden} de ${filas.length} perfumes pierden plata con este cupón` : `Ningún perfume pierde (${filas.length} con precio)`}
        {peor && (
          <span style={{ color: "var(--humo)" }}>
            {" "}
            · el que menos deja: {peor.perfume.nombre},{" "}
            <span className="k-num" style={{ color: peor.ganancia < 0 ? "var(--oxido)" : "var(--ambar)" }}>
              {pesos(peor.ganancia)}
            </span>
          </span>
        )}
      </button>
      {abierto && (
        <div data-scroll className="mt-1.5 max-h-[300px] overflow-auto rounded-[3px] border" style={{ borderColor: "var(--linea)" }}>
          {/* Una columna por forma de pago, con la ganancia usando el cupón. La que
              menos deja de cada perfume va subrayada; el title dice cuánto dejaba
              sin el cupón. Columnas en línea: la cantidad de formas varía. */}
          <div
            className="sticky top-0 grid min-w-max items-end gap-x-3 border-b px-2 py-1"
            style={{ gridTemplateColumns: columnasAviso(nFormas), background: "var(--papel)", borderColor: "var(--linea)" }}
          >
            <span className="k-col" style={{ color: "var(--humo)" }}>
              Perfume
            </span>
            {nombresFormas.map((n) => (
              <span key={n} className="k-col truncate text-right" style={{ color: "var(--humo)" }} title={n}>
                {nombreCorto(n)}
              </span>
            ))}
          </div>
          {filas.map((f) => (
            <div key={f.perfume.id} className="grid min-w-max items-center gap-x-3 px-2 py-1 text-[12px]" style={{ gridTemplateColumns: columnasAviso(nFormas) }}>
              <span className="truncate" style={{ color: "var(--tinta)" }} title={f.aplicaMinimo ? f.perfume.nombre : "No llega al mínimo del cupón: no se aplica"}>
                {f.perfume.nombre}
                {!f.aplicaMinimo && (
                  <span className="ml-1 text-[11px]" style={{ color: "var(--humo-claro)" }}>
                    (no llega al mínimo)
                  </span>
                )}
              </span>
              {f.formas.map((fo, i) =>
                fo.ganancia === null ? (
                  <span key={i} className="k-num text-right" style={{ color: "var(--humo-claro)" }} title={`${fo.nombre}: no aplica`}>
                    —
                  </span>
                ) : (
                  <span
                    key={i}
                    className={`k-num text-right ${i === f.define ? "font-semibold underline decoration-dotted underline-offset-2" : ""}`}
                    style={{ color: fo.ganancia < 0 ? "var(--oxido)" : "var(--ambar)" }}
                    title={`${fo.nombre}: con el cupón ${pesos(fo.ganancia)}${fo.sinCupon !== null ? ` · sin cupón ${pesos(fo.sinCupon)}` : ""}${
                      i === f.define ? " · la que menos deja" : ""
                    }`}
                  >
                    {pesos(fo.ganancia)}
                  </span>
                )
              )}
            </div>
          ))}
          {noSeSabe.length > 0 && (
            <p className="border-t px-2 py-1 text-[11.5px]" style={{ borderColor: "var(--linea)", color: "var(--humo-claro)" }}>
              Sin vincular, no se sabe si les aplica: {noSeSabe.map((p) => p.nombre).join(", ")}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const aFecha = (v) => (v ? String(v).slice(0, 10) : "");

/* Perfume + una columna por forma de pago. Todo de ancho fijo: con `min-w-max`
   cada fila arma su propia grilla, y un `1fr` haría que un nombre largo corra
   las columnas de su fila. */
const columnasAviso = (n) => `230px repeat(${n}, 112px)`;
// "Mercado Pago 18 días (3,46% + CPT 2%)" → "Mercado Pago 18 días": el nombre
// entero queda en el title.
const nombreCorto = (n) => String(n).split(/\s[·(]/)[0];

/* Crear o editar un cupón. Antes de guardar muestra el aviso de pérdida con el
   cupón como quedaría, y confirma con `Dialogo`. */
function FormCupon({ cupon, perfumes, ajustesTN, productos, onCerrar, onConfirmar, onGuardado }) {
  const productosDe = (lista) => (lista ?? []).map((x) => Number(typeof x === "object" ? x.id : x));
  const categoriasActuales = productosDe(cupon?.categories);
  const [f, setF] = useState(() => ({
    code: cupon?.code ?? "",
    type: cupon?.type ?? "percentage",
    value: Number(cupon?.value) || 0,
    min_price: Number(cupon?.min_price) || 0,
    start_date: aFecha(cupon?.start_date),
    end_date: aFecha(cupon?.end_date),
    max_uses: cupon?.max_uses ?? "",
    first_consumer_purchase: !!cupon?.first_consumer_purchase,
    combines_with_other_discounts: cupon?.combines_with_other_discounts !== false,
    valid: cupon?.valid !== false,
    products: productosDe(cupon?.products),
  }));
  const [alcance, setAlcance] = useState(categoriasActuales.length ? "categorias" : f.products.length ? "productos" : "toda");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");
  const cambiar = (campos) => setF((x) => ({ ...x, ...campos }));

  // Perfumes vinculados a un producto de Tiendanube: los únicos que se pueden elegir.
  const vinculados = perfumes.filter((p) => vinculoTN(p));
  const pedido = {
    ...f,
    max_uses: f.max_uses === "" || f.max_uses == null ? null : Number(f.max_uses),
    min_price: f.min_price || null,
    start_date: f.start_date || null,
    end_date: f.end_date || null,
    products: alcance === "productos" ? f.products : [],
    categories: alcance === "categorias" ? categoriasActuales : [],
  };
  const impacto = useMemo(
    () => (pedido.type !== "shipping" && Number(pedido.value) > 0 ? impactoDeCupon(pedido, perfumes, ajustesTN, productos) : null),
    [JSON.stringify(pedido), perfumes, ajustesTN, productos] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const guardar = () =>
    onConfirmar({
      titulo: cupon ? `Cambiar el cupón ${cupon.code} en Tiendanube` : `Crear el cupón ${pedido.code} en Tiendanube`,
      texto:
        `${pedido.code}: ${describirCupon(pedido)} · ${condicionesDeCupon(pedido)}. ` +
        (impacto ? (impacto.pierden ? `Con este cupón ${impacto.pierden} perfumes pierden plata. ` : "Ningún perfume pierde plata con este cupón. ") : "") +
        "Se cambia en la tienda real.",
      etiquetaOk: cupon ? "Cambiar cupón" : "Crear cupón",
      peligro: !!impacto?.pierden,
      onAceptar: async () => {
        setTrabajando(true);
        setError("");
        try {
          if (cupon) await editarCuponTN(cupon.id, pedido);
          else await crearCuponTN(pedido);
          onGuardado();
        } catch (e) {
          setError(e.message);
        } finally {
          setTrabajando(false);
        }
      },
    });

  const etiqueta = (texto) => (
    <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
      {texto}
    </span>
  );
  const codigoValido = /^[A-Za-z0-9]+$/.test(f.code);
  const valorValido = f.type === "shipping" || (Number(f.value) > 0 && (f.type !== "percentage" || Number(f.value) <= 100));
  const listo = codigoValido && valorValido && !(alcance === "productos" && !f.products.length);

  return (
    <div className="mt-3 rounded-[3px] border px-3 py-3" style={{ borderColor: "var(--tinta)" }}>
      <span className="k-rotulo mb-2 block">{cupon ? `Editar ${cupon.code}` : "Nuevo cupón"}</span>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="block">
          {etiqueta("Código (letras y números)")}
          <input
            value={f.code}
            onChange={(e) => cambiar({ code: e.target.value.toUpperCase() })}
            className="w-full rounded-[3px] border px-2 py-1.5 text-[12.5px] k-num"
            style={{ ...caja, borderColor: f.code && !codigoValido ? "var(--oxido)" : "var(--linea)" }}
          />
        </label>
        <label className="block">
          {etiqueta("Tipo")}
          <select value={f.type} onChange={(e) => cambiar({ type: e.target.value })} className="w-full rounded-[3px] border px-2 py-[7px] text-[12.5px]" style={caja}>
            <option value="percentage">Porcentaje</option>
            <option value="absolute">Monto fijo</option>
            <option value="shipping">Envío gratis</option>
          </select>
        </label>
        {f.type !== "shipping" && (
          <label className="block">
            {etiqueta(f.type === "percentage" ? "Descuento" : "Monto")}
            <NumberCell value={f.value} onChange={(v) => cambiar({ value: Math.max(0, v) })} suffix={f.type === "percentage" ? "%" : "$"} />
          </label>
        )}
        <label className="block">
          {etiqueta("Compra mínima")}
          <NumberCell value={f.min_price} onChange={(v) => cambiar({ min_price: Math.max(0, v) })} suffix="$" />
        </label>
        <label className="block">
          {etiqueta("Desde")}
          <input type="date" value={f.start_date} onChange={(e) => cambiar({ start_date: e.target.value })} className="w-full rounded-[3px] border px-2 py-1.5 text-[12.5px]" style={caja} />
        </label>
        <label className="block">
          {etiqueta("Hasta")}
          <input type="date" value={f.end_date} onChange={(e) => cambiar({ end_date: e.target.value })} className="w-full rounded-[3px] border px-2 py-1.5 text-[12.5px]" style={caja} />
        </label>
        <label className="block">
          {etiqueta("Usos (vacío = sin límite)")}
          <input
            value={f.max_uses ?? ""}
            onChange={(e) => cambiar({ max_uses: e.target.value.replace(/\D/g, "") })}
            className="w-full rounded-[3px] border px-2 py-1.5 text-[12.5px] k-num"
            style={caja}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px]" style={{ color: "var(--tinta)" }}>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={f.combines_with_other_discounts} onChange={(e) => cambiar({ combines_with_other_discounts: e.target.checked })} />
          Se combina con otros descuentos (sin esto, el medio de pago pierde su descuento)
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={f.first_consumer_purchase} onChange={(e) => cambiar({ first_consumer_purchase: e.target.checked })} />
          Solo primera compra
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={f.valid} onChange={(e) => cambiar({ valid: e.target.checked })} />
          Activo
        </label>
      </div>

      <div className="mt-3">
        {etiqueta("A qué productos")}
        {alcance === "categorias" ? (
          <p className="text-[12px]" style={{ color: "var(--humo)" }}>
            Limitado a {categoriasActuales.length} categoría{categoriasActuales.length === 1 ? "" : "s"} de Tiendanube: se conserva tal cual (las
            categorías se cambian en Tiendanube).
          </p>
        ) : (
          <>
            <div className="mb-1.5 flex gap-4 text-[12.5px]" style={{ color: "var(--tinta)" }}>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={alcance === "toda"} onChange={() => setAlcance("toda")} /> Toda la tienda
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={alcance === "productos"} onChange={() => setAlcance("productos")} /> Solo los perfumes que elija
              </label>
            </div>
            {alcance === "productos" && (
              <div data-scroll className="grid max-h-[180px] grid-cols-2 gap-x-4 overflow-y-auto rounded-[3px] border px-2 py-1.5 md:grid-cols-3" style={{ borderColor: "var(--linea)" }}>
                {vinculados.map((p) => {
                  const id = Number(vinculoTN(p).productId);
                  const tildado = f.products.includes(id);
                  return (
                    <label key={p.id} className="flex items-center gap-1.5 truncate text-[12px]" style={{ color: "var(--tinta)" }}>
                      <input
                        type="checkbox"
                        checked={tildado}
                        onChange={() => cambiar({ products: tildado ? f.products.filter((x) => x !== id) : [...f.products, id] })}
                      />
                      {p.nombre}
                    </label>
                  );
                })}
                {!vinculados.length && (
                  <span className="text-[12px]" style={{ color: "var(--humo)" }}>
                    No hay perfumes vinculados a Tiendanube.
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {impacto && (
        <div className="mt-3">
          {etiqueta("Cómo quedaría")}
          <AvisoDePerdida impacto={impacto} abierto onAbrir={() => {}} />
        </div>
      )}
      {f.type === "shipping" && (
        <p className="mt-2 text-[11.5px]" style={{ color: "var(--humo)" }}>
          Un cupón de envío gratis no cambia tu cuenta: la app ya supone que el envío lo pagás vos.
        </p>
      )}
      {error && (
        <p className="mt-2 text-[12.5px]" style={{ color: "var(--oxido)" }}>
          {error}
        </p>
      )}

      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCerrar} disabled={trabajando} className={boton} style={{ borderColor: "var(--linea)", color: "var(--humo)" }}>
          Cancelar
        </button>
        <button
          type="button"
          onClick={guardar}
          disabled={!listo || trabajando}
          className="rounded-[3px] px-3.5 py-[6px] text-[12.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "var(--tinta)" }}
        >
          {trabajando ? "Guardando…" : cupon ? "Guardar cambios en Tiendanube" : "Crear en Tiendanube"}
        </button>
      </div>
    </div>
  );
}
