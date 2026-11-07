import { useState } from "react";
import { NumberCell } from "./NumberCell";
import {
  analisisTiendaNube,
  gananciaDeBanda,
  objetivoTN,
  precioPublicoDesdeGanancia,
  precioTiendaNubeDesdeObjetivo,
} from "./precios";

// Local y no importado de `Catalogo.jsx`: el catálogo importa este archivo.
const pesos = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0
  );

/* Verde si el precio sube y óxido si baja: plata que entra o sale, el mismo
   criterio que el total de la vista previa. Ámbar no — acá es una comparación,
   no la ganancia. */
/* Encabezado y filas de la vista previa comparten esta grilla: si se tocan por
   separado, las columnas dejan de alinear. `w-max` la pega a la izquierda —con
   el nombre en `flex-1` los números se iban al borde derecho y costaba seguir
   el renglón. */
const COLUMNAS_VISTA = "minmax(0,220px) 74px 74px 16px 78px 74px 74px 44px 54px";
/* Con Tiendanube enganchado se suma una columna más: lo que deja ese canal. */
const COLUMNAS_VISTA_TN = "minmax(0,220px) 74px 74px 16px 78px 74px 74px 44px 54px 86px";

const colorDif = (dif) =>
  dif == null || dif === 0 ? "var(--humo-claro)" : dif > 0 ? "var(--verde)" : "var(--oxido)";

/* Fijar el mismo objetivo en todos los perfumes que se ven (los que tienen
   costo): un margen, una ganancia fija en pesos o —solo en Tiendanube— igualar
   lo que paga una forma de pago al precio de venta directa. Pisa también los de
   precio a mano —decisión de Franco— y por eso confirma diciendo cuántos son.

   Lo usan el catálogo (venta directa) y Tiendanube. Solo Tiendanube pasa
   `formas`, y ahí aparecen "Medido contra" e "Igualar a venta directa"; solo el
   catálogo pasa `conBanda`, y ahí aparece "Banda".
   `onFijar` recibe los ids y `{margen | ganancia | banda | igualarDirecto, formaId}`.
   `esAMano(p)` dice qué perfume tiene hoy el precio puesto a mano, `zona` es el
   color del canal y `avisoFinal` cierra el texto de la confirmación. */
export default function AplicarATodos({
  perfumes,
  filtrado,
  formas,
  conBanda,
  banda: bandaGuardada,
  redondeo = 1,
  ajustesTN,
  onFijar,
  onConfirmar,
  esAMano,
  zona,
  avisoFinal = "",
}) {
  const [tipo, setTipo] = useState("margen");
  const [valor, setValor] = useState(0);
  const [formaId, setFormaId] = useState("");
  // Los tres números de la banda arrancan en la última que se aplicó.
  const [piso, setPiso] = useState(() => Number(bandaGuardada?.piso) || 0);
  const [margenBanda, setMargenBanda] = useState(() => (Number(bandaGuardada?.margen) || 0) * 100);
  const [techo, setTecho] = useState(() => Number(bandaGuardada?.techo) || 0);
  const [verTodos, setVerTodos] = useState(false);
  if (!onFijar) return null;

  const igualar = tipo === "igualar";
  const esBanda = tipo === "banda";
  const banda = { piso, margen: margenBanda / 100, techo };
  const conCosto = perfumes.filter((p) => Number(p.costo) > 0);
  /* Igualar necesita el precio de venta directa: sin él no hay nada que igualar,
     así que esos quedan afuera en vez de guardarles un objetivo que no se puede
     resolver. */
  const alcanzados = igualar ? conCosto.filter((p) => Number(p.precioPublico) > 0) : conCosto;
  const sinDirecto = conCosto.length - alcanzados.length;
  const aMano = alcanzados.filter(esAMano).length;
  const sinCosto = perfumes.length - conCosto.length;
  const forma = formas?.find((f) => f.id === formaId);
  const listo = alcanzados.length > 0 && (igualar ? !!forma : esBanda ? margenBanda > 0 : valor > 0);

  /* Con la banda cada perfume recibe su propio número, así que lo que hay que
     mostrar antes de aceptar es cuántos caen en cada parte: si casi todos
     quedan en el piso, la banda está mal elegida y es una ganancia fija
     disfrazada. */
  const reparto = esBanda
    ? alcanzados.reduce(
        (acc, p) => {
          const crudo = (Number(p.costo) || 0) * banda.margen;
          if (piso > 0 && crudo < piso) acc.piso++;
          else if (techo > 0 && crudo > techo) acc.techo++;
          else acc.margen++;
          return acc;
        },
        { piso: 0, margen: 0, techo: 0 }
      )
    : null;

  /* Elegir tres números en abstracto no se puede: el panel muestra en vivo qué
     les haría a los perfumes de verdad. `vistaPrevia` es el mismo ensayo que se
     corría a mano, acá adentro y recalculándose con cada tecla. */
  /* -> {tn, tnForma} con lo que deja Tiendanube a ese precio directo, o nada
     si el canal no está configurado o el perfume no tiene objetivo de TN. */
  const gananciaTN = (p, precioDirecto) => {
    if (!ajustesTN?.formas?.length) return {};
    const objetivo = objetivoTN(p);
    if (!objetivo || !(precioDirecto > 0)) return {};
    const r = precioTiendaNubeDesdeObjetivo({ costo: p.costo, precioDirecto, ...objetivo, ajustesTN });
    if (!r || r.noAplica || !(r.precio > 0)) return {};
    const a = analisisTiendaNube({ costo: p.costo, precio: r.precio, ajustesTN, formaId: objetivo.formaId });
    if (a.manda < 0) return {};
    return { tn: a.gananciaManda, tnForma: a.formas[a.manda].forma.nombre, tnPrecio: r.precio };
  };

  const vistaPrevia =
    esBanda && margenBanda > 0 && alcanzados.length
      ? (() => {
          const filas = alcanzados
            .map((p) => {
              const g = gananciaDeBanda(p.costo, banda);
              const crudo = (Number(p.costo) || 0) * banda.margen;
              return {
                id: p.id,
                nombre: p.nombre,
                costo: Number(p.costo) || 0,
                hoy: Number(p.precioPublico) || 0,
                precio: precioPublicoDesdeGanancia(p.costo, g, redondeo) ?? 0,
                ganancia: g ?? 0,
                margen: g == null ? 0 : (g / p.costo) * 100,
                manda: piso > 0 && crudo < piso ? "piso" : techo > 0 && crudo > techo ? "techo" : "margen",
                // Null cuando no hay precio hoy: no hay con qué comparar y
                // pintarlo de verde sería inventar una mejora.
                dif: (Number(p.precioPublico) || 0) > 0 ? (precioPublicoDesdeGanancia(p.costo, g, redondeo) ?? 0) - Number(p.precioPublico) : null,
                /* Lo que dejaría Tiendanube con el precio nuevo. Los perfumes
                   que igualan a la venta directa cuelgan de este precio, así
                   que la banda les mueve también ese canal: sin esta columna el
                   movimiento queda invisible. Se mide contra la forma que el
                   perfume tiene fijada —la misma que muestra la pestaña—, y se
                   recalcula igual que en `resolverPreciosDelCatalogo`. */
                ...gananciaTN(p, precioPublicoDesdeGanancia(p.costo, g, redondeo) ?? 0),
              };
            })
            .sort((a, b) => a.costo - b.costo);
          const totalNuevo = filas.reduce((a, f) => a + (f.precio - f.costo), 0);
          const totalHoy = filas.reduce((a, f) => a + (f.hoy > 0 ? f.hoy - f.costo : 0), 0);
          const ms = filas.map((f) => f.margen);
          // El rótulo nombra la forma cuando todas miden contra la misma, que
          // es el caso real: "en TN" solo no dice contra qué se mide.
          const formasTN = [...new Set(filas.map((f) => f.tnForma).filter(Boolean))];
          // Los tres que mejor cuentan la historia: el más barato, el del medio
          // y el más caro. En esos tres se ve si la banda hace lo que se quiere.
          const anclas = [filas[0], filas[Math.floor(filas.length / 2)], filas[filas.length - 1]].filter(
            (f, i, a) => f && a.indexOf(f) === i
          );
          return {
            filas,
            anclas,
            totalNuevo,
            totalHoy,
            dif: totalNuevo - totalHoy,
            suben: filas.filter((f) => f.hoy > 0 && f.precio > f.hoy).length,
            bajan: filas.filter((f) => f.hoy > 0 && f.precio < f.hoy).length,
            margenMin: Math.min(...ms),
            margenMax: Math.max(...ms),
            conTN: formasTN.length > 0,
            rotuloTN: formasTN.length === 1 ? formasTN[0] : "en Tiendanube",
          };
        })()
      : null;

  const texto = igualar
    ? `el precio que hace que "${forma?.nombre ?? ""}" le cobre al cliente lo mismo que la venta directa`
    : esBanda
      ? `${String(margenBanda).replace(".", ",")}% de margen, nunca menos de ${pesos(piso)} ni más de ${pesos(techo)} de ganancia`
      : tipo === "margen"
        ? `${String(valor).replace(".", ",")}% de margen`
        : `${pesos(valor)} de ganancia fija`;

  const aplicar = () =>
    onConfirmar({
      titulo: `Aplicar a ${alcanzados.length} perfumes`,
      texto:
        `Todos quedan con ${texto}` +
        (formas && !igualar ? `, medido contra ${forma ? `"${forma.nombre}"` : "la forma de pago que menos deja"}` : "") +
        ". " +
        (igualar ? "La comisión y el envío gratis salen de tu ganancia, así que en Tiendanube vas a ganar menos que vendiendo directo. " : "") +
        (reparto
          ? `Quedan ${reparto.piso} en el piso, ${reparto.margen} por margen y ${reparto.techo} en el techo. `
          : "") +
        (aMano === 1
          ? "1 tenía el precio puesto a mano y pasa a calcularse. "
          : aMano
            ? `${aMano} tenían el precio puesto a mano y pasan a calcularse. `
            : "") +
        (sinDirecto ? `${sinDirecto} sin precio de venta directa no se tocan. ` : "") +
        (sinCosto ? `${sinCosto} sin costo no se tocan. ` : "") +
        (filtrado ? "Solo los que coinciden con la búsqueda. " : "") +
        avisoFinal,
      etiquetaOk: "Aplicar",
      onAceptar: () =>
        onFijar(
          alcanzados.map((p) => p.id),
          igualar
            ? { igualarDirecto: true, formaId }
            : esBanda
              ? { banda }
              : tipo === "margen"
                ? { margen: valor / 100, formaId: formaId || null }
                : { ganancia: valor, formaId: formaId || null }
        ),
    });

  const boton = (t, etiqueta) => (
    <button
      type="button"
      onClick={() => setTipo(t)}
      className="k-col px-2.5 py-[6px] transition"
      style={tipo === t ? { background: "var(--tinta)", color: "var(--papel)" } : { color: "var(--humo)" }}
    >
      {etiqueta}
    </button>
  );

  return (
    <div
      className="mb-5 flex flex-wrap items-end gap-3 rounded-[4px] border px-4 py-3"
      style={{ borderColor: "var(--linea)", background: zona }}
    >
      <div>
        <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
          Aplicar a todos
        </span>
        <div className="flex overflow-hidden rounded-[3px] border" style={{ borderColor: "var(--linea)", background: "var(--papel)" }}>
          {boton("margen", "Margen")}
          {boton("ganancia", "Ganancia fija")}
          {conBanda && boton("banda", "Banda")}
          {formas && boton("igualar", "Igualar a venta directa")}
        </div>
      </div>
      {/* La banda lleva tres números en vez de uno. */}
      {esBanda && (
        <>
          <label className="block w-[110px]">
            <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
              Piso
            </span>
            <NumberCell value={piso} onChange={(v) => setPiso(Math.max(0, v))} suffix="$" />
          </label>
          <label className="block w-[90px]">
            <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
              Margen
            </span>
            <NumberCell value={margenBanda} onChange={(v) => setMargenBanda(Math.max(0, v))} suffix="%" />
          </label>
          <label className="block w-[110px]">
            <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
              Techo
            </span>
            <NumberCell value={techo} onChange={(v) => setTecho(Math.max(0, v))} suffix="$" />
          </label>
          {/* Dónde se cruza cada límite, para elegir los números sin tantear. */}
          {margenBanda > 0 && (
            <span className="self-center text-[11.5px]" style={{ color: "var(--humo)" }}>
              {piso > 0 && `hasta ${pesos(piso / banda.margen)} de costo manda el piso`}
              {piso > 0 && techo > 0 && " · "}
              {techo > 0 && `desde ${pesos(techo / banda.margen)} manda el techo`}
            </span>
          )}
        </>
      )}
      {/* Igualar no tiene número que escribir: el objetivo es el precio directo. */}
      {!igualar && !esBanda && (
        <label className="block w-[120px]">
          <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
            {tipo === "margen" ? "Margen" : "Ganancia por venta"}
          </span>
          <NumberCell value={valor} onChange={(v) => setValor(Math.max(0, v))} suffix={tipo === "margen" ? "%" : "$"} />
        </label>
      )}
      {formas && (
        <label className="block">
          <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
            {igualar ? "Que pague como directo" : "Medido contra"}
          </span>
          <select
            value={formaId}
            onChange={(e) => setFormaId(e.target.value)}
            className="rounded-[3px] border px-2 py-[6px] text-[12.5px]"
            style={{ borderColor: "var(--linea)", background: "var(--papel)", color: "var(--tinta)" }}
          >
            {/* Igualar "la que menos deja" no significa nada: hay que elegir una. */}
            <option value="">{igualar ? "Elegí la forma de pago" : "La forma de pago que menos deja"}</option>
            {formas.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        onClick={aplicar}
        disabled={!listo}
        className="rounded-[3px] px-3.5 py-[7px] text-[12.5px] font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40"
        style={{ background: "var(--tinta)" }}
      >
        Aplicar a {alcanzados.length} perfumes{filtrado ? " (los de la búsqueda)" : ""}
      </button>
      {/* La vista previa: qué le haría esta banda a los perfumes de verdad, en
          vivo. Es lo único que vuelve elegibles tres números abstractos. */}
      {vistaPrevia && (
        <div
          className="basis-full rounded-[3px] border px-3 py-2.5"
          style={{ borderColor: "var(--linea)", background: "var(--papel)" }}
        >
          <div className="mb-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11.5px]" style={{ color: "var(--humo)" }}>
            <span>
              <strong style={{ color: "var(--tinta)" }}>{reparto.piso}</strong> en el piso ·{" "}
              <strong style={{ color: "var(--tinta)" }}>{reparto.margen}</strong> por margen ·{" "}
              <strong style={{ color: "var(--tinta)" }}>{reparto.techo}</strong> en el techo
            </span>
            <span>
              margen de <span className="k-num">{vistaPrevia.margenMin.toFixed(0)}%</span> a{" "}
              <span className="k-num">{vistaPrevia.margenMax.toFixed(0)}%</span>
            </span>
            <span>
              {vistaPrevia.bajan} bajan · {vistaPrevia.suben} suben
            </span>
            {/* Lo que más pesa para decidir: si en total ganás más o menos que
                hoy. Verde/óxido como en el diálogo de costos; el ámbar no se usa
                para comparar. */}
            <span>
              ganás{" "}
              <strong
                className="k-num"
                style={{ color: vistaPrevia.dif > 0 ? "var(--verde)" : vistaPrevia.dif < 0 ? "var(--oxido)" : "var(--tinta)" }}
              >
                {vistaPrevia.dif >= 0 ? "+" : "−"}
                {pesos(Math.abs(vistaPrevia.dif))}
              </strong>{" "}
              que hoy, vendiendo uno de cada uno
            </span>
          </div>
          <div className="w-max max-w-full">
            <div
              className="k-col grid gap-x-2 border-b pb-1"
              style={{
                gridTemplateColumns: vistaPrevia.conTN ? COLUMNAS_VISTA_TN : COLUMNAS_VISTA,
                borderColor: "var(--linea)",
                color: "var(--humo-claro)",
              }}
            >
              <span>perfume</span>
              <span className="text-right">costo</span>
              <span className="text-right">hoy</span>
              <span />
              <span className="text-right">queda</span>
              <span className="text-right">dif</span>
              <span className="text-right">ganancia</span>
              <span className="text-right">margen</span>
              <span>manda</span>
              {vistaPrevia.conTN && (
                <span className="truncate text-right" title={`Lo que te deja Tiendanube con "${vistaPrevia.rotuloTN}"`}>
                  {vistaPrevia.rotuloTN}
                </span>
              )}
            </div>
            <ul className="grid gap-0.5 pt-1">
              {(verTodos ? vistaPrevia.filas : vistaPrevia.anclas).map((f) => (
                <li
                  key={f.id}
                  className="grid items-baseline gap-x-2 text-[11.5px]"
                  style={{ gridTemplateColumns: vistaPrevia.conTN ? COLUMNAS_VISTA_TN : COLUMNAS_VISTA }}
                >
                  <span className="truncate" title={f.nombre} style={{ color: "var(--tinta)" }}>
                    {f.nombre}
                  </span>
                  <span className="k-num text-right" style={{ color: "var(--humo)" }}>
                    {pesos(f.costo)}
                  </span>
                  <span className="k-num text-right" style={{ color: "var(--humo)" }}>
                    {f.hoy > 0 ? pesos(f.hoy) : "—"}
                  </span>
                  <span className="text-center" style={{ color: colorDif(f.dif) }}>
                    {f.dif == null ? "→" : f.dif > 0 ? "↑" : f.dif < 0 ? "↓" : "→"}
                  </span>
                  <span className="k-num text-right font-medium" style={{ color: "var(--tinta)" }}>
                    {pesos(f.precio)}
                  </span>
                  {/* Cuánto se mueve el precio y para dónde. Verde sube, óxido
                      baja: el mismo criterio que el total de arriba —es plata
                      que entra o sale—, y nunca ámbar, que acá sería una
                      comparación y no una ganancia. */}
                  <span className="k-num text-right" style={{ color: colorDif(f.dif) }}>
                    {f.dif == null ? "" : f.dif === 0 ? "igual" : (f.dif > 0 ? "+" : "−") + pesos(Math.abs(f.dif))}
                  </span>
                  {/* La ganancia que le toca. Ámbar: acá sí es plata que te
                      queda, el único uso del color. Va pegada al margen porque
                      son la misma cuenta mirada de dos maneras. */}
                  <span className="k-num text-right" style={{ color: "var(--ambar)" }}>
                    {pesos(f.ganancia)}
                  </span>
                  <span className="k-num text-right" style={{ color: "var(--humo)" }}>
                    {f.margen.toFixed(0)}%
                  </span>
                  <span className="k-col" style={{ color: "var(--humo-claro)" }}>
                    {f.manda}
                  </span>
                  {vistaPrevia.conTN && (
                    <span
                      className="k-num text-right"
                      style={{ color: f.tn == null ? "var(--humo-claro)" : "var(--ambar)" }}
                      title={
                        f.tn == null
                          ? "Este perfume no tiene precio calculado en Tiendanube"
                          : `Publicando a ${pesos(f.tnPrecio)} en Tiendanube, "${f.tnForma}" te deja ${pesos(f.tn)}`
                      }
                    >
                      {f.tn == null ? "—" : pesos(f.tn)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {vistaPrevia.filas.length > vistaPrevia.anclas.length && (
            <button
              type="button"
              onClick={() => setVerTodos((v) => !v)}
              className="k-col mt-1.5"
              style={{ color: "var(--humo)" }}
            >
              {verTodos ? "Ver solo tres" : `Ver los ${vistaPrevia.filas.length}`}
            </button>
          )}
        </div>
      )}
      <span className="basis-full text-[11.5px]" style={{ color: "var(--humo)" }}>
        {igualar
          ? "El precio de Tiendanube sale del de venta directa: si ese se mueve, este se mueve solo. Así el que mira la tienda y paga con esa forma no ve un precio más alto que comprándote directo."
          : esBanda
            ? "A cada uno le toca el margen sobre SU costo, pero nunca menos que el piso ni más que el techo. Le deja a cada perfume una ganancia fija en pesos: no se recalcula sola si después cambia el costo."
            : "La ganancia fija queda en pesos: si cambia el costo, se mueve el precio y la ganancia sigue igual."}{" "}
        Pisa también los precios puestos a mano.
      </span>
    </div>
  );
}
