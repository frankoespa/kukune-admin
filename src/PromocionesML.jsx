import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { urlFoto } from "./almacenamiento";
import { pctSinMiles as pctCorto } from "./numeros";
import { ConVistaPrevia, pesos } from "./Catalogo";
import { NumberCell } from "./NumberCell";
import {
  leerCampanasML,
  leerItemsDeCampanaML,
  nombreDePlan,
  nombreDeTipoPromo,
  ponerPromoML,
  quitarPromoML,
} from "./clienteML";
import { diasParaAceptar, filasDeCampana, yaParticipa } from "./cuentasPromoML";

/* En estas campañas el precio lo pone el vendedor, así que la fila es editable.
   En las co-fondeadas el precio lo define ML y solo se acepta la invitación. */
const PONE_EL_PRECIO = ["DEAL", "SELLER_CAMPAIGN", "DOD", "LIGHTNING"];

/* ML no aplica la promo en el mismo momento: la escritura vuelve con 200 y la
   campaña tarda unos segundos en mostrar el cambio. Se relee enseguida y otra
   vez después, igual que con el precio de la publicación de catálogo. */
const RELEER_DE_NUEVO = 10000;

/* ============================================================
   Promociones de Mercado Libre: las campañas a las que ML invita (Black Friday,
   Cyber Monday y las demás) y qué deja cada perfume si entra.

   SOLO LECTURA: lee las invitaciones y sus candidatas y no escribe nada, ni en
   ML ni en el catálogo. Mirar esto es gratis.

   Las cuentas están en `cuentasPromoML.js`. Lo que no hay que perder de vista:
   en una campaña CO-FONDEADA el comprador paga menos de lo que a vos te llega,
   porque ML pone una parte del descuento. Por eso hay dos columnas y no una.
   ============================================================ */

// foto · perfume · plan · lista · paga · pone ML · te queda · margen · hoy · dif · acción
const COLUMNAS = "52px minmax(170px,1fr) 84px 96px 112px 92px 104px 68px 104px 104px 120px";

const colorGanancia = (g) => (g == null ? "var(--humo-claro)" : g > 0 ? "var(--verde)" : "var(--oxido)");
// Una diferencia es una comparación, no plata que queda: verde u óxido, nunca ámbar.
const colorDiferencia = (d) => (d == null ? "var(--humo-claro)" : d >= 0 ? "var(--verde)" : "var(--oxido)");

const fecha = (iso) =>
  iso
    ? new Intl.DateTimeFormat("es-AR", {
        timeZone: "America/Argentina/Buenos_Aires",
        day: "2-digit",
        month: "2-digit",
      }).format(new Date(iso))
    : "—";

/* El plazo para aceptar, que es el dato que apura: en días y no en fecha. */
function Plazo({ campana }) {
  const dias = diasParaAceptar(campana);
  if (dias == null) return null;
  const vencido = dias < 0;
  const apura = dias >= 0 && dias <= 3;
  return (
    <span
      className="k-num text-[12px]"
      style={{ color: vencido ? "var(--humo-claro)" : apura ? "var(--oxido)" : "var(--humo)" }}
      title={`Hasta el ${fecha(campana.limite)} para sumar publicaciones a esta campaña`}
    >
      {vencido
        ? "plazo vencido"
        : dias === 0
        ? "último día para entrar"
        : `${dias} día${dias === 1 ? "" : "s"} para entrar`}
    </span>
  );
}

export default function PromocionesML({ perfumes, ajustes, cuenta, onConfirmar }) {
  const [campanas, setCampanas] = useState(null);
  const [sinPermiso, setSinPermiso] = useState(false);
  const [trayendo, setTrayendo] = useState(false);
  const [error, setError] = useState("");
  // Qué campaña está desplegada, y los ítems de cada una (se piden al abrirla).
  const [abierta, setAbierta] = useState(null);
  const [porCampana, setPorCampana] = useState({});
  const conectado = !!cuenta?.conectado;

  const traer = useCallback(async () => {
    setTrayendo(true);
    setError("");
    try {
      const r = await leerCampanasML();
      setCampanas(r.campanas ?? []);
      setSinPermiso(!!r.sinPermiso);
    } catch (e) {
      setError(`No se pudieron traer las campañas (${e.message}).`);
    } finally {
      setTrayendo(false);
    }
  }, []);

  useEffect(() => {
    if (conectado) traer();
  }, [conectado, traer]);

  /* Los ítems de una campaña se piden al abrirla y quedan guardados: la
     paginación de ML usa un token que vence a los 5 minutos, así que se recorre
     de una pasada y no se vuelve a pedir por abrir y cerrar. */
  const releer = useCallback(async (campana) => {
    setPorCampana((x) => ({ ...x, [campana.id]: { trayendo: true } }));
    try {
      const r = await leerItemsDeCampanaML(campana.id, campana.tipo);
      setPorCampana((x) => ({
        ...x,
        [campana.id]: { items: r.items ?? [], truncado: !!r.truncado, sinPermiso: !!r.sinPermiso },
      }));
    } catch (e) {
      setPorCampana((x) => ({ ...x, [campana.id]: { error: e.message } }));
    }
  }, []);

  const abrir = (campana) => {
    if (abierta === campana.id) {
      setAbierta(null);
      return;
    }
    setAbierta(campana.id);
    if (!porCampana[campana.id]) releer(campana);
  };

  /* Primero las que están por vencer: el plazo es lo que hay que decidir. Las
     que ya vencieron van al final. */
  const ordenadas = useMemo(() => {
    const dias = (c) => {
      const d = diasParaAceptar(c);
      return d == null ? Infinity : d < 0 ? 1e6 - d : d;
    };
    return (campanas ?? []).slice().sort((a, b) => dias(a) - dias(b));
  }, [campanas]);

  if (!conectado)
    return (
      <p className="py-12 text-center text-[13px]" style={{ color: "var(--humo-claro)" }}>
        Conectá Mercado Libre para ver las campañas a las que te invitaron.
      </p>
    );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={traer}
          disabled={trayendo}
          className="k-col inline-flex items-center gap-1.5 rounded-[3px] border px-3 py-[7px] transition disabled:opacity-50"
          style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}
        >
          <RefreshCw size={14} className={trayendo ? "animate-spin" : ""} /> Releer campañas
        </button>
      </div>

      {error && (
        <p className="mb-4 text-[12.5px]" style={{ color: "var(--oxido)" }}>
          {error}
        </p>
      )}
      {sinPermiso && (
        <p className="mb-4 text-[12.5px]" style={{ color: "var(--humo)" }}>
          La app no puede ver tus campañas: a la aplicación de Mercado Libre le falta el permiso. Tocá
          Volver a conectar para pedirlo.
        </p>
      )}

      {campanas == null ? (
        <p className="py-12 text-center text-[13px]" style={{ color: "var(--humo-claro)" }}>
          {trayendo ? "Trayendo campañas de Mercado Libre…" : "Tocá Releer campañas."}
        </p>
      ) : ordenadas.length === 0 ? (
        /* Con el permiso faltando no se sabe si hay invitaciones o no, así que
           no se dice que no hay: arriba ya está el aviso del permiso. */
        sinPermiso ? null : (
          <p className="py-12 text-center text-[13px]" style={{ color: "var(--humo-claro)" }}>
            No tenés invitaciones a campañas ahora mismo. ML invita por temporada (Black Friday, Cyber
            Monday y las demás) y aparecen acá cuando llegan.
          </p>
        )
      ) : (
        <ul className="grid gap-2">
          {ordenadas.map((c) => (
            <Campana
              key={c.id}
              campana={c}
              abierta={abierta === c.id}
              datos={porCampana[c.id]}
              perfumes={perfumes}
              ajustes={ajustes}
              onAbrir={() => abrir(c)}
              onConfirmar={onConfirmar}
              onCambioEnML={() => {
                releer(c);
                setTimeout(() => releer(c), RELEER_DE_NUEVO);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function Campana({ campana, abierta, datos, perfumes, ajustes, onAbrir, onConfirmar, onCambioEnML }) {
  /* En una campaña tradicional el precio lo pone el vendedor, así que la fila es
     editable y arranca en el que sugiere ML. Se tantea acá, en estado de
     pantalla: nada se manda hasta confirmar. */
  const [editados, setEditados] = useState({});
  const [enVuelo, setEnVuelo] = useState(null);
  const [errores, setErrores] = useState({});
  // Lo que salió bien: el diálogo se cierra y sin esto no queda ninguna señal.
  const [hechos, setHechos] = useState({});
  const editable = PONE_EL_PRECIO.includes(campana.tipo);

  const items = useMemo(
    () =>
      (datos?.items ?? []).map((it) =>
        editados[it.itemId] > 0 ? { ...it, paga: editados[it.itemId] } : it
      ),
    [datos, editados]
  );
  const r = useMemo(
    () => (datos?.items ? filasDeCampana(campana, items, perfumes, ajustes) : null),
    [campana, items, datos, perfumes, ajustes]
  );
  const Flecha = abierta ? ChevronDown : ChevronRight;

  /* Escribe en Mercado Libre de verdad, de a una publicación y con
     confirmación. El diálogo dice el precio, lo que te queda y que es real. */
  const mandar = (f, accion) =>
    onConfirmar({
      titulo:
        accion === "modificar"
          ? `Cambiar el precio de ${f.perfume.nombre} en la campaña`
          : `Sumar ${f.perfume.nombre} a la campaña`,
      ancho: "max-w-lg",
      texto: (
        <div className="grid gap-1.5">
          <p>
            <strong>{campana.nombre ?? campana.id}</strong> · {nombreDePlan(f.plan)} ({f.itemId}).
          </p>
          {editable ? (
            <p>
              El comprador va a pagar <strong>{pesos(f.precio)}</strong> en vez de {pesos(f.lista)}.
            </p>
          ) : (
            <p>
              El precio de la campaña lo define Mercado Libre: el comprador va a pagar{" "}
              <strong>{pesos(f.precio)}</strong> en vez de {pesos(f.lista)}.
            </p>
          )}
          {f.recibe > f.precio && (
            <p>
              Mercado Libre pone {pesos(f.recibe - f.precio)} del descuento, así que a vos te llegan{" "}
              {pesos(f.recibe)}.
            </p>
          )}
          <p>
            Te quedan{" "}
            <strong style={{ color: colorGanancia(f.ganancia) }}>{pesos(f.ganancia)}</strong> por unidad
            {f.diferencia != null && (
              <>
                {" "}
                ({f.diferencia >= 0 ? "+" : ""}
                {pesos(f.diferencia)} contra los {pesos(f.gananciaHoy)} de hoy)
              </>
            )}
            .
          </p>
          {f.pierdePlata && (
            <p style={{ color: "var(--oxido)" }}>A ese precio no cubrís el costo del perfume.</p>
          )}
          <p style={{ color: "var(--humo)" }}>
            Se escribe en la publicación real. Mercado Libre no tiene modo de prueba.
          </p>
        </div>
      ),
      etiquetaOk: accion === "modificar" ? "Cambiar el precio" : "Sumar a la campaña",
      peligro: f.pierdePlata,
      onAceptar: async () => {
        setEnVuelo(f.itemId);
        setErrores((x) => ({ ...x, [f.itemId]: null }));
        try {
          await ponerPromoML(f.itemId, {
            accion,
            tipo: campana.tipo,
            promocionId: campana.id,
            precio: editable ? f.precio : null,
            lista: f.lista,
          });
          setHechos((x) => ({
            ...x,
            [f.itemId]: accion === "modificar" ? "precio cambiado" : "sumada a la campaña",
          }));
          onCambioEnML();
        } catch (e) {
          setErrores((x) => ({ ...x, [f.itemId]: e.message }));
        } finally {
          setEnVuelo(null);
        }
      },
    });

  const salir = (f) =>
    onConfirmar({
      titulo: `Sacar ${f.perfume.nombre} de la campaña`,
      texto: `${nombreDePlan(f.plan)} (${f.itemId}) vuelve a venderse a ${pesos(
        f.lista
      )}. Si es una campaña co-fondeada y después le subís el precio, Mercado Libre no te deja volver a entrar.`,
      etiquetaOk: "Sacar de la campaña",
      peligro: true,
      onAceptar: async () => {
        setEnVuelo(f.itemId);
        setErrores((x) => ({ ...x, [f.itemId]: null }));
        try {
          await quitarPromoML(f.itemId, { tipo: campana.tipo, promocion: campana.id, oferta: f.ofertaId });
          setHechos((x) => ({ ...x, [f.itemId]: "sacada de la campaña" }));
          onCambioEnML();
        } catch (e) {
          setErrores((x) => ({ ...x, [f.itemId]: e.message }));
        } finally {
          setEnVuelo(null);
        }
      },
    });

  return (
    <li className="rounded-[4px] border" style={{ borderColor: "var(--linea)", background: "var(--papel)" }}>
      <button
        onClick={onAbrir}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-[var(--zona-ml)]"
        aria-expanded={abierta}
      >
        <Flecha size={15} style={{ color: "var(--humo)" }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13.5px]" style={{ color: "var(--tinta)" }}>
            {campana.nombre ?? campana.id}
          </div>
          <div
            className="k-col mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1"
            style={{ color: "var(--humo)" }}
          >
            <span>{nombreDeTipoPromo(campana.tipo)}</span>
            <span className="k-num">
              {fecha(campana.desde)} a {fecha(campana.hasta)}
            </span>
            {campana.coFondeada && campana.meliPct != null && (
              <span
                className="k-num"
                style={{ color: "var(--verde)" }}
                title="En una campaña co-fondeada ML paga parte del descuento, así que a vos te llega más de lo que paga el comprador."
              >
                ML pone {campana.meliPct}%
                {campana.vendedorPct != null ? ` · vos ${campana.vendedorPct}%` : ""}
              </span>
            )}
            {campana.llevaPaga && (
              <span className="k-num">
                llevá {campana.llevaPaga.lleva} pagá {campana.llevaPaga.paga}
              </span>
            )}
            <Plazo campana={campana} />
          </div>
        </div>
        <span className="k-col whitespace-nowrap" style={{ color: "var(--humo)" }}>
          {abierta ? "ocultar" : "ver qué te deja"}
        </span>
      </button>

      {abierta && (
        <div className="border-t px-3 py-3" style={{ borderColor: "var(--linea)" }}>
          {datos?.trayendo && (
            <p className="py-6 text-center text-[13px]" style={{ color: "var(--humo-claro)" }}>
              Trayendo las publicaciones de la campaña…
            </p>
          )}
          {datos?.error && (
            <p className="text-[12.5px]" style={{ color: "var(--oxido)" }}>
              No se pudieron traer las publicaciones ({datos.error}).
            </p>
          )}
          {datos?.sinPermiso && (
            <p className="text-[12.5px]" style={{ color: "var(--humo)" }}>
              La app no tiene permiso para ver las publicaciones de esta campaña.
            </p>
          )}
          {r && (
            <Detalle
              campana={campana}
              r={r}
              truncado={datos.truncado}
              editable={editable}
              enVuelo={enVuelo}
              errores={errores}
              hechos={hechos}
              onEditar={(itemId, precio) => setEditados((x) => ({ ...x, [itemId]: precio }))}
              onEntrar={mandar}
              onSalir={salir}
            />
          )}
        </div>
      )}
    </li>
  );
}

function Detalle({ campana, r, truncado, editable, enVuelo, errores, hechos, onEditar, onEntrar, onSalir }) {
  const t = r.total;
  if (r.filas.length === 0 && r.sinCosto.length === 0 && r.sinVincular.length === 0)
    return (
      <p className="text-[13px]" style={{ color: "var(--humo-claro)" }}>
        Esta campaña no tiene publicaciones tuyas como candidatas.
      </p>
    );

  return (
    <>
      {/* Lo primero: cuánto cambia la ganancia si entraran todas. Es la decisión. */}
      <div
        className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-[3px] px-3 py-2"
        style={{ background: "var(--zona-ml)" }}
      >
        <div>
          <span className="k-col mb-0.5 block" style={{ color: "var(--humo)" }}>
            {t.perfumes === 1 ? "Si entra la candidata" : `Si entran las ${t.perfumes}`}
            {t.candidatas > t.perfumes ? ` (${t.candidatas - t.perfumes} sin precio todavía)` : ""}
          </span>
          <span className="k-num text-[15px] font-semibold" style={{ color: colorDiferencia(t.diferencia) }}>
            {t.diferencia >= 0 ? "+" : ""}
            {pesos(t.diferencia)}
          </span>
          <span className="k-col ml-2" style={{ color: "var(--humo)" }}>
            por unidad vendida
          </span>
        </div>
        {t.enPerdida > 0 && (
          <span className="text-[12.5px]" style={{ color: "var(--oxido)" }}>
            {t.enPerdida === 1 ? "1 quedaría" : `${t.enPerdida} quedarían`} sin cubrir el costo.
          </span>
        )}
        {campana.coFondeada && (
          <span className="text-[12.5px]" style={{ color: "var(--humo)" }}>
            Campaña co-fondeada: el comprador paga menos de lo que te llega.
          </span>
        )}
      </div>

      {r.filas.length > 0 && (
        <div className="overflow-x-auto">
          <div style={{ minWidth: 1000 }}>
            <Encabezado
              columnas={COLUMNAS}
              titulos={[
                ["", "text-left"],
                ["Perfume", "text-left"],
                ["Plan", "text-left"],
                ["Lista"],
                ["Paga el comprador"],
                ["Pone ML"],
                ["Te queda"],
                ["Margen"],
                ["Hoy sin promo"],
                ["Diferencia"],
                ["", "text-left"],
              ]}
            />
            <ul className="grid gap-1">
              {r.filas.map((f) => (
                <Fila
                  key={`${f.itemId}-${f.plan}`}
                  f={f}
                  editable={editable}
                  enVuelo={enVuelo === f.itemId}
                  error={errores?.[f.itemId]}
                  hecho={hechos?.[f.itemId]}
                  onEditar={onEditar}
                  onEntrar={onEntrar}
                  onSalir={onSalir}
                />
              ))}
            </ul>
          </div>
        </div>
      )}

      <ul className="mt-3 text-[11.5px]" style={{ color: "var(--humo)" }}>
        {truncado && <li>La campaña tiene más publicaciones de las que ML devuelve de una vez.</li>}
        {r.sinCosto.length > 0 && (
          <li>
            {r.sinCosto.length} candidata{r.sinCosto.length === 1 ? "" : "s"} de perfumes sin costo en el
            catálogo: no se puede saber qué dejan ({r.sinCosto.map((f) => f.perfume.nombre).join(", ")}).
          </li>
        )}
        {r.sinVincular.length > 0 && (
          <li>
            {r.sinVincular.length} candidata{r.sinVincular.length === 1 ? "" : "s"} sin vincular con ningún
            perfume: vinculalas en Precios para verlas acá.
          </li>
        )}
      </ul>
    </>
  );
}

function Encabezado({ columnas, titulos }) {
  return (
    <div className="grid items-center border border-transparent pb-1" style={{ gridTemplateColumns: columnas }}>
      {titulos.map(([texto, alineado], i) => (
        <span key={i} className={`k-col px-2 py-1 ${alineado ?? "text-right"}`} style={{ color: "var(--humo)" }}>
          {texto}
        </span>
      ))}
    </div>
  );
}

const Cifra = ({ children, color, titulo, fuerte }) => (
  <div className="px-2 text-right" title={titulo}>
    <span className={`k-num text-[13px] ${fuerte ? "font-semibold" : ""}`} style={{ color: color ?? "var(--humo)" }}>
      {children}
    </span>
  </div>
);

function Fila({ f, editable, enVuelo, error, hecho, onEditar, onEntrar, onSalir }) {
  const adentro = yaParticipa(f);
  return (
    <li
      className="grid items-center rounded-[3px] border py-1"
      style={{ gridTemplateColumns: COLUMNAS, borderColor: "var(--linea)", background: "var(--papel)" }}
    >
      <div className="px-2">
        {f.perfume.foto ? (
          <ConVistaPrevia foto={f.perfume.foto} nombre={f.perfume.nombre}>
            <img src={urlFoto(f.perfume.foto)} alt="" className="h-8 w-8 rounded-[2px] object-cover" />
          </ConVistaPrevia>
        ) : (
          <div className="h-8 w-8 rounded-[2px]" style={{ background: "var(--vidrio-hondo)" }} />
        )}
      </div>
      <div className="min-w-0 px-2">
        <span className="block truncate text-[13px]" style={{ color: "var(--tinta)" }}>
          {f.perfume.nombre}
        </span>
        {(adentro || f.catalogo) && (
          <span className="k-col block" style={{ color: adentro ? "var(--verde)" : "var(--humo)" }}>
            {[adentro && "ya está adentro", f.catalogo && "de catálogo"].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>
      <span className="k-col px-2" style={{ color: "var(--humo)" }}>
        {nombreDePlan(f.plan)}
      </span>
      <Cifra titulo="El precio que tiene publicado hoy, sin promoción">{pesos(f.lista)}</Cifra>
      {/* En una campaña tradicional el precio lo pone el vendedor: se edita acá
          y la ganancia de la fila se recalcula al tipear. En una co-fondeada lo
          define ML, así que va suelto, sin caja. */}
      {editable ? (
        <div
          className="px-1"
          title={
            (f.minimo || f.maximo
              ? `Mercado Libre acepta entre ${pesos(f.minimo)} y ${pesos(f.maximo)}. `
              : "") +
            (f.sugerido ? `Sugiere ${pesos(f.sugerido)}. ` : "") +
            "Lo que escribas acá no se manda hasta confirmar."
          }
        >
          <NumberCell value={f.precio ?? 0} onChange={(v) => onEditar(f.itemId, v)} />
          {(f.minimo || f.maximo) && (
            <span className="k-num block px-1 text-right text-[10px]" style={{ color: "var(--humo-claro)" }}>
              {pesos(f.minimo)}–{pesos(f.maximo)}
            </span>
          )}
        </div>
      ) : (
        <Cifra
          color={f.precio == null ? undefined : "var(--tinta)"}
          titulo={
            f.precio == null
              ? "Mercado Libre todavía no dice a cuánto quedaría en esta campaña."
              : f.paga == null
              ? `Todavía no entró: ${pesos(f.precio)} es el precio que sugiere ML.`
              : "Lo que pagaría el comprador con la promoción puesta."
          }
        >
          {f.precio == null ? "—" : pesos(f.precio)}
          {f.precio != null && f.paga == null ? (
            <span style={{ color: "var(--humo-claro)" }}> sug.</span>
          ) : null}
        </Cifra>
      )}
      <Cifra
        color={f.recibe > f.precio ? "var(--verde)" : undefined}
        titulo={
          f.recibe > f.precio
            ? "La parte del descuento que pone ML: a vos te llega igual."
            : f.precio == null
            ? "Sin precio no se puede saber cuánto pondría ML."
            : "Esta promoción la pagás vos entera."
        }
      >
        {f.recibe > f.precio ? pesos(f.recibe - f.precio) : "—"}
      </Cifra>
      <Cifra color={colorGanancia(f.ganancia)} fuerte titulo={explicar(f)}>
        {f.ganancia == null ? "—" : pesos(f.ganancia)}
      </Cifra>
      <Cifra color={f.margen != null && f.margen <= 0 ? "var(--oxido)" : undefined}>
        {f.margen == null ? "—" : pctCorto(f.margen, 1)}
      </Cifra>
      <Cifra titulo="Lo que te deja hoy ese precio, sin promoción">
        {f.gananciaHoy == null ? "—" : pesos(f.gananciaHoy)}
      </Cifra>
      <Cifra
        color={colorDiferencia(f.diferencia)}
        titulo="Cuánto cambia la ganancia por unidad vendida si entra a la campaña"
      >
        {f.diferencia == null ? "—" : `${f.diferencia >= 0 ? "+" : ""}${pesos(f.diferencia)}`}
      </Cifra>
      {/* Las de catálogo no se tocan desde la app: ML las sincroniza con la
          normal, igual que con el precio. */}
      <div className="px-2">
        {f.catalogo ? (
          <span className="k-col" style={{ color: "var(--humo-claro)" }} title="Las publicaciones de catálogo las maneja Mercado Libre desde la normal.">
            —
          </span>
        ) : (
          <div className="flex flex-col items-start gap-0.5">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={enVuelo || f.ganancia == null}
                onClick={() => onEntrar(f, adentro ? "modificar" : "entrar")}
                className="k-col rounded-[3px] border px-2 py-1 transition disabled:opacity-40"
                style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}
              >
                {enVuelo ? "…" : adentro ? "cambiar" : "entrar"}
              </button>
              {adentro && (
                <button
                  type="button"
                  disabled={enVuelo}
                  onClick={() => onSalir(f)}
                  className="k-col rounded-[3px] px-1 py-1 transition disabled:opacity-40"
                  style={{ color: "var(--oxido)" }}
                >
                  sacar
                </button>
              )}
            </div>
            {error ? (
              <span className="text-[10.5px] leading-tight" style={{ color: "var(--oxido)" }} title={error}>
                {error}
              </span>
            ) : hecho ? (
              <span
                className="text-[10.5px] leading-tight"
                style={{ color: "var(--verde)" }}
                title="Mercado Libre lo aplica en la publicación en unos segundos."
              >
                {hecho}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </li>
  );
}

/* La cuenta completa en una oración, que es donde entra. */
function explicar(f) {
  if (f.ganancia == null) return "Falta el costo o el precio para saber qué deja.";
  const partes = [`El comprador paga ${pesos(f.precio)}`];
  if (f.recibe > f.precio)
    partes.push(`ML pone ${pesos(f.recibe - f.precio)} y a vos te llegan ${pesos(f.recibe)}`);
  partes.push(`menos la comisión (${pctCorto(f.comision)}) y el envío de ML, menos el costo (${pesos(f.costo)})`);
  partes.push(`te quedan ${pesos(f.ganancia)}`);
  if (f.diferencia != null)
    partes.push(
      `${f.diferencia >= 0 ? "ganás" : "perdés"} ${pesos(Math.abs(f.diferencia))} por unidad contra hoy`
    );
  return `${partes.join(", ")}.`;
}
