import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Link2, PlugZap, RefreshCw, Upload } from "lucide-react";
import { NumberCell } from "./NumberCell";
import { pctSinMiles as pctCorto } from "./numeros";
import { normalizarTexto, pesos } from "./Catalogo";
import {
  actualizarPublicacionML,
  avisoDePlan,
  cuotasDePublicacion,
  detallePublicacion,
  nombreDePlan,
} from "./clienteML";

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
   Dos vínculos por plan: la publicación normal (arriba) y, si existe, la de
   catálogo (abajo, más chica). La de catálogo NO recibe precios desde acá: ML
   la sincroniza sola con la normal. Se vincula para verla y para que sus ventas
   cuenten en Ventas con el perfume y su costo. */
export function CeldaPublicacion({
  perfume,
  plan,
  precioCatalogo,
  itemId,
  itemCatalogo,
  conectado,
  publicaciones,
  pubPorId,
  usadas,
  onVincular,
  onStock,
}) {
  const comunes = { perfume, plan, precioCatalogo, conectado, publicaciones, pubPorId, usadas, onVincular, onStock };
  // Si la normal ya tiene el precio de la app y la de catálogo no, es que ML
  // todavía no la sincronizó: no es un error.
  const normal = itemId ? pubPorId.get(itemId) : null;
  const normalAlDia = !!normal && Number(normal.precio) === Number(precioCatalogo);
  return (
    <div className="flex flex-col px-1.5" style={{ background: "var(--zona-ml)" }}>
      <BotonPublicacion tipo="normal" itemId={itemId} {...comunes} />
      {/* Sin la normal no se ofrece la de catálogo: la de catálogo copia su precio. */}
      {(itemId || itemCatalogo) && (
        <BotonPublicacion tipo="catalogo" itemId={itemCatalogo} normalAlDia={normalAlDia} {...comunes} />
      )}
    </div>
  );
}

/* Sin vínculo: un botón para elegir la publicación. Con vínculo: el precio que
   tiene publicado, en verde si coincide con el del catálogo y en óxido si no.
   Verde/óxido y no ámbar: esto compara, no es ganancia. */
function BotonPublicacion({
  tipo,
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
  normalAlDia = false,
}) {
  const [abierto, setAbierto] = useState(false);
  const boton = useRef(null);
  const pub = itemId ? pubPorId.get(itemId) : null;
  const deCatalogo = tipo === "catalogo";

  let contenido;
  let color = "var(--humo-claro)";
  let titulo;
  if (!itemId) {
    contenido = (
      <span className="flex items-center justify-end gap-1">
        <Link2 size={deCatalogo ? 10 : 12} /> {deCatalogo ? "catálogo" : "vincular"}
      </span>
    );
    titulo = !conectado
      ? "Conectá Mercado Libre para vincular"
      : deCatalogo
      ? `Elegir la publicación de catálogo de ${nombreDePlan(plan)} de ${perfume.nombre}. No recibe precios desde acá: ML la sincroniza con la normal.`
      : `Elegir la publicación de ${nombreDePlan(plan)} de ${perfume.nombre}`;
  } else if (!publicaciones) {
    contenido = itemId;
    titulo = "Vinculada. Conectá Mercado Libre para ver su precio.";
  } else if (!pub) {
    contenido = itemId;
    color = "var(--oxido)";
    titulo = `${itemId} ya no aparece entre tus publicaciones. Clic para cambiarla.`;
  } else {
    const coincide = Number(pub.precio) === Number(precioCatalogo);
    // La de catálogo atrasada con la normal ya al día: ML la está sincronizando.
    const sincronizando = deCatalogo && !coincide && normalAlDia;
    contenido = sincronizando ? "sincronizando" : pesos(pub.precio);
    color = coincide ? "var(--verde)" : sincronizando ? "var(--humo)" : "var(--oxido)";
    // En la de catálogo, "el catálogo" se confundiría con el catálogo de ML.
    const nuestro = deCatalogo ? "la app" : "el catálogo";
    titulo = `${deCatalogo ? "Publicación de catálogo: " : ""}${pub.titulo} (${pub.id}) · ${detallePublicacion(pub)}. ${
      sincronizando
        ? `Todavía tiene ${pesos(pub.precio)}: la normal ya tiene ${pesos(precioCatalogo)} y ML se lo pasa a la de catálogo en unos segundos. Se relee sola después de actualizar; si no, tocá Releer.`
        : coincide
        ? `Mismo precio que ${nuestro}.`
        : `${deCatalogo ? "La app" : "El catálogo"} dice ${pesos(precioCatalogo)}.`
    }${deCatalogo && !sincronizando ? " ML le sincroniza el precio desde la publicación normal." : ""}`;
    // Vinculada a un plan que no es el suyo: se avisa, no se cambia nada.
    const aviso = avisoDePlan(pub, plan);
    if (aviso) {
      titulo += ` Ojo: esta publicación ${aviso}.`;
      contenido = (
        <>
          <span style={{ color: "var(--oxido)" }}>! </span>
          {contenido}
        </>
      );
    }
  }

  return (
    <>
      <button
        ref={boton}
        type="button"
        disabled={!conectado}
        onClick={() => setAbierto(true)}
        title={titulo}
        aria-label={`Publicación ${deCatalogo ? "de catálogo " : ""}de ${nombreDePlan(plan)} de ${perfume.nombre}`}
        className={`k-num w-full truncate rounded-[3px] px-1 text-right transition hover:bg-[var(--zona-ml-honda)] disabled:cursor-not-allowed ${
          deCatalogo ? "py-0.5 text-[10.5px]" : "py-1.5 text-[12px]"
        } ${itemId ? "" : "opacity-60 group-hover:opacity-100"}`}
        style={{ color }}
      >
        {deCatalogo && itemId && <span style={{ color: "var(--humo)" }}>cat. </span>}
        {contenido}
      </button>
      {abierto && (
        <BuscadorPublicacion
          ancla={boton}
          tipo={tipo}
          perfume={perfume}
          plan={plan}
          itemId={itemId}
          publicaciones={publicaciones ?? []}
          usadas={usadas}
          onElegir={(id) => {
            setAbierto(false);
            onVincular(perfume, plan, id, tipo);
          }}
          onStock={(p, n) => {
            setAbierto(false);
            onStock(p, n);
          }}
          onCerrar={() => setAbierto(false)}
        />
      )}
    </>
  );
}

/* ---------- Elegir la publicación ----------
   En un portal al body con `position: fixed`, como la lista de BuscadorPerfume:
   dentro de la fila quedaría recortado por el `overflow`. El emparejado NUNCA
   es automático: arranca buscando con el nombre del perfume, pero se elige —
   un vínculo errado es mandarle el precio a otro perfume. */
// "100 ml" y "100ml" son lo mismo: se juntan antes de comparar palabra por palabra.
const paraBuscar = (s) => normalizarTexto(s).replace(/(\d)\s+ml\b/g, "$1ml");
const sinMedida = (s) => s.replace(/\b\d+(?:[.,]\d+)?\s*ml\b/gi, "").replace(/\s+/g, " ").trim();

const ANCHO_BUSCADOR = 460;
const ALTO_BUSCADOR = 400;

function BuscadorPublicacion({
  ancla,
  tipo,
  perfume,
  plan,
  itemId,
  publicaciones,
  usadas,
  onElegir,
  onStock,
  onCerrar,
}) {
  /* Las publicaciones de catálogo llevan el título del producto de ML, que no
     suele traer la medida ("Lattafa Musamam Black Intense Eau De Parfum"): con
     "100ml" en la búsqueda inicial quedaban todas afuera. */
  const [consulta, setConsulta] = useState(() =>
    tipo === "catalogo" ? sinMedida(perfume.nombre) : perfume.nombre
  );
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

  /* Las ya vinculadas a otro plan o perfume (o a la otra mitad de este mismo
     plan) no se ofrecen: una publicación no se vincula dos veces. Se pueden
     mostrar a pedido, para mover una sin desvincularla antes. La de este mismo
     vínculo sí aparece, con su tilde. */
  const [verOcupadas, setVerOcupadas] = useState(false);
  const { encontradas, ocultas } = useMemo(() => {
    const palabras = paraBuscar(consulta).split(/\s+/).filter(Boolean);
    const coinciden = palabras.length
      ? publicaciones.filter((x) => {
          const t = paraBuscar(`${x.titulo} ${x.id}`);
          return palabras.every((w) => t.includes(w));
        })
      : publicaciones;
    const libres = coinciden.filter((x) => x.id === itemId || !usadas.has(x.id));
    const lista = verOcupadas ? coinciden : libres;
    /* Primero las del plan que se está vinculando (por sus cuotas), y buscando la
       de catálogo, las de catálogo antes que las normales. Nada se esconde: el
       orden ayuda, la que se elige la decide Franco. */
    const puntaje = (x) =>
      (cuotasDePublicacion(x).plan === Number(plan) ? 2 : 0) +
      (tipo === "catalogo" && x.catalogo ? 1 : 0);
    const ordenada = [...lista].sort((a, b) => puntaje(b) - puntaje(a));
    return { encontradas: ordenada.slice(0, 80), ocultas: coinciden.length - libres.length };
  }, [consulta, publicaciones, tipo, usadas, itemId, verOcupadas]);

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
        aria-label={`Elegir la publicación ${tipo === "catalogo" ? "de catálogo " : ""}de ${nombreDePlan(plan)} de ${perfume.nombre}`}
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
            {tipo === "catalogo" ? " · catálogo" : ""}
          </span>
          {tipo === "catalogo" && (
            <p className="mb-1.5 text-[11px]" style={{ color: "var(--humo)" }}>
              La publicación de catálogo de este plan. No recibe precios desde la app: ML se los
              sincroniza desde la normal. Sirve para ver su precio y contar sus ventas.
            </p>
          )}
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
            {actual && tipo === "catalogo" ? (
              <span style={{ color: "var(--humo)" }}>Stock {actual.stock}: lo sincroniza ML desde la normal.</span>
            ) : actual ? (
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
              {ocultas > 0
                ? "Las que coinciden ya están vinculadas."
                : "Ninguna publicación coincide. Probá con menos palabras."}
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
                      {avisoDePlan(x, plan) && (
                        <span style={{ color: "var(--oxido)" }}> · {avisoDePlan(x, plan)}</span>
                      )}
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
        {ocultas > 0 && (
          <button
            onClick={() => setVerOcupadas((v) => !v)}
            className="k-col border-t px-3 py-2 text-left transition hover:bg-[var(--zona-ml)]"
            style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
          >
            {verOcupadas
              ? "Ocultar las ya vinculadas"
              : `Mostrar ${ocultas === 1 ? "la ya vinculada" : `las ${ocultas} ya vinculadas`}`}
          </button>
        )}
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
