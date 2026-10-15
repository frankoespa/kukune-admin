import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Link2, PlugZap, RefreshCw, Upload } from "lucide-react";
import { NumberCell } from "./NumberCell";
import { pctSinMiles as pctCorto } from "./numeros";
import { normalizarTexto, pesos } from "./Catalogo";
import { actualizarPublicacionML, detallePublicacion, nombreDePlan } from "./clienteML";

/* ============================================================
   Las piezas de la pestaña de Mercado Libre que hablan con ML de verdad:
   la conexión, el vínculo de cada plan con su publicación y el envío de
   precios. Todo lo que escribe en ML pasa por una confirmación.
   ============================================================ */

/* ---------- La banda de la conexión ---------- */
export function BandaConexion({
  cuenta,
  publicaciones,
  vinculados,
  trayendo,
  onConectar,
  onRefrescar,
  onActualizar,
}) {
  const boton =
    "k-col flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border px-3 py-[7px] transition disabled:cursor-not-allowed disabled:opacity-40";

  let estado;
  if (cuenta === null) estado = "Preguntando a Mercado Libre…";
  else if (cuenta.falta?.length)
    estado = `Falta ${cuenta.falta.join(" y ")} en .env.local: agregalo y reiniciá la app.`;
  else if (cuenta.error) estado = `No se pudo consultar la conexión (${cuenta.error}).`;
  else if (!cuenta.conectado) estado = "Mercado Libre no está conectado.";
  else
    estado = `Conectado como ${cuenta.nickname} · ${
      publicaciones ? `${publicaciones.length} publicaciones` : "trayendo publicaciones…"
    } · ${vinculados} vinculada${vinculados === 1 ? "" : "s"}`;

  return (
    <div
      className="mb-4 flex flex-wrap items-center gap-3 rounded-[4px] border px-3 py-2"
      style={{ borderColor: "var(--zona-ml-honda)", background: "var(--papel)" }}
    >
      <span className="text-[12.5px]" style={{ color: "var(--humo)" }}>
        {estado}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {cuenta && !cuenta.conectado && !cuenta.falta?.length && (
          <button
            onClick={onConectar}
            className={boton}
            style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}
          >
            <PlugZap size={14} /> Conectar
          </button>
        )}
        {cuenta?.conectado && (
          <>
            <button
              onClick={onRefrescar}
              disabled={trayendo}
              title="Volver a leer las publicaciones de Mercado Libre"
              className={boton}
              style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
            >
              <RefreshCw size={14} className={trayendo ? "animate-spin" : ""} /> Releer
            </button>
            <button
              onClick={onActualizar}
              disabled={trayendo || vinculados === 0}
              title={
                vinculados === 0
                  ? "Primero vinculá algún plan con su publicación (columna En ML)"
                  : "Ver qué precios del catálogo no coinciden con lo publicado"
              }
              className={boton}
              style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}
            >
              <Upload size={14} /> Actualizar precios en ML
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- La celda "En ML" de cada plan ----------
   Sin vínculo: un botón para elegir la publicación. Con vínculo: el precio que
   tiene publicado, en verde si coincide con el del catálogo y en óxido si no.
   Verde/óxido y no ámbar: esto compara, no es ganancia. */
export function CeldaPublicacion({
  perfume,
  plan,
  precioCatalogo,
  itemId,
  conectado,
  publicaciones,
  pubPorId,
  usadas,
  onVincular,
  onStock,
}) {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef(null);
  const pub = itemId ? pubPorId.get(itemId) : null;

  let contenido;
  let color = "var(--humo-claro)";
  let titulo;
  if (!itemId) {
    contenido = (
      <span className="flex items-center justify-end gap-1">
        <Link2 size={12} /> vincular
      </span>
    );
    titulo = conectado
      ? `Elegir la publicación de ${nombreDePlan(plan)} de ${perfume.nombre}`
      : "Conectá Mercado Libre para vincular";
  } else if (!publicaciones) {
    contenido = itemId;
    titulo = "Vinculada. Conectá Mercado Libre para ver su precio.";
  } else if (!pub) {
    contenido = itemId;
    color = "var(--oxido)";
    titulo = `${itemId} ya no aparece entre tus publicaciones. Clic para cambiarla.`;
  } else {
    const coincide = Number(pub.precio) === Number(precioCatalogo);
    contenido = pesos(pub.precio);
    color = coincide ? "var(--verde)" : "var(--oxido)";
    titulo = `${pub.titulo} (${pub.id}) · ${detallePublicacion(pub)}. ${
      coincide ? "Mismo precio que el catálogo." : `El catálogo dice ${pesos(precioCatalogo)}.`
    }`;
  }

  return (
    <div className="px-1.5" style={{ background: "var(--zona-ml)" }}>
      <button
        ref={boton}
        type="button"
        disabled={!conectado}
        onClick={() => setAbierto(true)}
        title={titulo}
        aria-label={`Publicación de ${nombreDePlan(plan)} de ${perfume.nombre}`}
        className={`k-num w-full truncate rounded-[3px] px-1 py-1.5 text-right text-[12px] transition hover:bg-[var(--zona-ml-honda)] disabled:cursor-not-allowed ${
          itemId ? "" : "opacity-60 group-hover:opacity-100"
        }`}
        style={{ color }}
      >
        {contenido}
      </button>
      {abierto && (
        <BuscadorPublicacion
          ancla={boton}
          perfume={perfume}
          plan={plan}
          itemId={itemId}
          publicaciones={publicaciones ?? []}
          usadas={usadas}
          onElegir={(id) => {
            setAbierto(false);
            onVincular(perfume, plan, id);
          }}
          onStock={(p, n) => {
            setAbierto(false);
            onStock(p, n);
          }}
          onCerrar={() => setAbierto(false)}
        />
      )}
    </div>
  );
}

/* ---------- Elegir la publicación ----------
   En un portal al body con `position: fixed`, como la lista de BuscadorPerfume:
   dentro de la fila quedaría recortado por el `overflow`. El emparejado NUNCA
   es automático: arranca buscando con el nombre del perfume, pero se elige —
   un vínculo errado es mandarle el precio a otro perfume. */
const ANCHO_BUSCADOR = 460;
const ALTO_BUSCADOR = 400;

function BuscadorPublicacion({
  ancla,
  perfume,
  plan,
  itemId,
  publicaciones,
  usadas,
  onElegir,
  onStock,
  onCerrar,
}) {
  const [consulta, setConsulta] = useState(() => perfume.nombre);
  const [caja, setCaja] = useState(() => ancla.current?.getBoundingClientRect());
  const actual = itemId ? publicaciones.find((x) => x.id === itemId) : null;
  const [stock, setStock] = useState(actual?.stock ?? 0);

  // Sigue al campo al scrollear y se cierra con Escape.
  useEffect(() => {
    const seguir = () => setCaja(ancla.current?.getBoundingClientRect());
    const tecla = (e) => e.key === "Escape" && onCerrar();
    window.addEventListener("scroll", seguir, true);
    window.addEventListener("resize", seguir);
    window.addEventListener("keydown", tecla);
    return () => {
      window.removeEventListener("scroll", seguir, true);
      window.removeEventListener("resize", seguir);
      window.removeEventListener("keydown", tecla);
    };
  }, [ancla, onCerrar]);

  const encontradas = useMemo(() => {
    const palabras = normalizarTexto(consulta).split(/\s+/).filter(Boolean);
    const lista = palabras.length
      ? publicaciones.filter((x) => {
          const t = normalizarTexto(`${x.titulo} ${x.id}`);
          return palabras.every((w) => t.includes(w));
        })
      : publicaciones;
    return lista.slice(0, 80);
  }, [consulta, publicaciones]);

  if (!caja) return null;
  const abajo = caja.bottom + 4 + ALTO_BUSCADOR <= window.innerHeight;
  // Si la celda se fue de pantalla al scrollear, el panel queda pegado al borde
  // y no afuera, donde no se podría cerrar ni usar.
  const arriba = Math.min(
    Math.max(8, abajo ? caja.bottom + 4 : caja.top - 4 - ALTO_BUSCADOR),
    Math.max(8, window.innerHeight - ALTO_BUSCADOR - 8)
  );
  const izquierda = Math.max(
    8,
    Math.min(caja.right - ANCHO_BUSCADOR, window.innerWidth - ANCHO_BUSCADOR - 8)
  );

  return createPortal(
    <>
      <div className="fixed inset-0 z-[64]" onMouseDown={onCerrar} />
      <div
        role="dialog"
        aria-label={`Elegir la publicación de ${nombreDePlan(plan)} de ${perfume.nombre}`}
        className="fixed z-[65] flex flex-col overflow-hidden rounded-[4px] border shadow-xl"
        style={{
          left: izquierda,
          top: arriba,
          width: ANCHO_BUSCADOR,
          maxHeight: ALTO_BUSCADOR,
          background: "var(--papel)",
          borderColor: "var(--linea)",
        }}
      >
        <div className="border-b px-3 py-2" style={{ borderColor: "var(--linea)" }}>
          <span className="k-col mb-1.5 block" style={{ color: "var(--humo)" }}>
            {perfume.nombre} · {nombreDePlan(plan)}
          </span>
          <input
            autoFocus
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Buscar por título o MLA…"
            className="w-full rounded-[3px] border px-2 py-1.5 text-[12.5px]"
            style={{ borderColor: "var(--linea)", color: "var(--tinta)" }}
          />
        </div>

        {itemId && (
          <div
            className="flex items-center gap-2 border-b px-3 py-2 text-[12px]"
            style={{ borderColor: "var(--linea)", background: "var(--zona-ml)" }}
          >
            {actual ? (
              <>
                <span style={{ color: "var(--humo)" }}>Stock en ML</span>
                <div className="w-[72px]">
                  <NumberCell value={stock} onChange={(v) => setStock(Math.max(0, Math.round(v)))} />
                </div>
                <button
                  disabled={stock === actual.stock}
                  onClick={() => onStock(actual, stock)}
                  className="k-col rounded-[3px] border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}
                >
                  Cambiar stock
                </button>
              </>
            ) : (
              <span style={{ color: "var(--oxido)" }}>{itemId} ya no está entre tus publicaciones.</span>
            )}
            <button
              onClick={() => onElegir(null)}
              title="Quita el vínculo en la app. La publicación de ML no se toca."
              className="k-col ml-auto rounded-[3px] px-2 py-1"
              style={{ color: "var(--oxido)" }}
            >
              Desvincular
            </button>
          </div>
        )}

        <ul data-scroll className="flex-1 overflow-y-auto">
          {encontradas.length === 0 && (
            <li className="px-3 py-4 text-center text-[12.5px]" style={{ color: "var(--humo-claro)" }}>
              Ninguna publicación coincide. Probá con menos palabras.
            </li>
          )}
          {encontradas.map((x) => {
            const ocupada = usadas.get(x.id);
            const esta = x.id === itemId;
            return (
              <li key={x.id}>
                <button
                  onClick={() => (esta ? onCerrar() : onElegir(x.id))}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-[var(--zona-ml)]"
                  title={ocupada && !esta ? `Ya está vinculada a ${ocupada}` : x.titulo}
                >
                  {x.miniatura ? (
                    <img src={x.miniatura} alt="" className="h-9 w-9 shrink-0 rounded-[3px] object-cover" />
                  ) : (
                    <span className="h-9 w-9 shrink-0" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px]" style={{ color: "var(--tinta)" }}>
                      {x.titulo}
                    </span>
                    <span className="k-num block truncate text-[11px]" style={{ color: "var(--humo)" }}>
                      {x.id} · {detallePublicacion(x)}
                      {ocupada && !esta ? ` · ya en ${ocupada}` : ""}
                    </span>
                  </span>
                  <span className="k-num shrink-0 text-[12.5px]" style={{ color: "var(--tinta)" }}>
                    {pesos(x.precio)}
                  </span>
                  {esta && <Check size={14} style={{ color: "var(--verde)" }} />}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>,
    document.body
  );
}

/* ---------- Actualizar precios en ML ----------
   Muestra TODAS las publicaciones que cambiarían —no una muestra—, cada una con
   lo que tiene hoy y lo que va a tener, y nada se manda hasta confirmar. Se
   pueden destildar las que no. El resultado queda en cada renglón, que es donde
   está el ojo. La grilla es una sola constante y el encabezado va adentro de la
   caja que scrollea, igual que en el diálogo de costos del pedido. */
const COLUMNAS_ACTUALIZAR = "32px minmax(0,1fr) 100px 100px 72px 56px";

export function PanelActualizar({ cambios, perdidos, onCerrar, onTerminado }) {
  const [elegidos, setElegidos] = useState(
    () => new Set(cambios.filter((c) => !c.variaciones).map((c) => c.itemId))
  );
  const [resultado, setResultado] = useState({}); // itemId → "ok" | mensaje de error
  const [enviando, setEnviando] = useState(false);
  const terminado = Object.keys(resultado).length > 0 && !enviando;

  const enviar = async () => {
    setEnviando(true);
    // De a una: si ML corta alguna, se ve en qué renglón.
    for (const c of cambios) {
      if (!elegidos.has(c.itemId)) continue;
      try {
        await actualizarPublicacionML(c.itemId, { price: c.precioCatalogo });
        setResultado((r) => ({ ...r, [c.itemId]: "ok" }));
      } catch (e) {
        setResultado((r) => ({ ...r, [c.itemId]: e.message }));
      }
    }
    setEnviando(false);
    onTerminado();
  };

  const alternar = (id) =>
    setElegidos((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const col = (t, a = "text-right") => (
    <span className={`k-col px-2 py-1.5 ${a}`} style={{ color: "var(--humo)" }}>
      {t}
    </span>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={() => !enviando && onCerrar()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Actualizar precios en Mercado Libre"
        className="w-full max-w-3xl rounded-[5px] p-5 shadow-xl"
        style={{ background: "var(--papel)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-[15px] font-semibold" style={{ color: "var(--tinta)" }}>
          Actualizar precios en Mercado Libre
        </h3>
        {cambios.length === 0 ? (
          <p className="mb-3 text-[12.5px]" style={{ color: "var(--humo)" }}>
            Todas las publicaciones vinculadas ya tienen el precio del catálogo. No hay nada que
            mandar.
          </p>
        ) : (
          <>
            <p className="mb-3 text-[12.5px]" style={{ color: "var(--humo)" }}>
              Estas publicaciones tienen en ML un precio distinto al del catálogo. Las tildadas pasan
              a tener el precio de la columna <b>Catálogo</b>, en las publicaciones reales.
            </p>
            <div
              data-scroll
              className="max-h-[42vh] overflow-y-auto rounded-[3px] border"
              style={{ borderColor: "var(--linea)" }}
            >
              <div
                className="sticky top-0 grid items-center border-b"
                style={{
                  gridTemplateColumns: COLUMNAS_ACTUALIZAR,
                  background: "var(--papel)",
                  borderColor: "var(--linea)",
                }}
              >
                <span />
                {col("Publicación", "text-left")}
                {col("En ML")}
                {col("Catálogo")}
                {col("Dif.")}
                <span />
              </div>
              {cambios.map((c) => {
                const r = resultado[c.itemId];
                const dif = c.precioML > 0 ? (c.precioCatalogo - c.precioML) / c.precioML : null;
                return (
                  <label
                    key={c.itemId}
                    className="grid cursor-pointer items-center border-b py-1 text-[12.5px] last:border-b-0"
                    style={{ gridTemplateColumns: COLUMNAS_ACTUALIZAR, borderColor: "var(--linea)" }}
                    title={
                      c.variaciones
                        ? "Tiene variaciones: se cambia desde Mercado Libre"
                        : `${c.titulo}${r && r !== "ok" ? ` — ${r}` : ""}`
                    }
                  >
                    <span className="px-2">
                      <input
                        type="checkbox"
                        checked={elegidos.has(c.itemId)}
                        disabled={enviando || terminado || !!c.variaciones}
                        onChange={() => alternar(c.itemId)}
                      />
                    </span>
                    <span className="min-w-0 px-2">
                      <span className="block truncate" style={{ color: "var(--tinta)" }}>
                        {c.nombre} · {nombreDePlan(c.plan)}
                      </span>
                      <span className="k-num block truncate text-[11px]" style={{ color: "var(--humo)" }}>
                        {c.itemId} · {c.detalle} · {c.titulo}
                      </span>
                    </span>
                    <span className="k-num px-2 text-right" style={{ color: "var(--humo)" }}>
                      {pesos(c.precioML)}
                    </span>
                    <span className="k-num px-2 text-right font-semibold" style={{ color: "var(--tinta)" }}>
                      {pesos(c.precioCatalogo)}
                    </span>
                    <span className="k-num px-2 text-right text-[11.5px]" style={{ color: "var(--humo)" }}>
                      {dif === null ? "—" : `${dif > 0 ? "+" : ""}${pctCorto(dif, 1)}`}
                    </span>
                    <span className="flex justify-end px-2">
                      {r === "ok" ? (
                        <Check size={15} style={{ color: "var(--verde)" }} />
                      ) : r ? (
                        <span className="k-col" style={{ color: "var(--oxido)" }}>
                          error
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </>
        )}

        {perdidos.length > 0 && (
          <p className="mt-3 text-[12px]" style={{ color: "var(--oxido)" }}>
            Vinculadas a publicaciones que ML ya no devuelve (no se tocan):{" "}
            {perdidos.map((x) => `${x.nombre} · ${nombreDePlan(x.plan)} (${x.itemId})`).join(", ")}.
          </p>
        )}
        {terminado && Object.values(resultado).some((r) => r !== "ok") && (
          <p className="mt-3 text-[12px]" style={{ color: "var(--oxido)" }}>
            Alguna no se pudo actualizar: pasá el mouse por el renglón para ver qué dijo Mercado
            Libre.
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            onClick={onCerrar}
            disabled={enviando}
            className="rounded-[3px] border px-3 py-1.5 text-[12.5px] disabled:opacity-40"
            style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
          >
            {terminado || cambios.length === 0 ? "Cerrar" : "Cancelar"}
          </button>
          {cambios.length > 0 && !terminado && (
            <button
              onClick={enviar}
              disabled={enviando || elegidos.size === 0}
              className="rounded-[3px] px-3.5 py-1.5 text-[12.5px] font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: "var(--tinta)" }}
            >
              {enviando ? "Mandando…" : `Actualizar ${elegidos.size} en ML`}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
