import { useMemo, useRef, useState } from "react";
import { Plus, Search, Trash2, X } from "lucide-react";
import { urlFoto } from "./almacenamiento";
import { objetivoDirecto } from "./precios";
import { NumberCell } from "./NumberCell";
import { CampoProtegido } from "./CampoProtegido";
import { SelectorRedondeo } from "./TiendaNube";
import { buscarPerfumes, ConVistaPrevia, pesos } from "./Catalogo";
import { pctSinMiles } from "./numeros";
import {
  CLAVES_DIRECTO,
  CLAVES_TN,
  costoPorMl,
  formatoMl,
  nombreDeTipo,
  tiposDeDecant,
  vendibleDeDecant,
} from "./cuentasDecant";

/* ============================================================
   Decants: porciones chicas de un perfume, en su frasquito y su caja.

   Acá se definen los TIPOS (ml + costo de frasco y caja + el objetivo de
   precio por defecto, para venta directa y para Tiendanube), se asignan a los
   perfumes y se ve la venta directa de cada uno. Lo de Tiendanube vive en la
   pestaña Tiendanube, modo Decants: ahí está todo lo que ya existe para los
   frascos (detalle por forma de pago, cupones, ofertas, Actualizar precios).

   Las cuentas están en `cuentasDecant.js`. El costo de un decant no se guarda:
   sale del costo del perfume ÷ sus ml × los ml del decant + frasco + caja.
   ============================================================ */

const ANCHO_FIJO = "52px minmax(200px,1fr) 56px 84px";
const ANCHO_TIPO = "40px 84px 104px 84px 96px";
const columnasDe = (n) => [ANCHO_FIJO, ...Array.from({ length: n }, () => ANCHO_TIPO)].join(" ");

const colorGanancia = (g) => (g === null ? "var(--humo-claro)" : g >= 0 ? "var(--ambar)" : "var(--oxido)");

const nuevoId = () => crypto.randomUUID().slice(0, 8);

export default function PestanaDecants({ perfumes, ajustes, onAjustes, onCambiar, onAsignar, onFijarObjetivo, onSoltarMargen, onConfirmar }) {
  const [consulta, setConsulta] = useState("");
  const [soloSinMl, setSoloSinMl] = useState(false);
  const [soloConDecant, setSoloConDecant] = useState(false);
  const tipos = tiposDeDecant(ajustes);
  const decants = ajustes.decants ?? {};
  const columnas = columnasDe(tipos.length);

  const guardarDecants = (cambios) => onAjustes({ decants: { ...decants, tipos, ...cambios } });
  const cambiarTipo = (id, campos) => guardarDecants({ tipos: tipos.map((t) => (t.id === id ? { ...t, ...campos } : t)) });

  const agregarTipo = () =>
    guardarDecants({ tipos: [...tipos, { id: nuevoId(), ml: 10, costoFrasco: 0, costoCaja: 0 }] });

  const usosDeTipo = (tipoId) => {
    const con = perfumes.filter((p) => (p.decants ?? []).some((e) => e.tipo === tipoId));
    const publicados = con.filter((p) => p.decants.find((e) => e.tipo === tipoId)?.publicacionTN).length;
    return { con, publicados };
  };

  const quitarTipo = (tipo) => {
    const { con, publicados } = usosDeTipo(tipo.id);
    onConfirmar({
      titulo: `¿Quitar el decant de ${nombreDeTipo(tipo)}?`,
      texto:
        con.length === 0
          ? "No está asignado a ningún perfume."
          : `Está asignado a ${con.length} perfume${con.length === 1 ? "" : "s"}: se le saca a todos, con sus precios.` +
            (publicados > 0
              ? ` ${publicados} ya ${publicados === 1 ? "tiene" : "tienen"} la variante publicada en Tiendanube: esa variante queda en la tienda y hay que sacarla a mano.`
              : ""),
      etiquetaOk: "Quitar",
      peligro: con.length > 0,
      onAceptar: () => {
        if (con.length) onAsignar(con.map((p) => p.id), tipo.id, false);
        guardarDecants({ tipos: tipos.filter((t) => t.id !== tipo.id) });
      },
    });
  };

  /* Orden alfabético congelado por conjunto, como en el catálogo: acá se
     escriben precios y la lista no se mueve por eso. */
  const orden = useRef({ clave: null, ids: [] });
  const visibles = useMemo(() => {
    let base = perfumes;
    if (soloSinMl) base = base.filter((p) => !(Number(p.ml) > 0));
    if (soloConDecant) base = base.filter((p) => (p.decants ?? []).length > 0);
    const filtrados = buscarPerfumes(base, consulta);
    const porId = new Map(filtrados.map((p) => [p.id, p]));
    const clave = filtrados.map((p) => p.id).sort().join(",");
    if (orden.current.clave !== clave)
      orden.current = { clave, ids: filtrados.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es")).map((p) => p.id) };
    return orden.current.ids.map((id) => porId.get(id)).filter(Boolean);
  }, [perfumes, consulta, soloSinMl, soloConDecant]);

  const sinMl = perfumes.filter((p) => !(Number(p.ml) > 0)).length;
  const conDecant = perfumes.filter((p) => (p.decants ?? []).length > 0).length;

  /* Ofrecer o sacar un tipo en todos los que se ven, con confirmación. Sacar
     avisa cuántas variantes de Tiendanube quedan publicadas. */
  const ofrecerEnVisibles = (tipo, ofrecer) => {
    const cuales = visibles.filter((p) => (p.decants ?? []).some((e) => e.tipo === tipo.id) !== ofrecer);
    if (!cuales.length) return;
    const publicados = ofrecer ? 0 : cuales.filter((p) => p.decants.find((e) => e.tipo === tipo.id)?.publicacionTN).length;
    onConfirmar({
      titulo: `${ofrecer ? "Ofrecer" : "Dejar de ofrecer"} el decant de ${nombreDeTipo(tipo)} en ${cuales.length} perfume${cuales.length === 1 ? "" : "s"}`,
      texto:
        (ofrecer
          ? "Toman el precio del tipo. Los que no tienen los ml del frasco quedan sin costo hasta que los cargues."
          : "Se pierden los precios propios de esos decants.") +
        (publicados > 0 ? ` ${publicados} tienen la variante publicada en Tiendanube: queda en la tienda y hay que sacarla a mano.` : "") +
        (consulta.trim() || soloSinMl || soloConDecant ? " Son solo los que se ven con la búsqueda o el filtro puestos." : ""),
      etiquetaOk: ofrecer ? "Ofrecer" : "Dejar de ofrecer",
      peligro: !ofrecer,
      onAceptar: () => onAsignar(cuales.map((p) => p.id), tipo.id, ofrecer),
    });
  };

  const quitarUno = (perfume, tipo) => {
    const e = (perfume.decants ?? []).find((x) => x.tipo === tipo.id);
    if (!e?.publicacionTN) return onAsignar([perfume.id], tipo.id, false);
    onConfirmar({
      titulo: `¿Dejar de ofrecer el decant de ${nombreDeTipo(tipo)} de "${perfume.nombre}"?`,
      texto: "Tiene la variante publicada en Tiendanube: queda en la tienda y hay que sacarla a mano.",
      etiquetaOk: "Dejar de ofrecer",
      peligro: true,
      onAceptar: () => onAsignar([perfume.id], tipo.id, false),
    });
  };

  return (
    <section className="mx-auto max-w-[1480px] px-6 py-8">
      <div className="mb-6">
        <h2 className="k-rotulo mb-1">Decants</h2>
        <p className="text-[12.5px]" style={{ color: "var(--humo)" }}>
          El costo de cada decant sale del costo del perfume por ml, más su frasco y su caja. Acá se
          arman los tipos y la venta directa; los precios de Tiendanube están en la pestaña
          Tiendanube, modo Decants.
        </p>
      </div>

      <CajaDeTipos
        tipos={tipos}
        decants={decants}
        formas={ajustes.tiendaNube?.formas ?? []}
        usosDeTipo={usosDeTipo}
        onCambiarTipo={cambiarTipo}
        onAgregar={agregarTipo}
        onQuitar={quitarTipo}
        onRedondeo={(campo, valor) => guardarDecants({ [campo]: valor })}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--humo-claro)" }} />
          <input
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Buscar"
            className="w-[260px] rounded-[3px] border py-1.5 pl-8 pr-2 text-[12.5px]"
            style={{ background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" }}
          />
        </div>
        {/* Misma regla que los filtros del catálogo: no desaparece con el filtro puesto. */}
        {(sinMl > 0 || soloSinMl) && (
          <button
            onClick={() => setSoloSinMl((v) => !v)}
            aria-pressed={soloSinMl}
            title="No tienen cargados los ml del frasco (se cargan en el catálogo): sus decants no tienen costo."
            className="k-col rounded-[3px] border px-3 py-[7px] transition"
            style={{
              borderColor: soloSinMl ? "var(--tinta)" : "var(--linea)",
              color: soloSinMl ? "var(--tinta)" : "var(--humo)",
              background: soloSinMl ? "var(--vidrio-hondo)" : "transparent",
            }}
          >
            {soloSinMl && sinMl === 0 ? "Ver todos" : `${sinMl} sin ml`}
          </button>
        )}
        {(conDecant > 0 || soloConDecant) && (
          <button
            onClick={() => setSoloConDecant((v) => !v)}
            aria-pressed={soloConDecant}
            className="k-col rounded-[3px] border px-3 py-[7px] transition"
            style={{
              borderColor: soloConDecant ? "var(--tinta)" : "var(--linea)",
              color: soloConDecant ? "var(--tinta)" : "var(--humo)",
              background: soloConDecant ? "var(--zona-decant)" : "transparent",
            }}
          >
            {soloConDecant && conDecant === 0 ? "Ver todos" : `${conDecant} con decants`}
          </button>
        )}
        {tipos.map((t) => {
          const faltan = visibles.filter((p) => !(p.decants ?? []).some((e) => e.tipo === t.id)).length;
          const tienen = visibles.length - faltan;
          return (
            <span key={t.id} className="flex items-center gap-1">
              {faltan > 0 && (
                <button
                  onClick={() => ofrecerEnVisibles(t, true)}
                  className="k-col rounded-[3px] border px-3 py-[7px]"
                  style={{ borderColor: "var(--linea)", color: "var(--tinta)" }}
                >
                  Ofrecer {nombreDeTipo(t)} en {faltan}
                </button>
              )}
              {tienen > 0 && (
                <button
                  onClick={() => ofrecerEnVisibles(t, false)}
                  className="k-col rounded-[3px] border px-2 py-[7px]"
                  style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
                  title={`Dejar de ofrecer el de ${nombreDeTipo(t)} en los ${tienen} que se ven`}
                >
                  sacar {nombreDeTipo(t)}
                </button>
              )}
            </span>
          );
        })}
      </div>

      {tipos.length === 0 ? (
        <p className="py-12 text-center text-[13px]" style={{ color: "var(--humo-claro)" }}>
          Todavía no hay tipos de decant. Agregá uno arriba (por ejemplo, 10 ml con el costo de su frasco y su caja).
        </p>
      ) : visibles.length === 0 ? (
        <p className="py-12 text-center text-[13px]" style={{ color: "var(--humo-claro)" }}>
          Ningún perfume coincide.
        </p>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div style={{ minWidth: 52 + 200 + 140 + tipos.length * 408 }}>
            <Encabezado tipos={tipos} columnas={columnas} />
            <ul className="grid gap-1.5">
              {visibles.map((p) => (
                <FilaDecants
                  key={p.id}
                  perfume={p}
                  tipos={tipos}
                  columnas={columnas}
                  onAsignar={onAsignar}
                  onQuitar={quitarUno}
                  onCambiar={onCambiar}
                  onFijarObjetivo={onFijarObjetivo}
                  onSoltarMargen={onSoltarMargen}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------- Tipos ---------- */

const rotulo = (t) => (
  <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
    {t}
  </span>
);

const selectorEstilo = { background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" };

function CajaDeTipos({ tipos, decants, formas, usosDeTipo, onCambiarTipo, onAgregar, onQuitar, onRedondeo }) {
  return (
    <div className="mb-6 rounded-[4px] border p-4" style={{ background: "var(--zona-decant)", borderColor: "var(--linea)" }}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 className="k-rotulo mb-1">Tipos de decant</h3>
          <p className="text-[12px]" style={{ color: "var(--humo)" }}>
            Cada tipo trae el precio de todos sus decants. En una fila podés pisarlo; la X vuelve al del tipo.
            Los números van con doble clic: cada uno reprecia todos los decants de ese tipo.
          </p>
        </div>
        <div className="flex items-end gap-4">
          <div>
            {rotulo("Venta directa")}
            <SelectorRedondeo valor={decants.redondeoDirecto ?? 1} onCambiar={(v) => onRedondeo("redondeoDirecto", v)} />
          </div>
          <div>
            {rotulo("Tiendanube")}
            <SelectorRedondeo valor={decants.redondeoTN ?? 1} onCambiar={(v) => onRedondeo("redondeoTN", v)} />
          </div>
          <button
            onClick={onAgregar}
            className="flex items-center gap-1.5 rounded-[3px] px-3 py-2 text-[12.5px] font-medium text-white"
            style={{ background: "var(--tinta)" }}
          >
            <Plus size={14} /> Agregar tipo
          </button>
        </div>
      </div>

      {tipos.length > 0 && (
        <div className="overflow-x-auto">
          <div className="grid min-w-[900px] gap-1.5">
            <div className="grid items-end gap-2 px-1" style={{ gridTemplateColumns: COLUMNAS_TIPO }}>
              {["ml", "Frasco", "Caja", "Venta directa", "Tiendanube", "Asignado", ""].map((t, i) => (
                <span key={i} className="k-col" style={{ color: "var(--humo)" }}>
                  {t}
                </span>
              ))}
            </div>
            {tipos.map((t) => (
              <FilaTipo key={t.id} tipo={t} formas={formas} usos={usosDeTipo(t.id)} onCambiar={(c) => onCambiarTipo(t.id, c)} onQuitar={() => onQuitar(t)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const COLUMNAS_TIPO = "72px 96px 96px 220px minmax(320px,1fr) 88px 32px";

/* El objetivo de un grupo en el tipo: modo + valor (+ forma en Tiendanube).
   Cambiar de modo borra las claves del otro: se excluyen igual que en un
   perfume (`fijarObjetivoTN` / `fijarObjetivoDirecto`). */
function modoDirecto(t) {
  if (t.gananciaObjetivo != null) return "ganancia";
  if (t.margenObjetivo != null) return "margen";
  return "";
}
function modoTN(t) {
  if (t.igualarDirectoTN) return "igualar";
  if (t.gananciaTN != null) return "ganancia";
  if (t.margenTN != null) return "margen";
  return "";
}

const borrar = (claves) => Object.fromEntries(claves.map((k) => [k, undefined]));

function FilaTipo({ tipo, formas, usos, onCambiar, onQuitar }) {
  const md = modoDirecto(tipo);
  const mt = modoTN(tipo);
  const cambiarModoDirecto = (modo) =>
    onCambiar({ ...borrar(CLAVES_DIRECTO), ...(modo === "margen" ? { margenObjetivo: 1 } : modo === "ganancia" ? { gananciaObjetivo: 5000 } : {}) });
  const cambiarModoTN = (modo) =>
    onCambiar({
      ...borrar(CLAVES_TN),
      ...(modo === "margen"
        ? { margenTN: 1 }
        : modo === "ganancia"
          ? { gananciaTN: 5000 }
          : modo === "igualar"
            ? { igualarDirectoTN: true, formaTN: formas[0]?.id }
            : {}),
      ...(modo && modo !== "igualar" && tipo.formaTN != null ? { formaTN: tipo.formaTN } : {}),
    });

  return (
    <div
      className="grid items-center gap-2 rounded-[4px] border px-1 py-1.5"
      style={{ gridTemplateColumns: COLUMNAS_TIPO, borderColor: "var(--linea)", background: "var(--papel)" }}
    >
      <CampoProtegido valor={tipo.ml} onCambiar={(v) => onCambiar({ ml: v })} mostrar={(v) => `${formatoMl(v || 0)} ml`} etiqueta="los ml del decant" suffix="ml" />
      <CampoProtegido valor={tipo.costoFrasco} onCambiar={(v) => onCambiar({ costoFrasco: v })} mostrar={(v) => pesos(v || 0)} etiqueta="el costo del frasco" />
      <CampoProtegido valor={tipo.costoCaja} onCambiar={(v) => onCambiar({ costoCaja: v })} mostrar={(v) => pesos(v || 0)} etiqueta="el costo de la caja" />

      <div className="flex items-center gap-1.5">
        <select value={md} onChange={(e) => cambiarModoDirecto(e.target.value)} className="rounded-[3px] border px-1.5 py-[5px] text-[12px]" style={selectorEstilo}>
          <option value="">a mano</option>
          <option value="margen">margen</option>
          <option value="ganancia">ganancia</option>
        </select>
        {md === "margen" && (
          <div className="w-[96px]">
            <CampoProtegido valor={+(tipo.margenObjetivo * 100).toFixed(1)} onCambiar={(v) => onCambiar({ margenObjetivo: v / 100 })} mostrar={(v) => pctSinMiles((v || 0) / 100, 1)} etiqueta="el margen del tipo" suffix="%" />
          </div>
        )}
        {md === "ganancia" && (
          <div className="w-[110px]">
            <CampoProtegido valor={tipo.gananciaObjetivo} onCambiar={(v) => onCambiar({ gananciaObjetivo: v })} mostrar={(v) => pesos(v || 0)} etiqueta="la ganancia del tipo" />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <select value={mt} onChange={(e) => cambiarModoTN(e.target.value)} className="rounded-[3px] border px-1.5 py-[5px] text-[12px]" style={selectorEstilo}>
          <option value="">a mano</option>
          <option value="margen">margen</option>
          <option value="ganancia">ganancia</option>
          <option value="igualar" disabled={!formas.length}>igualar a directo</option>
        </select>
        {mt === "margen" && (
          <div className="w-[96px]">
            <CampoProtegido valor={+(tipo.margenTN * 100).toFixed(1)} onCambiar={(v) => onCambiar({ margenTN: v / 100 })} mostrar={(v) => pctSinMiles((v || 0) / 100, 1)} etiqueta="el margen en Tiendanube" suffix="%" />
          </div>
        )}
        {mt === "ganancia" && (
          <div className="w-[110px]">
            <CampoProtegido valor={tipo.gananciaTN} onCambiar={(v) => onCambiar({ gananciaTN: v })} mostrar={(v) => pesos(v || 0)} etiqueta="la ganancia en Tiendanube" />
          </div>
        )}
        {mt && (
          <select
            value={tipo.formaTN ?? ""}
            onChange={(e) => onCambiar({ formaTN: e.target.value || undefined })}
            className="max-w-[170px] rounded-[3px] border px-1.5 py-[5px] text-[12px]"
            style={selectorEstilo}
            title={mt === "igualar" ? "La forma de pago que tiene que pagar lo mismo que la venta directa" : "Contra qué forma de pago se mide"}
          >
            {mt !== "igualar" && <option value="">la que menos deja</option>}
            {formas.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre}
              </option>
            ))}
          </select>
        )}
      </div>

      <span className="k-num text-right text-[12px]" style={{ color: "var(--humo)" }} title={usos.publicados ? `${usos.publicados} con la variante publicada en Tiendanube` : undefined}>
        {usos.con.length === 0 ? "en ninguno" : `en ${usos.con.length}`}
      </span>
      <button onClick={onQuitar} title="Quitar este tipo" className="rounded-[3px] p-1.5" style={{ color: "var(--humo)" }}>
        <Trash2 size={14} />
      </button>
    </div>
  );
}

/* ---------- Tabla ---------- */

function Encabezado({ tipos, columnas }) {
  const col = (texto, fondo, alineado = "text-right") => (
    <span className={`k-col px-2 py-1.5 ${alineado}`} style={{ background: fondo, color: "var(--humo)" }}>
      {texto}
    </span>
  );
  return (
    <div className="sticky top-0 z-[5] pb-1.5 pt-1" style={{ background: "var(--vidrio)" }}>
      <div className="grid items-center border border-transparent" style={{ gridTemplateColumns: columnas }}>
        <span className="col-span-4 k-col px-2 py-1.5" style={{ color: "var(--humo)" }}>
          Perfume
        </span>
        {tipos.map((t) => (
          <span key={t.id} className="col-span-5 k-col px-2 py-1.5" style={{ background: "var(--zona-decant-honda)", color: "var(--tinta)" }}>
            Decant {nombreDeTipo(t)} · venta directa
          </span>
        ))}
      </div>
      <div className="grid items-center border border-transparent" style={{ gridTemplateColumns: columnas }}>
        <span />
        {col("Perfume", "transparent", "text-left")}
        {col("ml", "transparent")}
        {col("$ por ml", "transparent")}
        {tipos.map((t) => (
          <FragmentoEncabezado key={t.id} col={col} />
        ))}
      </div>
    </div>
  );
}

function FragmentoEncabezado({ col }) {
  return (
    <>
      {col("", "var(--zona-decant)", "text-center")}
      {col("Costo", "var(--zona-decant)")}
      {col("Precio", "var(--zona-decant)")}
      {col("Margen", "var(--zona-decant)")}
      {col("Ganancia", "var(--zona-decant)")}
    </>
  );
}

function FilaDecants({ perfume, tipos, columnas, onAsignar, onQuitar, onCambiar, onFijarObjetivo, onSoltarMargen }) {
  const porMl = costoPorMl(perfume);
  const ml = Number(perfume.ml) > 0 ? Number(perfume.ml) : null;
  return (
    <li className="group grid items-center overflow-hidden rounded-[4px] border py-1.5" style={{ gridTemplateColumns: columnas, borderColor: "var(--linea)", background: "var(--papel)" }}>
      <div className="px-1.5">
        <ConVistaPrevia archivo={perfume.foto} nombre={perfume.nombre}>
          <div
            className="h-[46px] w-[46px] overflow-hidden rounded-[3px] border"
            style={{ borderColor: "var(--linea)", borderStyle: perfume.foto ? "solid" : "dashed", background: perfume.foto ? "var(--papel)" : "#F4F6F2" }}
          >
            {perfume.foto && <img src={urlFoto(perfume.foto)} alt={`Foto de ${perfume.nombre}`} className="h-full w-full object-cover" />}
          </div>
        </ConVistaPrevia>
      </div>
      <span className="truncate px-2 text-[13px]" style={{ color: "var(--tinta)" }} title={perfume.nombre}>
        {perfume.nombre}
      </span>
      <span className="k-num px-2 text-right text-[12.5px]" style={{ color: ml ? "var(--tinta)" : "var(--humo-claro)" }} title={ml ? undefined : "Cargá los ml del frasco en el catálogo"}>
        {ml ? formatoMl(ml) : "—"}
      </span>
      <span
        className="k-num px-2 text-right text-[12.5px]"
        style={{ color: porMl ? "var(--humo)" : "var(--humo-claro)" }}
        title={porMl ? `${pesos(perfume.costo)} ÷ ${formatoMl(ml)} ml` : !(Number(perfume.costo) > 0) ? "El perfume no tiene costo" : "Faltan los ml del frasco"}
      >
        {porMl ? pesos(Math.round(porMl)) : "—"}
      </span>
      {tipos.map((t) => {
        const entrada = (perfume.decants ?? []).find((e) => e.tipo === t.id);
        return entrada ? (
          <CeldasDecant
            key={t.id}
            vendible={vendibleDeDecant(perfume, entrada, t)}
            onQuitar={() => onQuitar(perfume, t)}
            onCambiar={onCambiar}
            onFijarObjetivo={onFijarObjetivo}
            onSoltarMargen={onSoltarMargen}
          />
        ) : (
          <CeldasSinDecant key={t.id} tipo={t} onOfrecer={() => onAsignar([perfume.id], t.id, true)} />
        );
      })}
    </li>
  );
}

function CeldasSinDecant({ tipo, onOfrecer }) {
  return (
    <>
      <div className="flex justify-center px-1" style={{ background: "var(--zona-decant)" }}>
        <input type="checkbox" checked={false} onChange={onOfrecer} title={`Ofrecer el decant de ${nombreDeTipo(tipo)}`} aria-label={`Ofrecer el decant de ${nombreDeTipo(tipo)}`} />
      </div>
      <span className="col-span-4 self-stretch" style={{ background: "var(--zona-decant)" }} />
    </>
  );
}

/* Las cuatro cifras de un decant ofrecido: costo, y el par precio/margen de la
   venta directa con su ganancia. Mismo trato que el catálogo: escribir en
   margen o ganancia los fija (acá, como objetivo PROPIO que pisa al del tipo);
   la X de uno propio vuelve al del tipo, y la de uno heredado deja el precio a
   mano. */
function CeldasDecant({ vendible: v, onQuitar, onCambiar, onFijarObjetivo, onSoltarMargen }) {
  const objetivo = objetivoDirecto(v);
  const clavado = objetivo != null;
  const propio = !v.hereda.directo;
  const sinCosto = v.costo == null;
  const precio = Number(v.precioPublico) || 0;
  const ganancia = !sinCosto && precio > 0 ? precio - v.costo : null;
  const margen = ganancia != null ? ganancia / v.costo : null;
  const fondo = { background: "var(--zona-decant)" };
  const marcaPropia = { borderLeft: "3px solid var(--ambar)", background: "#FFFDF7" };
  const soltar = () => onSoltarMargen(v.id, precio);
  const tituloX = propio ? "Volver al precio del tipo" : "Dejar este precio a mano (deja de seguir al tipo)";

  const celdaObjetivo = ({ fijado, valor, onChange, suffix, que, color }) => (
    <div className="relative px-1.5" style={fondo}>
      {sinCosto ? (
        <div className="px-0.5 text-right">
          <span className="k-num text-[13px]" style={{ color: "var(--humo-claro)" }}>—</span>
        </div>
      ) : (
        <NumberCell
          value={valor}
          onChange={onChange}
          suffix={suffix}
          className={fijado ? "font-semibold" : ""}
          style={{ ...(color ? { color } : null), ...(fijado && propio ? marcaPropia : null) }}
        />
      )}
      {fijado && (
        <button
          type="button"
          onClick={soltar}
          title={tituloX}
          aria-label={`${tituloX}: ${que} de ${v.nombre}`}
          className="absolute -right-0.5 -top-1.5 rounded-full bg-white p-0.5"
          style={{ color: "var(--humo)", boxShadow: "0 0 0 1px var(--linea)" }}
        >
          <X size={10} />
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className="flex justify-center px-1" style={fondo}>
        <input type="checkbox" checked onChange={onQuitar} title="Dejar de ofrecer este decant" aria-label={`Dejar de ofrecer ${v.nombre}`} />
      </div>
      <div className="px-2 text-right" style={fondo} title={sinCosto ? "Sin costo: falta el costo del perfume o sus ml" : `${pesos(Math.round(costoPorMl(v.decantDe) * v.tipo.ml))} de perfume + ${pesos(Number(v.tipo.costoFrasco) || 0)} de frasco + ${pesos(Number(v.tipo.costoCaja) || 0)} de caja`}>
        <span className="k-num text-[13px]" style={{ color: sinCosto ? "var(--humo-claro)" : "var(--tinta)" }}>
          {sinCosto ? "—" : pesos(v.costo)}
        </span>
      </div>
      <div className="px-1.5" style={fondo} title={clavado ? (propio ? "Precio propio de este decant" : `Del tipo ${nombreDeTipo(v.tipo)}`) : "Precio a mano"}>
        {clavado ? (
          <div className="px-0.5 text-right">
            <span className="k-num text-[13px] font-semibold" style={{ color: "var(--tinta)" }}>
              {precio > 0 ? pesos(precio) : "—"}
            </span>
            {!propio && (
              <small className="block text-[10px] leading-tight" style={{ color: "var(--humo)" }}>
                del tipo
              </small>
            )}
          </div>
        ) : (
          <NumberCell value={precio || 0} onChange={(x) => onCambiar(v.id, { precioPublico: x })} />
        )}
      </div>
      {celdaObjetivo({
        fijado: objetivo?.margen != null,
        valor: +(((objetivo?.margen ?? margen) || 0) * 100).toFixed(1),
        onChange: (x) => onFijarObjetivo([v.id], { margen: x / 100 }),
        suffix: "%",
        que: "el margen",
      })}
      {celdaObjetivo({
        fijado: objetivo?.ganancia != null,
        valor: Math.round(objetivo?.ganancia ?? ganancia ?? 0),
        onChange: (x) => onFijarObjetivo([v.id], { ganancia: x }),
        que: "la ganancia",
        color: colorGanancia(ganancia),
      })}
    </>
  );
}

