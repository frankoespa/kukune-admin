import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, RefreshCw, Upload, X } from "lucide-react";
import { actualizarEnML, estadoDePublicacionesML, leerPublicacionML, nombreDePlan, vinculosDe } from "./clienteML";
import { CAMPOS_FICHA, cambiosDeActualizacion, descripcionDesdeTxt, fichaDesdeAtributos, fichaDesdeTxt } from "./armadoML";
import { Aviso, CampoFicha, Paso, SelectorDeFotos, caja, campo, useCarpetaML, useListasFicha } from "./piezasPublicarML";

/* ============================================================
   Actualizar las publicaciones de un perfume que ya existen: fotos, ficha,
   nombre y descripción. Precio y stock siguen en sus botones de siempre.

   · Solo las NORMALES: las de catálogo llevan las fotos y la ficha del producto
     de catálogo de ML (aclaración de Franco).
   · Fotos: las de la carpeta MercadoLibre/ REEMPLAZAN a todas las de ML
     (decisión de Franco). En ML, la lista de fotos que se manda es la final.
   · Fotos, ficha y nombre se sincronizan solos entre las publicaciones del
     mismo User Product: se manda una por producto de usuario y después se
     relee cada una para ver si ML ya les pasó el cambio.
   · Se manda solo lo que cambió (`cambiosDeActualizacion`), con confirmación.
   ============================================================ */

const RELEER_A_LOS = 10000;

export default function ActualizarML({ perfume, planes, onCambiar, onConfirmar, onCerrar, onActualizado }) {
  // Las normales vinculadas, en el orden de los planes.
  const normales = planes.map((plan) => ({ plan, id: vinculosDe(perfume)[plan] })).filter((x) => x.id);
  const ids = normales.map((x) => x.id);

  const [base, setBase] = useState(null); // lo que hay hoy en ML (la primera normal)
  const [todas, setTodas] = useState([]); // estado de todas las normales
  const [errorCarga, setErrorCarga] = useState("");
  const [ficha, setFicha] = useState({});
  const [familyName, setFamilyName] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [reemplazar, setReemplazar] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [control, setControl] = useState(null); // { id → "al día" | "sincronizando" | "distinta" }
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");

  const carpetas = useCarpetaML(perfume, onCambiar);
  const listas = useListasFicha();

  useEffect(() => {
    let vigente = true;
    Promise.all([leerPublicacionML(ids[0]), estadoDePublicacionesML(ids)])
      .then(([b, t]) => {
        if (!vigente) return;
        setBase(b);
        setTodas(t);
        setFicha(fichaDesdeAtributos(b.attributes));
        setFamilyName(b.familyName);
        setDescripcion(b.descripcion);
      })
      .catch((e) => vigente && setErrorCarga(`No se pudo leer la publicación (${e.message}).`));
    return () => {
      vigente = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fichaBase = useMemo(() => (base ? fichaDesdeAtributos(base.attributes) : {}), [base]);

  /* Una por producto de usuario: las del mismo se sincronizan entre sí. Una sin
     producto de usuario va sola. */
  const grupos = useMemo(() => {
    const m = new Map();
    for (const t of todas) {
      const clave = t.userProductId ?? t.id;
      if (!m.has(clave)) m.set(clave, t.id);
    }
    return [...m.values()];
  }, [todas]);

  // El nombre solo se puede cambiar si ninguna publicación del producto vendió.
  const vendidas = todas.reduce((s, t) => s + t.vendidas, 0);
  const nombreTrabado = vendidas > 0;

  const cambios = base
    ? cambiosDeActualizacion(
        { ficha: fichaBase, familyName: base.familyName, descripcion: base.descripcion, fotos: base.fotos.length },
        {
          ficha,
          familyName: nombreTrabado ? base.familyName : familyName,
          descripcion,
          fotos: reemplazar ? carpetas.fotosElegidas : null,
        }
      )
    : { renglones: [] };

  /* ¿Ya tienen el cambio? Fotos: los mismos ids en el mismo orden. Ficha y
     nombre: sin diferencias contra lo pedido. */
  const alDia = (pub, pedido, fotosSubidas) => {
    if (fotosSubidas && pub.fotos.map((f) => f.id).join() !== fotosSubidas.join()) return false;
    const resto = cambiosDeActualizacion(
      { ficha: fichaDesdeAtributos(pub.attributes), familyName: pub.familyName },
      { ficha: pedido.ficha, familyName: pedido.familyName ?? "" }
    );
    return resto.renglones.length === 0;
  };

  const controlar = async (pedido, fotosSubidas, ultima) => {
    try {
      const leidas = await estadoDePublicacionesML(ids);
      const estado = {};
      for (const p of leidas) estado[p.id] = alDia(p, pedido, fotosSubidas) ? "al día" : ultima ? "distinta" : "sincronizando";
      setControl(estado);
      if (!ultima && Object.values(estado).some((e) => e !== "al día"))
        setTimeout(() => controlar(pedido, fotosSubidas, true), RELEER_A_LOS);
    } catch {
      /* el control es informativo: si falla, queda el resultado del PUT */
    }
  };

  const actualizar = () =>
    onConfirmar({
      titulo: "Actualizar en Mercado Libre",
      ancho: "max-w-lg",
      texto: `Se cambia en ${grupos.length === 1 ? "la publicación" : `${grupos.length} publicaciones`} de "${perfume.nombre}" (y ML lo pasa a las demás del mismo producto): ${cambios.renglones
        .map((r) => `${r.campo}: ${r.antes} → ${r.despues}`)
        .join("; ")}.${cambios.fotos ? " Las fotos que hay hoy en la publicación se borran." : ""}`,
      etiquetaOk: "Actualizar en ML",
      peligro: !!cambios.fotos,
      onAceptar: async () => {
        setTrabajando(true);
        setError("");
        setControl(null);
        const pedido = {
          itemIds: grupos,
          carpeta: carpetas.carpeta,
          fotos: cambios.fotos,
          atributos: cambios.atributos,
          familyName: cambios.familyName,
          descripcion: cambios.descripcion,
        };
        try {
          const r = await actualizarEnML(pedido);
          setResultado(r);
          // La ficha nueva queda también en el perfume, como al publicar.
          onCambiar(perfume.id, { fichaML: ficha });
          onActualizado();
          controlar({ ficha, familyName: cambios.familyName }, r.fotos, false);
        } catch (e) {
          setError(e.message);
        } finally {
          setTrabajando(false);
        }
      },
    });

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4" onClick={() => !trabajando && onCerrar()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Actualizar ${perfume.nombre} en Mercado Libre`}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-[5px] shadow-xl"
        style={{ background: "var(--papel)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b px-5 py-3" style={{ borderColor: "var(--linea)" }}>
          <h3 className="text-[15px] font-semibold" style={{ color: "var(--tinta)" }}>
            Actualizar en Mercado Libre · {perfume.nombre}
          </h3>
          <button onClick={onCerrar} disabled={trabajando} aria-label="Cerrar" className="ml-auto rounded-[3px] p-1 disabled:opacity-40" style={{ color: "var(--humo)" }}>
            <X size={16} />
          </button>
        </div>

        <div data-scroll className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          <p className="text-[12px]" style={{ color: "var(--humo)" }}>
            Se actualizan las publicaciones normales ({normales.map((x) => `${nombreDePlan(x.plan)} ${x.id}`).join(", ")}). Las de catálogo
            no se tocan: Mercado Libre les pone las fotos y la ficha de su producto de catálogo. Precio y stock se cambian como siempre.
          </p>
          {errorCarga && <Aviso>{errorCarga}</Aviso>}
          {!base && !errorCarga && (
            <p className="text-[12.5px]" style={{ color: "var(--humo)" }}>
              Leyendo la publicación en Mercado Libre…
            </p>
          )}

          {base && (
            <>
              <Paso n={1} titulo="Fotos">
                <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
                  En Mercado Libre hoy ({base.fotos.length})
                </span>
                <ul className="mb-3 flex flex-wrap gap-1.5">
                  {base.fotos.map((f, i) => (
                    <li key={f.id} className="h-[64px] w-[64px] overflow-hidden rounded-[3px] border" style={{ borderColor: "var(--linea)", opacity: reemplazar ? 0.35 : 1 }} title={i === 0 ? "principal" : f.id}>
                      <img src={f.url} alt="" className="h-full w-full object-cover" />
                    </li>
                  ))}
                </ul>
                <label className={`mb-3 flex items-center gap-2 text-[12.5px] ${carpetas.fotosElegidas.length ? "cursor-pointer" : "opacity-50"}`} style={{ color: reemplazar ? "var(--oxido)" : "var(--tinta)" }}>
                  <input type="checkbox" disabled={!carpetas.fotosElegidas.length} checked={reemplazar && carpetas.fotosElegidas.length > 0} onChange={(e) => setReemplazar(e.target.checked)} />
                  Reemplazar todas por las {carpetas.fotosElegidas.length} tildadas de la carpeta (las de arriba se borran de la publicación)
                </label>
                <SelectorDeFotos carpetas={carpetas} />
              </Paso>

              <Paso n={2} titulo="Ficha técnica">
                <div className="grid gap-4 md:grid-cols-[1fr_240px]">
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                    {CAMPOS_FICHA.map((c) => (
                      <CampoFicha key={c.id} campo={c} valor={ficha[c.id]} valores={listas[c.id]} onCambiar={(v) => setFicha((f) => ({ ...f, [c.id]: v }))} />
                    ))}
                  </div>
                  <div>
                    <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
                      Ficha del texto (referencia)
                    </span>
                    <pre className="whitespace-pre-wrap rounded-[3px] border p-2 text-[11.5px]" style={{ borderColor: "var(--linea)", color: "var(--humo)", fontFamily: "inherit" }}>
                      {fichaDesdeTxt(carpetas.txt) || "Sin publicacion_ml.txt en la carpeta."}
                    </pre>
                  </div>
                </div>
              </Paso>

              <Paso n={3} titulo="Nombre y descripción">
                <label className="block" title={nombreTrabado ? `Ya vendió ${vendidas}: Mercado Libre no deja cambiar el nombre` : ""}>
                  <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
                    Nombre de la publicación {nombreTrabado ? `· trabado: ya tiene ${vendidas} venta${vendidas === 1 ? "" : "s"}` : `(${familyName.trim().length}/120)`}
                  </span>
                  <input value={familyName} disabled={nombreTrabado} maxLength={120} onChange={(e) => setFamilyName(e.target.value)} className={`${campo} disabled:opacity-60`} style={caja} />
                </label>
                <label className="mt-3 block">
                  <span className="k-col mb-1 flex items-center gap-2" style={{ color: "var(--humo)" }}>
                    Descripción
                    {carpetas.txt && (
                      <button type="button" onClick={() => setDescripcion(descripcionDesdeTxt(carpetas.txt))} className="k-col rounded-[3px] border px-1.5 py-0.5" style={{ borderColor: "var(--linea)" }}>
                        Usar la del publicacion_ml.txt
                      </button>
                    )}
                  </span>
                  <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={7} className={campo} style={caja} />
                </label>
              </Paso>

              <Paso n={4} titulo="Qué cambia">
                {cambios.renglones.length === 0 ? (
                  <p className="text-[12.5px]" style={{ color: "var(--humo)" }}>
                    Nada todavía: todo está igual que en Mercado Libre.
                  </p>
                ) : (
                  <ul className="mb-3 grid gap-1">
                    {cambios.renglones.map((r) => (
                      <li key={r.campo} className="grid grid-cols-[160px_1fr] gap-2 rounded-[3px] border px-3 py-1.5 text-[12px]" style={{ borderColor: "var(--linea)" }}>
                        <span style={{ color: "var(--tinta)" }}>{r.campo}</span>
                        <span style={{ color: "var(--humo)" }}>
                          {r.antes} → <span style={{ color: "var(--tinta)" }}>{r.despues}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {grupos.length > 1 && (
                  <p className="mb-2 text-[12px]" style={{ color: "var(--humo)" }}>
                    Las publicaciones están en {grupos.length} productos de usuario distintos: se actualiza una de cada uno.
                  </p>
                )}
                {error && <Aviso>{error}</Aviso>}
                {resultado && <Resultado resultado={resultado} control={control} normales={normales} />}
              </Paso>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--linea)" }}>
          <button
            onClick={actualizar}
            disabled={trabajando || !base || cambios.renglones.length === 0 || !!resultado}
            className="flex items-center gap-1.5 rounded-[3px] px-3.5 py-[7px] text-[12.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "var(--tinta)" }}
          >
            <Upload size={13} /> {trabajando ? "Actualizando…" : "Actualizar en ML"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* Qué pasó con cada PUT y, después, si cada normal ya tiene el cambio. */
function Resultado({ resultado, control, normales }) {
  const planDe = (id) => normales.find((x) => x.id === id)?.plan;
  return (
    <div>
      <ul className="mb-2 grid gap-1.5">
        {resultado.resultados.map((r) => (
          <li key={r.itemId} className="rounded-[3px] border px-3 py-2 text-[12px]" style={{ borderColor: r.ok ? "var(--verde)" : "var(--oxido)" }}>
            <span className="flex items-center gap-1.5 font-medium" style={{ color: r.ok ? "var(--verde)" : "var(--oxido)" }}>
              {r.ok ? <Check size={13} /> : <X size={13} />} <span className="k-num">{r.itemId}</span>: {r.ok ? "Mercado Libre aceptó el cambio" : "no se cambió"}
            </span>
            {r.errores.map((m) => (
              <span key={m} className="block" style={{ color: "var(--oxido)" }}>
                · {m}
              </span>
            ))}
            {r.advertencias.map((m) => (
              <span key={m} className="block" style={{ color: "var(--humo)" }}>
                · {m}
              </span>
            ))}
          </li>
        ))}
      </ul>
      {control && (
        <ul className="grid gap-0.5 text-[12px]">
          {Object.entries(control).map(([id, e]) => (
            <li key={id} className="flex items-center gap-1.5" style={{ color: e === "al día" ? "var(--verde)" : e === "sincronizando" ? "var(--humo)" : "var(--oxido)" }}>
              {e === "sincronizando" ? <RefreshCw size={12} className="animate-spin" /> : e === "al día" ? <Check size={12} /> : <X size={12} />}
              {nombreDePlan(planDe(id))} <span className="k-num">{id}</span>:{" "}
              {e === "al día" ? "ya tiene los cambios" : e === "sincronizando" ? "Mercado Libre todavía la está sincronizando…" : "sigue distinta: revisala en Mercado Libre"}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
