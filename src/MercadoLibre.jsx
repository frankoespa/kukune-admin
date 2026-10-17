import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { urlFoto } from "./almacenamiento";
import { analisisDePrecio, margenesDePlanes, planesPublicables, preciosDePlanes } from "./precios";
import { SelectorRedondeo } from "./TiendaNube";
import { NumberCell } from "./NumberCell";
import { pctSinMiles as pctCorto } from "./numeros";
import { buscarPerfumes, ConVistaPrevia, margenReal, pesos } from "./Catalogo";
import {
  actualizarPublicacionML,
  cambiosParaML,
  enviarCodigoML,
  estadoML,
  leerPublicacionesML,
  nombreDePlan,
  pedirAutorizacionML,
  CAMPO_DE_VINCULO,
  vinculosCatalogoDe,
  vinculosDe,
} from "./clienteML";
import { BandaConexion, CeldaPublicacion, PanelActualizar } from "./MLConexion";
import VentasML from "./VentasML";
import PublicarML from "./PublicarML";
import ActualizarML from "./ActualizarML";

/* ============================================================
   Mercado Libre.

   Salió del catálogo porque ahí ya no entraba: una publicación por plan de pago
   son tres columnas por plan. Los datos NO se mudaron: `preciosML`,
   `margenesML` y `ajustes.cuotasML` siguen en `perfumes.json`, y esta pantalla
   recibe la misma lista resuelta que el catálogo. Nombre, foto y costo se
   editan en el catálogo; acá se ven como referencia.
   ============================================================ */

const PLANES_DE_CUOTAS = [3, 6, 9, 12];
const RELEER_TRAS_ACTUALIZAR = 10000;

/* Misma regla que el catálogo: una sola fuente para encabezado y filas, en línea
   porque la cantidad depende de los planes, y sin `gap` para que la franja de
   color del canal sea continua.

   Columnas: foto · nombre · costo · ganancia directa ‖
             (precio · margen · ganancia · en ML) por cada plan */
const columnasDeML = (planes) =>
  [
    "52px minmax(200px,1fr) 100px 100px",
    planes.map(() => "112px 88px 100px 104px").join(" "),
  ].join(" ");

const anchoMinimo = (planes) => 52 + 200 + 200 + planes.length * 404;

export default function MercadoLibre({
  perfumes,
  ajustes,
  onAjustes,
  onCambiar,
  onSoltarMargenML,
  onConfirmar,
}) {
  const [consulta, setConsulta] = useState("");
  // Precios (lo de siempre) o Ventas (solo lectura). Es de pantalla: no se guarda.
  const [seccion, setSeccion] = useState("precios");
  const [cuenta, setCuenta] = useState(null); // null = preguntando
  const [publicaciones, setPublicaciones] = useState(null);
  const [errorML, setErrorML] = useState("");
  const [trayendo, setTrayendo] = useState(false);
  const [panel, setPanel] = useState(null); // { cambios, perdidos }
  // El perfume que se está publicando (id): el panel lee siempre la versión
  // resuelta y al día, así ve los vínculos que va agregando.
  const [publicandoId, setPublicandoId] = useState(null);
  const publicando = perfumes.find((p) => p.id === publicandoId) ?? null;
  const [actualizandoId, setActualizandoId] = useState(null);
  const actualizando = perfumes.find((p) => p.id === actualizandoId) ?? null;
  /* Un pago siempre, más los planes con comisión cargada: cada uno es una
     publicación distinta en ML y tiene su propio precio. */
  const planes = useMemo(() => planesPublicables(ajustes.cuotasML), [ajustes.cuotasML]);
  const columnas = columnasDeML(planes);

  /* Solo lectura: al entrar se pregunta si hay conexión y se traen las
     publicaciones. Nada de esto escribe ni en ML ni en el catálogo. */
  const traerPublicaciones = useCallback(async () => {
    setTrayendo(true);
    setErrorML("");
    try {
      const pubs = await leerPublicacionesML();
      setPublicaciones(pubs);
      return pubs;
    } catch (e) {
      setErrorML(`No se pudieron traer las publicaciones (${e.message}).`);
      return null;
    } finally {
      setTrayendo(false);
    }
  }, []);

  useEffect(() => {
    let vigente = true;
    estadoML()
      .then((c) => {
        if (!vigente) return;
        setCuenta(c);
        if (c.conectado) traerPublicaciones();
      })
      .catch((e) => vigente && setCuenta({ conectado: false, error: e.message }));
    return () => {
      vigente = false;
    };
  }, [traerPublicaciones]);

  /* Después de mandar precios se relee enseguida (la normal ya cambió) y otra vez
     a los RELEER_TRAS_ACTUALIZAR ms: ML pasa el precio a la de catálogo unos
     segundos después, y sin la segunda lectura quedaba "sincronizando" hasta
     tocar Releer. */
  const segundaLectura = useRef(null);
  useEffect(() => () => clearTimeout(segundaLectura.current), []);
  const releerTrasActualizar = () => {
    traerPublicaciones();
    clearTimeout(segundaLectura.current);
    segundaLectura.current = setTimeout(traerPublicaciones, RELEER_TRAS_ACTUALIZAR);
  };

  /* ML no acepta localhost como redirect: vuelve a kukune.com.ar con el código
     en la dirección, y Franco la pega acá. Es el mismo camino que el script de
     preguntas. */
  const conectar = async () => {
    setErrorML("");
    // La pestaña se abre YA, en el clic, y después se le pone la dirección: si
    // se abriera después del `await`, el navegador lo toma como popup y lo bloquea.
    const ventana = window.open("", "_blank");
    try {
      const { url } = await pedirAutorizacionML();
      if (ventana) {
        ventana.opener = null;
        ventana.location.href = url;
      } else {
        setErrorML(`El navegador no abrió la pestaña. Abrí esta dirección a mano: ${url}`);
      }
      onConfirmar({
        titulo: "Conectar Mercado Libre",
        texto:
          "Se abrió Mercado Libre en otra pestaña. Entrá con la cuenta de KUKUNE y autorizá la app. Te va a mandar a kukune.com.ar: copiá la dirección completa de la barra (la que tiene ?code=TG-…) y pegala acá.",
        conCampo: true,
        marcador: "https://kukune.com.ar/?code=TG-…",
        etiquetaOk: "Conectar",
        onAceptar: async (pegado) => {
          try {
            const c = await enviarCodigoML(pegado);
            setCuenta(c);
            traerPublicaciones();
          } catch (e) {
            setErrorML(`No se pudo conectar (${e.message}).`);
          }
        },
      });
    } catch (e) {
      ventana?.close();
      setErrorML(e.message);
    }
  };

  const pubPorId = useMemo(
    () => new Map((publicaciones ?? []).map((x) => [x.id, x])),
    [publicaciones]
  );

  /* A qué perfume y plan está vinculada cada publicación: el buscador lo marca
     para no vincular la misma dos veces sin darse cuenta. */
  const usadas = useMemo(() => {
    const m = new Map();
    for (const p of perfumes) {
      for (const [plan, id] of Object.entries(vinculosDe(p)))
        m.set(id, `${p.nombre} · ${nombreDePlan(plan)}`);
      for (const [plan, id] of Object.entries(vinculosCatalogoDe(p)))
        m.set(id, `${p.nombre} · ${nombreDePlan(plan)} · catálogo`);
    }
    return m;
  }, [perfumes]);

  // Solo las normales: son las que reciben precio.
  const vinculados = useMemo(
    () => perfumes.reduce((n, p) => n + Object.keys(vinculosDe(p)).length, 0),
    [perfumes]
  );

  /* Lo único que esta pantalla agrega a perfumes.json, y solo cuando se elige.
     `tipo`: "normal" (recibe precios) o "catalogo" (ML la sincroniza sola). */
  const vincular = (perfume, plan, itemId, tipo = "normal") => {
    const campo = CAMPO_DE_VINCULO[tipo];
    const resto = { ...(perfume[campo] ?? {}) };
    if (itemId) resto[plan] = itemId;
    else delete resto[plan];
    onCambiar(perfume.id, { [campo]: Object.keys(resto).length ? resto : undefined });
  };

  const abrirActualizar = async () => {
    // Se releen antes de comparar: el precio en ML pudo cambiar desde que
    // entraste a la pestaña.
    const pubs = await traerPublicaciones();
    if (!pubs) return;
    setPanel(cambiosParaML(perfumes, pubs, planes));
  };

  const cambiarStock = (pub, stock) =>
    onConfirmar({
      titulo: "Cambiar el stock en Mercado Libre",
      texto: `"${pub.titulo}" (${pub.id}): de ${pub.stock} a ${stock} unidades. Se cambia en la publicación real.`,
      etiquetaOk: "Cambiar stock",
      onAceptar: async () => {
        try {
          const r = await actualizarPublicacionML(pub.id, { available_quantity: stock });
          setPublicaciones((ps) => ps.map((x) => (x.id === pub.id ? r.publicacion : x)));
        } catch (e) {
          setErrorML(`No se pudo cambiar el stock de ${pub.id} (${e.message}).`);
        }
      },
    });

  /* Orden alfabético congelado por conjunto, como en el catálogo. Acá no se
     escriben nombres, pero sí precios, y la lista no debe moverse por eso. */
  const orden = useRef({ clave: null, ids: [] });
  const visibles = useMemo(() => {
    const filtrados = buscarPerfumes(perfumes, consulta);
    const porId = new Map(filtrados.map((p) => [p.id, p]));
    const clave = filtrados
      .map((p) => p.id)
      .sort()
      .join(",");
    if (orden.current.clave !== clave) {
      orden.current = {
        clave,
        ids: filtrados
          .slice()
          .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
          .map((p) => p.id),
      };
    }
    return orden.current.ids.map((id) => porId.get(id)).filter(Boolean);
  }, [perfumes, consulta]);

  return (
    <section className="mx-auto max-w-[1480px] px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="k-rotulo mb-1">Mercado Libre</h2>
          <p className="text-[12.5px]" style={{ color: "var(--humo)" }}>
            {seccion === "precios"
              ? "Un precio por plan de pago: cada plan es una publicación aparte. El nombre, la foto y el costo se cargan en el catálogo."
              : "Lo vendido en Mercado Libre y lo que dejó, con la comisión y el envío que cobró ML y el costo de cada perfume cuando se vendió. Solo lectura."}
          </p>
        </div>
        <div className="flex overflow-hidden rounded-[3px] border" style={{ borderColor: "var(--linea)" }}>
          {[
            ["precios", "Precios"],
            ["ventas", "Ventas"],
          ].map(([id, texto]) => (
            <button
              key={id}
              onClick={() => setSeccion(id)}
              aria-pressed={seccion === id}
              className="k-col px-3 py-[7px] transition"
              style={
                seccion === id
                  ? { background: "var(--tinta)", color: "var(--papel)" }
                  : { background: "var(--papel)", color: "var(--humo)" }
              }
            >
              {texto}
            </button>
          ))}
        </div>
      </div>

      {seccion === "precios" && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
              style={{ color: "var(--humo-claro)" }}
            />
            <input
              value={consulta}
              onChange={(e) => setConsulta(e.target.value)}
              placeholder="Buscar"
              className="w-[260px] rounded-[3px] border py-1.5 pl-8 pr-2 text-[12.5px]"
              style={{ background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" }}
            />
          </div>
        </div>
      )}

      <BandaConexion
        cuenta={cuenta}
        publicaciones={publicaciones}
        vinculados={vinculados}
        trayendo={trayendo}
        onConectar={conectar}
        onRefrescar={traerPublicaciones}
        onActualizar={abrirActualizar}
      />
      {errorML && (
        <p className="mb-4 text-[12.5px]" style={{ color: "var(--oxido)" }}>
          {errorML}
        </p>
      )}

      {seccion === "ventas" ? (
        <VentasML perfumes={perfumes} cuenta={cuenta} />
      ) : (
        <>
          <AjustesML ajustes={ajustes} onAjustes={onAjustes} />

          {panel && (
            <PanelActualizar {...panel} onCerrar={() => setPanel(null)} onTerminado={releerTrasActualizar} />
          )}

          {publicando && (
            <PublicarML
              perfume={publicando}
              ajustes={ajustes}
              planes={planes}
              onAjustes={onAjustes}
              onCambiar={onCambiar}
              onConfirmar={onConfirmar}
              onCerrar={() => setPublicandoId(null)}
              onPublicado={releerTrasActualizar}
            />
          )}

          {actualizando && (
            <ActualizarML
              perfume={actualizando}
              planes={planes}
              onCambiar={onCambiar}
              onConfirmar={onConfirmar}
              onCerrar={() => setActualizandoId(null)}
              onActualizado={releerTrasActualizar}
            />
          )}

          {visibles.length === 0 ? (
            <p className="py-12 text-center text-[13px]" style={{ color: "var(--humo-claro)" }}>
              {perfumes.length === 0
                ? "El catálogo está vacío. Los perfumes se agregan en la pestaña Catálogo."
                : "Ningún perfume coincide con la búsqueda."}
            </p>
          ) : (
            <div className="overflow-x-auto pb-2">
              <div style={{ minWidth: anchoMinimo(planes) }}>
                <EncabezadoML planes={planes} columnas={columnas} />
                <ul className="grid gap-1.5">
                  {visibles.map((p) => (
                    <FilaML
                      key={p.id}
                      perfume={p}
                      ajustes={ajustes}
                      planes={planes}
                      columnas={columnas}
                      onCambiar={onCambiar}
                      onSoltarMargenML={onSoltarMargenML}
                      conectado={!!cuenta?.conectado}
                      publicaciones={publicaciones}
                      pubPorId={pubPorId}
                      usadas={usadas}
                      onVincular={vincular}
                      onStock={cambiarStock}
                      onPublicar={() => setPublicandoId(p.id)}
                      onActualizar={() => setActualizandoId(p.id)}
                    />
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* La caja lleva el color de la franja que configura, como en el catálogo. */
function AjustesML({ ajustes, onAjustes }) {
  return (
    <div className="mb-5 flex flex-wrap items-stretch gap-3">
      <div
        className="flex-1 rounded-[4px] border px-3 py-2.5"
        style={{ background: "var(--zona-ml)", borderColor: "var(--zona-ml-honda)" }}
      >
        <span className="k-col mb-2 block" style={{ color: "var(--tinta)" }}>
          Mercado Libre
        </span>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <label className="block">
            <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
              Comision
            </span>
            <div className="w-[88px]">
              <NumberCell
                value={+((ajustes.comisionML || 0) * 100).toFixed(2)}
                onChange={(v) => onAjustes({ comisionML: v / 100 })}
                suffix="%"
              />
            </div>
          </label>
          <label className="block">
            <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
              Envio ML
            </span>
            <div className="w-[96px]">
              <NumberCell value={ajustes.envioML || 0} onChange={(v) => onAjustes({ envioML: v })} />
            </div>
          </label>
          <SelectorRedondeo
            valor={ajustes.redondeoML}
            onCambiar={(redondeoML) => onAjustes({ redondeoML })}
          />

          {/* Comision EXTRA de cada plan: ML la cobra ademas de la comision
              normal, sobre el mismo precio publicado. */}
          <div>
            <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
              Comision extra por cuotas
            </span>
            <div className="flex items-end gap-2">
              {PLANES_DE_CUOTAS.map((n) => (
                <label key={n} className="block">
                  <span className="k-col mb-1 block text-center" style={{ color: "var(--humo-claro)" }}>
                    {n}x
                  </span>
                  <div className="w-[78px]">
                    <NumberCell
                      value={+((ajustes.cuotasML?.[n] || 0) * 100).toFixed(2)}
                      onChange={(v) =>
                        onAjustes({ cuotasML: { ...(ajustes.cuotasML || {}), [n]: v / 100 } })
                      }
                      suffix="%"
                    />
                  </div>
                </label>
              ))}
            </div>
            <p className="mt-1.5 text-[11px]" style={{ color: "var(--humo)" }}>
              El plan que tenga comision cargada aparece como columna: es una
              publicacion aparte, con su propio precio.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Dos niveles, como el catálogo: una banda por plan arriba y las columnas
   abajo. Mismas `columnas` y mismo `border` transparente que las filas. */
function EncabezadoML({ planes, columnas }) {
  const col = (texto, fondo, alineado = "text-right") => (
    <span className={`k-col px-2 py-1.5 ${alineado}`} style={{ background: fondo, color: "var(--humo)" }}>
      {texto}
    </span>
  );

  return (
    <div className="sticky top-0 z-[5] pb-1.5 pt-1" style={{ background: "var(--vidrio)" }}>
      <div className="grid items-center border border-transparent" style={{ gridTemplateColumns: columnas }}>
        <span className="col-span-2 k-col px-2 py-1.5" style={{ color: "var(--humo)" }}>
          Perfume
        </span>
        <span
          className="col-span-2 k-col px-2 py-1.5"
          style={{ background: "var(--zona-directa-honda)", color: "var(--tinta)" }}
        >
          Referencia
        </span>
        {planes.map((plan) => (
          <span
            key={plan}
            className="k-col px-2 py-1.5"
            style={{ background: "var(--zona-ml-honda)", color: "var(--tinta)", gridColumn: "span 4" }}
          >
            Mercado Libre · {nombreDePlan(plan)}
          </span>
        ))}
      </div>
      <div className="grid items-center border border-transparent" style={{ gridTemplateColumns: columnas }}>
        <span />
        {col("Perfume", "transparent", "text-left")}
        {col("Costo", "var(--zona-directa)")}
        {col("Gan. directa", "var(--zona-directa)")}
        {planes.map((plan) => (
          <Fragment key={plan}>
            {col("Precio", "var(--zona-ml)")}
            {col("Margen", "var(--zona-ml)")}
            {col("Ganancia", "var(--zona-ml)")}
            {col("En ML", "var(--zona-ml)")}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

const colorGanancia = (g) =>
  g === null ? "var(--humo-claro)" : g >= 0 ? "var(--ambar)" : "var(--oxido)";

function FilaML({
  perfume,
  ajustes,
  planes,
  columnas,
  onCambiar,
  onSoltarMargenML,
  conectado,
  publicaciones,
  pubPorId,
  usadas,
  onVincular,
  onStock,
  onPublicar,
  onActualizar,
}) {
  const r = analisisDePrecio({
    costo: perfume.costo,
    precioPublico: perfume.precioPublico,
    perfume,
    comisionML: ajustes.comisionML,
    envioML: ajustes.envioML,
    envioLocal: ajustes.envioLocal,
    cuotasML: ajustes.cuotasML,
    planes,
    redondeoML: ajustes.redondeoML,
  });
  const sinCosto = !(Number(perfume.costo) > 0);

  const cifra = (contenido, { fondo, color, titulo, fuerte }) => (
    <div className="px-2 text-right" style={{ background: fondo }} title={titulo}>
      <span
        className={`k-num text-[13px] ${fuerte ? "font-semibold" : ""}`}
        style={{ color: color ?? "var(--humo)" }}
      >
        {contenido}
      </span>
    </div>
  );

  /* Clavar el margen de un plan: el precio de ESE plan pasa a salir de acá.
     Los demás planes y la venta directa no se enteran. */
  const ponerMargen = (plan, margen) =>
    onCambiar(perfume.id, {
      margenesML: { ...margenesDePlanes(perfume), [plan]: margen },
    });

  /* Cada plan guarda su precio. Al escribir el mapa nuevo se deja de escribir el
     `precioML` viejo: su valor ya vive en `preciosML["1"]` y tener los dos sería
     tener dos verdades. */
  const ponerPrecio = (plan, valor) =>
    onCambiar(perfume.id, {
      preciosML: { ...preciosDePlanes(perfume), [plan]: valor },
      precioML: undefined,
    });

  return (
    <li
      className="group grid items-center overflow-hidden rounded-[4px] border py-1.5"
      style={{ gridTemplateColumns: columnas, borderColor: "var(--linea)", background: "var(--papel)" }}
    >
      <div className="px-1.5">
        <ConVistaPrevia archivo={perfume.foto} nombre={perfume.nombre}>
          <div
            className="h-[46px] w-[46px] overflow-hidden rounded-[3px] border"
            style={{
              borderColor: "var(--linea)",
              borderStyle: perfume.foto ? "solid" : "dashed",
              background: perfume.foto ? "var(--papel)" : "#F4F6F2",
            }}
          >
            {perfume.foto && (
              <img
                src={urlFoto(perfume.foto)}
                alt={`Foto de ${perfume.nombre}`}
                className="h-full w-full object-cover"
              />
            )}
          </div>
        </ConVistaPrevia>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 px-2">
        <span className="truncate text-[13px]" style={{ color: "var(--tinta)" }} title={perfume.nombre}>
          {perfume.nombre}
        </span>
        {/* Publicar aparece al pasar el mouse, como el "=": solo si algún plan
            todavía no tiene publicación vinculada. */}
        {conectado && planes.some((plan) => !vinculosDe(perfume)[plan]) && (
          <button
            type="button"
            onClick={onPublicar}
            title={`Publicar ${perfume.nombre} en Mercado Libre (los planes sin publicación)`}
            className="k-col shrink-0 rounded-[3px] border px-1.5 py-0.5 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
            style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
          >
            Publicar
          </button>
        )}
        {/* Fotos, ficha, nombre y descripción de lo ya publicado (solo las normales). */}
        {conectado && planes.some((plan) => vinculosDe(perfume)[plan]) && (
          <button
            type="button"
            onClick={onActualizar}
            title={`Actualizar fotos, ficha, nombre o descripción de ${perfume.nombre} en Mercado Libre`}
            className="k-col shrink-0 rounded-[3px] border px-1.5 py-0.5 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
            style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
          >
            Actualizar
          </button>
        )}
      </div>

      {cifra(sinCosto ? "—" : pesos(perfume.costo), {
        fondo: "var(--zona-directa)",
        color: sinCosto ? "var(--humo-claro)" : "var(--tinta)",
        titulo: "El costo se cambia en el catálogo",
      })}
      {cifra(r.directo.ganancia === null ? "—" : pesos(r.directo.ganancia), {
        fondo: "var(--zona-directa)",
        color: colorGanancia(r.directo.ganancia),
        titulo:
          r.directo.ganancia === null
            ? "Sin precio de venta directa en el catálogo"
            : `Vendiendo directo a ${pesos(perfume.precioPublico)}. Es la ganancia que iguala el "=" de cada plan.`,
      })}

      {/* ---- Una publicación de Mercado Libre por plan ----
           Mismo trato que la venta directa: precio y margen son un par, y con el
           margen clavado el precio pasa a ser calculado. Cada plan se clava por
           separado — podés tener 1 pago a mano y 6 cuotas clavado. */}
      {r.ml.map((x) => (
        <Fragment key={x.plan}>
          <div className="flex items-center gap-1 px-1.5" style={{ background: "var(--zona-ml)" }}>
            {x.margenObjetivo != null ? (
              <div className="flex-1 px-0.5 text-right">
                <span className="k-num text-[13px] font-semibold" style={{ color: "var(--tinta)" }}>
                  {x.precio > 0 ? pesos(x.precio) : "—"}
                </span>
              </div>
            ) : (
              <>
                <div className="min-w-0 flex-1">
                  <NumberCell value={x.precio || 0} onChange={(v) => ponerPrecio(x.plan, v)} />
                </div>
                {/* Atajo, no obligación: completa el precio que en ESTE plan deja
                    la misma ganancia que vendiendo directo. */}
                {x.sugerido !== null && x.sugerido !== x.precio && (
                  <button
                    onClick={() => ponerPrecio(x.plan, x.sugerido)}
                    title={`Poner ${pesos(x.sugerido)}: publicando a ese precio en ${nombreDePlan(
                      x.plan
                    )} te queda lo mismo que vendiendo directo`}
                    aria-label={`Igualar el precio de ${nombreDePlan(x.plan)} de ${
                      perfume.nombre
                    } a la ganancia directa`}
                    className="k-num shrink-0 px-1 text-[13px] opacity-0 transition group-hover:opacity-100 focus:opacity-100"
                    style={{ color: "var(--humo)" }}
                  >
                    =
                  </button>
                )}
              </>
            )}
          </div>
          <div
            className="relative px-1.5"
            style={{ background: "var(--zona-ml)" }}
            title={x.margenObjetivo != null ? margenReal(x.margenObjetivo, x.margen) : undefined}
          >
            {sinCosto ? (
              <div className="px-0.5 text-right" title="Cargá el costo en el catálogo para poder fijar un margen">
                <span className="k-num text-[13px]" style={{ color: "var(--humo-claro)" }}>
                  —
                </span>
              </div>
            ) : (
              <NumberCell
                value={+((x.margenObjetivo ?? x.margen ?? 0) * 100).toFixed(1)}
                onChange={(v) => ponerMargen(x.plan, v / 100)}
                suffix="%"
                className={x.margenObjetivo != null ? "font-semibold" : ""}
                style={
                  x.margenObjetivo != null
                    ? { borderLeft: "3px solid var(--ambar)", background: "#FFFDF7" }
                    : undefined
                }
              />
            )}
            {x.margenObjetivo != null && (
              <button
                type="button"
                onClick={() => onSoltarMargenML(perfume.id, x.plan, x.precio)}
                title="Soltar el margen y volver a poner el precio a mano"
                aria-label={`Soltar el margen de ${nombreDePlan(x.plan)} de ${perfume.nombre}`}
                className="absolute -right-0.5 -top-1.5 rounded-full bg-white p-0.5 transition"
                style={{ color: "var(--humo)", boxShadow: "0 0 0 1px var(--linea)" }}
              >
                <X size={10} />
              </button>
            )}
          </div>
          {cifra(x.ganancia === null ? "—" : pesos(x.ganancia), {
            fondo: "var(--zona-ml)",
            color: colorGanancia(x.ganancia),
            fuerte: true,
            titulo:
              x.ganancia === null
                ? `Poné costo y precio para ver qué te deja en ${nombreDePlan(x.plan)}`
                : `En ${nombreDePlan(x.plan)}, después de la comisión (${pctCorto(
                    x.comision
                  )}) y el envío de ML: ${pesos(x.ganancia)}.` +
                  (x.sugerido === null
                    ? ""
                    : ` Para igualar la venta directa habría que publicar ${pesos(x.sugerido)}.`),
          })}
          <CeldaPublicacion
            perfume={perfume}
            plan={x.plan}
            precioCatalogo={x.precio}
            itemId={vinculosDe(perfume)[x.plan]}
            itemCatalogo={vinculosCatalogoDe(perfume)[x.plan]}
            conectado={conectado}
            publicaciones={publicaciones}
            pubPorId={pubPorId}
            usadas={usadas}
            onVincular={onVincular}
            onStock={onStock}
          />
        </Fragment>
      ))}
    </li>
  );
}
