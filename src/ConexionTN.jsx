import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Link2, PlugZap, RefreshCw, Upload } from "lucide-react";
import { NumberCell } from "./NumberCell";
import { normalizarTexto, pesos } from "./Catalogo";
import { pctSinMiles as pctCorto } from "./numeros";
import { descuentoVisto } from "./precios";
import { actualizarVarianteTN, envioParaTN, pagaHoy, vinculoTN } from "./clienteTN";

/* ============================================================
   Las piezas de la pestaña Tiendanube que hablan con la tienda: la banda de
   la conexión, la celda "En Tiendanube" con su buscador (vincular y stock) y
   el panel de actualizar precios, donde se decide la promoción.
   Todo lo que escribe en Tiendanube pasa por una confirmación.
   ============================================================ */

const boton =
  "k-col flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border px-3 py-[7px] transition disabled:cursor-not-allowed disabled:opacity-40";

// Tope de Tiendanube: 2 pedidos por segundo. Entre envío y envío, un respiro.
const RESPIRO_MS = 600;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- La banda de la conexión ---------- */
export function BandaConexionTN({ cuenta, productos, vinculados, trayendo, onConectar, onRefrescar, onActualizar }) {
  let estado;
  if (cuenta === null) estado = "Preguntando a Tiendanube…";
  else if (cuenta.falta?.length) estado = `Falta ${cuenta.falta.join(" y ")} en .env.local: agregalo y reiniciá la app.`;
  else if (cuenta.error) estado = `No se pudo consultar la conexión (${cuenta.error}).`;
  else if (!cuenta.conectado) estado = "Tiendanube no está conectado.";
  else
    estado = `Conectado a ${cuenta.tienda} · ${productos ? `${productos.length} productos` : "trayendo productos…"} · ${vinculados} vinculado${
      vinculados === 1 ? "" : "s"
    }`;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-[4px] border px-3 py-2" style={{ borderColor: "var(--zona-tn-honda)", background: "var(--papel)" }}>
      <span className="text-[12.5px]" style={{ color: "var(--humo)" }}>
        {estado}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {cuenta && !cuenta.conectado && !cuenta.falta?.length && (
          <button onClick={onConectar} className={boton} style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}>
            <PlugZap size={14} /> Conectar
          </button>
        )}
        {cuenta?.conectado && (
          <>
            {/* Para que valgan permisos nuevos de la app hay que autorizarla
                otra vez (doc "Autenticación"): el token nuevo reemplaza al viejo. */}
            <button
              onClick={onConectar}
              title="Volver a autorizar la app en Tiendanube: hace falta después de agregarle permisos en el portal de socios"
              className={boton}
              style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
            >
              <PlugZap size={14} /> Volver a conectar
            </button>
            <button onClick={onRefrescar} disabled={trayendo} title="Volver a leer los productos de Tiendanube" className={boton} style={{ borderColor: "var(--linea)", color: "var(--humo)" }}>
              <RefreshCw size={14} className={trayendo ? "animate-spin" : ""} /> Releer
            </button>
            <button
              onClick={onActualizar}
              disabled={trayendo || vinculados === 0}
              title={vinculados === 0 ? "Primero vinculá algún perfume con su producto (columna En Tiendanube)" : "Ver qué precios no coinciden y decidir la promoción"}
              className={boton}
              style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}
            >
              <Upload size={14} /> Actualizar precios en Tiendanube
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- La celda "En Tiendanube" ----------
   Sin vínculo: un botón para elegir el producto. Con vínculo: lo que paga hoy
   el cliente, verde si es el precio de la app y óxido si no (compara, no es
   ganancia: nada de ámbar). Con promoción, abajo el tachado y el %. */
export function CeldaTN({ perfume, conectado, productos, porVariante, usadas, onVincular, onStock }) {
  const [abierto, setAbierto] = useState(false);
  const v = vinculoTN(perfume);
  const variante = v ? porVariante.get(String(v.variantId)) : null;
  const precioApp = Number(perfume.precioTN) || 0;

  let contenido;
  let color = "var(--humo-claro)";
  let titulo;
  let debajo = null;
  if (!v) {
    contenido = (
      <span className="flex items-center justify-end gap-1">
        <Link2 size={12} /> vincular
      </span>
    );
    titulo = conectado ? `Elegir el producto de Tiendanube de ${perfume.nombre}` : "Conectá Tiendanube para vincular";
  } else if (!productos) {
    contenido = "vinculado";
    titulo = "Vinculado. Conectá Tiendanube para ver su precio.";
  } else if (!variante) {
    contenido = "no está";
    color = "var(--oxido)";
    titulo = "Ese producto o variante ya no aparece en la tienda. Clic para cambiarlo.";
  } else {
    const paga = pagaHoy(variante);
    const coincide = paga === precioApp;
    contenido = paga != null ? pesos(paga) : "—";
    color = coincide ? "var(--verde)" : "var(--oxido)";
    const conPromo = variante.promocional != null && variante.promocional < (variante.precio ?? 0);
    if (conPromo) debajo = `${pesos(variante.precio)} · −${pctCorto(descuentoVisto(variante.promocional, variante.precio), 0)}`;
    titulo = `${variante.productoNombre}${variante.valores ? ` · ${variante.valores}` : ""}. El cliente paga ${pesos(paga)}${conPromo ? ` (promoción; normal tachado ${pesos(variante.precio)})` : ""}. ${
      coincide ? "Es el precio de la app." : `La app dice ${pesos(precioApp)}.`
    }`;
  }

  return (
    <div className="px-1.5" style={{ background: "var(--zona-tn)" }}>
      <button
        type="button"
        disabled={!conectado}
        onClick={() => setAbierto(true)}
        title={titulo}
        aria-label={`Producto de Tiendanube de ${perfume.nombre}`}
        className={`k-num w-full rounded-[3px] px-1 py-1 text-right text-[12px] transition hover:bg-[var(--zona-tn-honda)] disabled:cursor-not-allowed ${v ? "" : "opacity-60 group-hover:opacity-100"}`}
        style={{ color }}
      >
        <span className="block truncate">{contenido}</span>
        {debajo && (
          <span className="block truncate text-[10.5px]" style={{ color: "var(--humo)" }}>
            {debajo}
          </span>
        )}
      </button>
      {abierto && (
        <BuscadorTN
          perfume={perfume}
          vinculo={v}
          variante={variante}
          productos={productos ?? []}
          usadas={usadas}
          onElegir={(nuevo) => {
            setAbierto(false);
            onVincular(perfume, nuevo);
          }}
          onStock={(stock) => {
            setAbierto(false);
            onStock(perfume, variante, stock);
          }}
          onCerrar={() => setAbierto(false)}
        />
      )}
    </div>
  );
}

/* ---------- Elegir el producto (y la variante) ----------
   Un modal en portal al body. Nunca se empareja solo: arranca buscando con el
   nombre del perfume sin la medida, pero se elige. No muestra las variantes ya
   vinculadas a otro perfume (con un botón para verlas igual). */
const sinMedida = (s) => String(s).replace(/\b\d+(?:[.,]\d+)?\s*ml\b/gi, "").replace(/\s+/g, " ").trim();
const paraBuscar = (s) => normalizarTexto(s).replace(/(\d)\s+ml\b/g, "$1ml");

function BuscadorTN({ perfume, vinculo, variante, productos, usadas, onElegir, onStock, onCerrar }) {
  const [consulta, setConsulta] = useState(() => sinMedida(perfume.nombre));
  const [verOcupadas, setVerOcupadas] = useState(false);
  const [stock, setStock] = useState(variante?.stock ?? 0);

  // Una opción por variante: un perfume apunta a una variante, no al producto.
  const { opciones, ocultas } = useMemo(() => {
    const palabras = paraBuscar(consulta).split(/\s+/).filter(Boolean);
    const todas = productos.flatMap((p) =>
      p.variantes.map((v) => ({ producto: p, variante: v, texto: `${p.nombre} ${v.valores} ${v.sku} ${p.id}` }))
    );
    const coinciden = palabras.length ? todas.filter((o) => palabras.every((w) => paraBuscar(o.texto).includes(w))) : todas;
    const libres = coinciden.filter((o) => String(o.variante.id) === String(vinculo?.variantId) || !usadas.has(String(o.variante.id)));
    return { opciones: (verOcupadas ? coinciden : libres).slice(0, 80), ocultas: coinciden.length - libres.length };
  }, [consulta, productos, usadas, vinculo, verOcupadas]);

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4" onClick={onCerrar}>
      <div
        role="dialog"
        aria-label={`Elegir el producto de Tiendanube de ${perfume.nombre}`}
        className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-[5px] shadow-xl"
        style={{ background: "var(--papel)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-3 py-2" style={{ borderColor: "var(--linea)" }}>
          <span className="k-col mb-1.5 block" style={{ color: "var(--humo)" }}>
            {perfume.nombre} · Tiendanube
          </span>
          <input
            autoFocus
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Buscar por nombre, SKU o id…"
            className="w-full rounded-[3px] border px-2 py-1.5 text-[12.5px]"
            style={{ borderColor: "var(--linea)", color: "var(--tinta)" }}
          />
        </div>

        {vinculo && (
          <div className="flex items-center gap-2 border-b px-3 py-2 text-[12px]" style={{ borderColor: "var(--linea)", background: "var(--zona-tn)" }}>
            {variante ? (
              variante.stock === null ? (
                <span style={{ color: "var(--humo)" }}>Stock infinito en Tiendanube: se cambia desde la tienda.</span>
              ) : (
                <>
                  <span style={{ color: "var(--humo)" }}>Stock en Tiendanube</span>
                  <div className="w-[72px]">
                    <NumberCell value={stock} onChange={(n) => setStock(Math.max(0, Math.round(n)))} />
                  </div>
                  <button
                    disabled={stock === variante.stock}
                    onClick={() => onStock(stock)}
                    className="k-col rounded-[3px] border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                    style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}
                  >
                    Cambiar stock
                  </button>
                </>
              )
            ) : (
              <span style={{ color: "var(--oxido)" }}>El producto vinculado ya no está en la tienda.</span>
            )}
            <button onClick={() => onElegir(null)} title="Quita el vínculo en la app. El producto de Tiendanube no se toca." className="k-col ml-auto rounded-[3px] px-2 py-1" style={{ color: "var(--oxido)" }}>
              Desvincular
            </button>
          </div>
        )}

        <ul data-scroll className="flex-1 overflow-y-auto">
          {opciones.length === 0 && (
            <li className="px-3 py-4 text-center text-[12.5px]" style={{ color: "var(--humo-claro)" }}>
              {ocultas > 0 ? "Los que coinciden ya están vinculados." : "Ningún producto coincide. Probá con menos palabras."}
            </li>
          )}
          {opciones.map(({ producto: p, variante: v }) => {
            const ocupada = usadas.get(String(v.id));
            const esta = String(v.id) === String(vinculo?.variantId);
            return (
              <li key={v.id}>
                <button
                  onClick={() => (esta ? onCerrar() : onElegir({ productId: p.id, variantId: v.id }))}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-[var(--zona-tn)]"
                  title={ocupada && !esta ? `Ya está vinculado a ${ocupada}` : p.nombre}
                >
                  {p.imagen ? <img src={p.imagen} alt="" className="h-9 w-9 shrink-0 rounded-[3px] object-cover" /> : <span className="h-9 w-9 shrink-0" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px]" style={{ color: "var(--tinta)" }}>
                      {p.nombre}
                      {v.valores ? ` · ${v.valores}` : ""}
                    </span>
                    <span className="k-num block truncate text-[11px]" style={{ color: "var(--humo)" }}>
                      {v.sku ? `SKU ${v.sku} · ` : ""}stock {v.stock ?? "infinito"} · {p.publicado ? "visible" : "oculto"}
                      {ocupada && !esta ? ` · ya en ${ocupada}` : ""}
                    </span>
                  </span>
                  <span className="k-num shrink-0 text-right text-[12.5px]" style={{ color: "var(--tinta)" }}>
                    {pesos(pagaHoy(v))}
                    {v.promocional != null && (
                      <span className="block text-[10.5px] line-through" style={{ color: "var(--humo)" }}>
                        {pesos(v.precio)}
                      </span>
                    )}
                  </span>
                  {esta && <Check size={14} style={{ color: "var(--verde)" }} />}
                </button>
              </li>
            );
          })}
        </ul>
        {ocultas > 0 && (
          <button onClick={() => setVerOcupadas((x) => !x)} className="k-col border-t px-3 py-2 text-left transition hover:bg-[var(--zona-tn)]" style={{ borderColor: "var(--linea)", color: "var(--humo)" }}>
            {verOcupadas ? "Ocultar los ya vinculados" : `Mostrar ${ocultas === 1 ? "el ya vinculado" : `los ${ocultas} ya vinculados`}`}
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

/* ---------- Actualizar precios en Tiendanube ----------
   Acá se decide la promoción, renglón por renglón. Arranca como está publicado:
   con promoción si ya la tiene (con su %), sin si no. Prenderla propone el
   "Descuento a mostrar" general. Nada se manda hasta "Actualizar N"; va de a uno
   y el resultado queda en el renglón. */
const COLUMNAS = "28px minmax(0,1fr) 150px 120px 120px 56px";

export function PanelActualizarTN({ renglones, perdidos, ajustesTN, onCerrar, onTerminado }) {
  const redondeo = ajustesTN?.redondeo ?? 1;
  const general = ajustesTN?.descuentoMostrado ?? 0.2;
  const [verTodos, setVerTodos] = useState(false);
  const [decision, setDecision] = useState(() =>
    Object.fromEntries(
      renglones.map((r) => [
        r.perfumeId,
        {
          mandar: !r.coincide,
          conPromo: r.conPromoHoy,
          // `descuento` es el que se usa para la cuenta; `pct` el que se muestra.
          // Si ya tiene promoción y no se toca el %, se conserva el descuento EXACTO
          // publicado: con el redondeado, un tachado de $136.000 pasaría a $136.100.
          descuento: r.descuentoHoy ?? general,
          pct: +((r.descuentoHoy ?? general) * 100).toFixed(1),
        },
      ])
    )
  );
  const [resultado, setResultado] = useState({}); // perfumeId → "ok" | mensaje
  const [enviando, setEnviando] = useState(false);
  const terminado = Object.keys(resultado).length > 0 && !enviando;

  const cambiar = (id, campos) => setDecision((d) => ({ ...d, [id]: { ...d[id], ...campos } }));

  // Lo que se mandaría en cada renglón, y si de verdad cambia algo.
  const filas = renglones.map((r) => {
    const d = decision[r.perfumeId];
    const envio = envioParaTN(r.precioApp, { conPromo: d.conPromo, descuento: d.descuento, redondeo });
    const igual = envio && envio.price === r.actual.precio && (envio.promotional_price ?? null) === (r.actual.promocional ?? null);
    return { r, d, envio, igual };
  });
  const visibles = filas.filter((f) => verTodos || !f.r.coincide || !f.igual);
  const aMandar = filas.filter((f) => f.d.mandar && f.envio && !f.igual);

  const enviar = async () => {
    setEnviando(true);
    for (const f of aMandar) {
      try {
        await actualizarVarianteTN(f.r.productId, f.r.variantId, f.envio);
        setResultado((x) => ({ ...x, [f.r.perfumeId]: "ok" }));
      } catch (e) {
        setResultado((x) => ({ ...x, [f.r.perfumeId]: e.message }));
      }
      await espera(RESPIRO_MS);
    }
    setEnviando(false);
    onTerminado();
  };

  const par = (precio, promo, fuerte) => (
    <span className={`k-num block text-right ${fuerte ? "font-semibold" : ""}`} style={{ color: fuerte ? "var(--tinta)" : "var(--humo)" }}>
      {promo != null ? (
        <>
          {pesos(promo)}
          <span className="block text-[10.5px] line-through" style={{ color: "var(--humo)" }}>
            {pesos(precio)}
          </span>
        </>
      ) : (
        pesos(precio)
      )}
    </span>
  );

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4" onClick={() => !enviando && onCerrar()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Actualizar precios en Tiendanube"
        className="w-full max-w-4xl rounded-[5px] p-5 shadow-xl"
        style={{ background: "var(--papel)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-[15px] font-semibold" style={{ color: "var(--tinta)" }}>
          Actualizar precios en Tiendanube
        </h3>
        <p className="mb-3 text-[12.5px]" style={{ color: "var(--humo)" }}>
          El precio de la app es lo que paga el cliente. <b>Con promoción</b> va como precio promocional y el normal se infla para mostrarse
          tachado (redondeado como Tiendanube). <b>Sin promoción</b> va como precio normal y, si tenía promocional, se saca. Tu ganancia es la
          misma en los dos casos.
        </p>

        {visibles.length === 0 ? (
          <p className="mb-3 text-[12.5px]" style={{ color: "var(--humo)" }}>
            Todos los perfumes vinculados ya tienen en Tiendanube el precio de la app.
          </p>
        ) : (
          <div data-scroll className="max-h-[50vh] overflow-y-auto rounded-[3px] border" style={{ borderColor: "var(--linea)" }}>
            <div className="sticky top-0 z-[1] grid items-center border-b text-[11px]" style={{ gridTemplateColumns: COLUMNAS, background: "var(--papel)", borderColor: "var(--linea)" }}>
              <span />
              {["Perfume", "Promoción", "Hoy", "Queda", ""].map((t, i) => (
                <span key={i} className={`k-col px-2 py-1.5 ${i === 0 || i === 1 ? "text-left" : "text-right"}`} style={{ color: "var(--humo)" }}>
                  {t}
                </span>
              ))}
            </div>
            {visibles.map(({ r, d, envio, igual }) => {
              const res = resultado[r.perfumeId];
              const visto = envio?.promotional_price != null ? descuentoVisto(envio.promotional_price, envio.price) : null;
              const bloqueado = enviando || terminado;
              return (
                <div key={r.perfumeId} className="grid items-center border-b py-1.5 text-[12.5px] last:border-b-0" style={{ gridTemplateColumns: COLUMNAS, borderColor: "var(--linea)" }} title={res && res !== "ok" ? res : r.titulo}>
                  <span className="px-2">
                    <input type="checkbox" checked={d.mandar && !igual && !!envio} disabled={bloqueado || igual || !envio} onChange={(e) => cambiar(r.perfumeId, { mandar: e.target.checked })} />
                  </span>
                  <span className="min-w-0 px-2">
                    <span className="block truncate" style={{ color: "var(--tinta)" }}>
                      {r.nombre}
                    </span>
                    <span className="block truncate text-[11px]" style={{ color: "var(--humo)" }}>
                      {r.titulo}
                      {r.conPromoHoy && !d.conPromo ? " · se saca la promoción" : ""}
                      {r.promoRota && !d.conPromo ? " · se ve 0% OFF: se saca el promocional" : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5 px-2">
                    <input type="checkbox" checked={d.conPromo} disabled={bloqueado} onChange={(e) => cambiar(r.perfumeId, { conPromo: e.target.checked, mandar: true })} aria-label={`Con promoción ${r.nombre}`} />
                    {d.conPromo ? (
                      <span className="w-[72px]" title={visto != null ? `Pediste ${d.pct}% · se ve ${pctCorto(visto, 1)}` : ""}>
                        <NumberCell value={d.pct} onChange={(v) => {
                            const pct = Math.min(Math.max(v, 1), 90);
                            cambiar(r.perfumeId, { pct, descuento: pct / 100, mandar: true });
                          }} suffix="%" />
                      </span>
                    ) : (
                      <span className="text-[11.5px]" style={{ color: "var(--humo)" }}>
                        sin
                      </span>
                    )}
                  </span>
                  <span className="px-2">{par(r.actual.precio, r.actual.promocional, false)}</span>
                  <span className="px-2">{envio ? par(envio.price, envio.promotional_price, true) : <span className="k-num block text-right" style={{ color: "var(--oxido)" }}>—</span>}</span>
                  <span className="flex justify-end px-2">
                    {res === "ok" ? (
                      <Check size={15} style={{ color: "var(--verde)" }} />
                    ) : res ? (
                      <span className="k-col" style={{ color: "var(--oxido)" }}>
                        error
                      </span>
                    ) : igual ? (
                      <span className="k-col" style={{ color: "var(--humo-claro)" }}>
                        igual
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <label className="mt-2 flex items-center gap-1.5 text-[12px]" style={{ color: "var(--humo)" }}>
          <input type="checkbox" checked={verTodos} onChange={(e) => setVerTodos(e.target.checked)} disabled={enviando} />
          Mostrar también los que ya coinciden (para prender o apagar su promoción)
        </label>
        {perdidos.length > 0 && (
          <p className="mt-3 text-[12px]" style={{ color: "var(--oxido)" }}>
            Vinculados a productos que Tiendanube ya no devuelve (no se tocan): {perdidos.map((x) => x.nombre).join(", ")}.
          </p>
        )}
        {terminado && Object.values(resultado).some((x) => x !== "ok") && (
          <p className="mt-3 text-[12px]" style={{ color: "var(--oxido)" }}>
            Alguno no se pudo actualizar: pasá el mouse por el renglón para ver qué dijo Tiendanube.
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button onClick={onCerrar} disabled={enviando} className="rounded-[3px] border px-3 py-1.5 text-[12.5px] disabled:opacity-40" style={{ borderColor: "var(--linea)", color: "var(--humo)" }}>
            {terminado ? "Cerrar" : "Cancelar"}
          </button>
          {!terminado && (
            <button
              onClick={enviar}
              disabled={enviando || aMandar.length === 0}
              className="rounded-[3px] px-3.5 py-1.5 text-[12.5px] font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: "var(--tinta)" }}
            >
              {enviando ? "Mandando…" : `Actualizar ${aMandar.length} en Tiendanube`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
