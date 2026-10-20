import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, Check, RefreshCw, RotateCcw, Upload, X } from "lucide-react";
import { actualizarEnML, estadoDePublicacionesML, leerPublicacionML, nombreDePlan, urlDeCarpetaML, vinculosDe } from "./clienteML";
import { CAMPOS_FICHA, cambiosDeActualizacion, descripcionDesdeTxt, fichaDesdeAtributos, fichaDesdeTxt } from "./armadoML";
import { Aviso, CampoFicha, Paso, SelectorDeFotos, caja, campo, usable, useCarpetaML, useListasFicha } from "./piezasPublicarML";

/* ============================================================
   Actualizar las publicaciones de un perfume que ya existen: fotos, ficha,
   nombre y descripción. Precio y stock siguen en sus botones de siempre.

   · Solo las NORMALES: las de catálogo llevan las fotos y la ficha del producto
     de catálogo de ML (aclaración de Franco).
   · Fotos: se arma la tira final ("Así va a quedar"), que arranca igual a la
     de hoy: se quitan, se mueven y se suman las de la carpeta MercadoLibre/.
     En ML la lista que se manda es la final: lo que no va, se borra.
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
  // La tira final: { tipo: "ml", id, url } | { tipo: "carpeta", archivo }. null hasta leer ML.
  const [tira, setTira] = useState(null);
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
        setTira(b.fotos.map((f) => ({ tipo: "ml", id: f.id, url: f.url })));
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
        { ficha: fichaBase, familyName: base.familyName, descripcion: base.descripcion, fotos: base.fotos.map((f) => f.id) },
        {
          ficha,
          familyName: nombreTrabado ? base.familyName : familyName,
          descripcion,
          fotos: tira,
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
        .join("; ")}.${cambios.quitadas ? cambios.quitadas === 1 ? " Se borra 1 foto de la publicación." : ` Se borran ${cambios.quitadas} fotos de la publicación.` : ""}`,
      etiquetaOk: "Actualizar en ML",
      peligro: cambios.quitadas > 0,
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
                <TiraDeFotos
                  base={base.fotos}
                  tira={tira ?? []}
                  setTira={setTira}
                  carpeta={carpetas.carpeta}
                  deLaCarpeta={carpetas.fotos.filter(usable).map((f) => f.archivo)}
                  bloqueada={trabajando || !!resultado}
                />
                <span className="k-col mb-1 mt-4 block" style={{ color: "var(--humo)" }}>
                  Fotos de la carpeta
                </span>
                <SelectorDeFotos
                  carpetas={carpetas}
                  enLaTira={new Set((tira ?? []).filter((f) => f.tipo === "carpeta").map((f) => f.archivo))}
                  onAgregar={(archivo) => !trabajando && !resultado && setTira((t) => [...(t ?? []), { tipo: "carpeta", archivo }])}
                />
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

/* La tira de fotos tal como va a quedar en la publicación, en orden (la
   primera es la principal). Arranca igual a la de hoy; lo que se saca queda
   abajo para volver a ponerlo. */
function TiraDeFotos({ base, tira, setTira, carpeta, deLaCarpeta, bloqueada }) {
  const quitadas = base.filter((f) => !tira.some((t) => t.tipo === "ml" && t.id === f.id));
  const mover = (i, d) =>
    setTira((t) => {
      const j = i + d;
      if (j < 0 || j >= t.length) return t;
      const n = [...t];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const quitar = (i) => setTira((t) => t.filter((_, k) => k !== i));
  const igual = tira.length === base.length && tira.every((t, i) => t.tipo === "ml" && t.id === base[i].id);
  const boton = "k-col rounded-[3px] border px-2 py-[5px] disabled:opacity-40";
  const flecha = "rounded-[2px] p-0.5 disabled:opacity-25";
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="k-col" style={{ color: "var(--humo)" }}>
          Así va a quedar ({tira.length}) · hoy en Mercado Libre: {base.length}
        </span>
        <button
          type="button"
          disabled={bloqueada || igual}
          onClick={() => setTira(base.map((f) => ({ tipo: "ml", id: f.id, url: f.url })))}
          className={`${boton} ml-auto flex items-center gap-1`}
          style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
        >
          <RotateCcw size={11} /> Volver a como está en ML
        </button>
        <button
          type="button"
          disabled={bloqueada || !deLaCarpeta.length}
          onClick={() => setTira(deLaCarpeta.map((archivo) => ({ tipo: "carpeta", archivo })))}
          className={boton}
          style={{ borderColor: "var(--oxido)", color: "var(--oxido)" }}
          title="Saca todas las de Mercado Libre y deja las de la carpeta, en orden de nombre"
        >
          Reemplazar todo por la carpeta ({deLaCarpeta.length})
        </button>
      </div>
      {tira.length === 0 ? (
        <Aviso>La publicación tiene que quedar con al menos una foto.</Aviso>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {tira.map((f, i) => (
            <li key={f.tipo === "ml" ? f.id : `c:${f.archivo}`} className="w-[96px]">
              <div
                className="relative h-[96px] w-[96px] overflow-hidden rounded-[3px] border"
                style={{ borderColor: f.tipo === "carpeta" ? "var(--verde)" : "var(--linea)" }}
                title={f.tipo === "ml" ? f.id : f.archivo}
              >
                <img src={f.tipo === "ml" ? f.url : urlDeCarpetaML(carpeta, f.archivo)} alt="" className="h-full w-full object-cover" />
                {i === 0 && (
                  <span className="k-col absolute left-1 top-1 rounded-[2px] px-1" style={{ background: "var(--tinta)", color: "var(--papel)" }}>
                    principal
                  </span>
                )}
                {f.tipo === "carpeta" && (
                  <span className="k-col absolute bottom-1 left-1 rounded-[2px] px-1" style={{ background: "var(--verde)", color: "var(--papel)" }}>
                    nueva
                  </span>
                )}
                <button
                  type="button"
                  disabled={bloqueada}
                  onClick={() => quitar(i)}
                  aria-label="Quitar esta foto"
                  title="Quitar esta foto"
                  className="absolute right-1 top-1 rounded-full bg-white p-0.5 disabled:opacity-40"
                  style={{ color: "var(--oxido)", boxShadow: "0 0 0 1px var(--linea)" }}
                >
                  <X size={11} />
                </button>
              </div>
              <span className="mt-1 flex items-center justify-between">
                <button type="button" disabled={bloqueada || i === 0} onClick={() => mover(i, -1)} aria-label="Mover a la izquierda" className={flecha} style={{ color: "var(--humo)" }}>
                  <ArrowLeft size={13} />
                </button>
                <span className="k-num text-[11px]" style={{ color: "var(--humo)" }}>
                  {i + 1}
                </span>
                <button
                  type="button"
                  disabled={bloqueada || i === tira.length - 1}
                  onClick={() => mover(i, 1)}
                  aria-label="Mover a la derecha"
                  className={flecha}
                  style={{ color: "var(--humo)" }}
                >
                  <ArrowRight size={13} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {quitadas.length > 0 && (
        <div className="mt-3">
          <span className="k-col mb-1 block" style={{ color: "var(--oxido)" }}>
            Se borran de la publicación ({quitadas.length})
          </span>
          <ul className="flex flex-wrap gap-1.5">
            {quitadas.map((f) => (
              <li key={f.id} className="w-[72px]">
                <div className="h-[64px] w-[64px] overflow-hidden rounded-[3px] border" style={{ borderColor: "var(--linea)", opacity: 0.4 }}>
                  <img src={f.url} alt="" className="h-full w-full object-cover" />
                </div>
                <button
                  type="button"
                  disabled={bloqueada}
                  onClick={() => setTira((t) => [...t, { tipo: "ml", id: f.id, url: f.url }])}
                  className="k-col mt-0.5 disabled:opacity-40"
                  style={{ color: "var(--tinta)" }}
                >
                  Volver a poner
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
