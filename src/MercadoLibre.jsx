import { Fragment, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { urlFoto } from "./almacenamiento";
import { analisisDePrecio, margenesDePlanes, planesPublicables, preciosDePlanes } from "./precios";
import { SelectorRedondeo } from "./TiendaNube";
import { NumberCell } from "./NumberCell";
import { pctSinMiles as pctCorto } from "./numeros";
import { buscarPerfumes, ConVistaPrevia, margenReal, pesos } from "./Catalogo";

/* ============================================================
   Mercado Libre.

   Salió del catálogo porque ahí ya no entraba: una publicación por plan de pago
   son tres columnas por plan. Los datos NO se mudaron: `preciosML`,
   `margenesML` y `ajustes.cuotasML` siguen en `perfumes.json`, y esta pantalla
   recibe la misma lista resuelta que el catálogo. Nombre, foto y costo se
   editan en el catálogo; acá se ven como referencia.
   ============================================================ */

const PLANES_DE_CUOTAS = [3, 6, 9, 12];

export const nombreDePlan = (plan) => (plan === 1 ? "1 pago" : `${plan} cuotas`);

/* Misma regla que el catálogo: una sola fuente para encabezado y filas, en línea
   porque la cantidad depende de los planes, y sin `gap` para que la franja de
   color del canal sea continua.

   Columnas: foto · nombre · costo · ganancia directa ‖
             (precio · margen · ganancia) por cada plan */
const columnasDeML = (planes) =>
  [
    "52px minmax(200px,1fr) 100px 100px",
    planes.map(() => "112px 88px 100px").join(" "),
  ].join(" ");

const anchoMinimo = (planes) => 52 + 200 + 200 + planes.length * 300;

export default function MercadoLibre({ perfumes, ajustes, onAjustes, onCambiar, onSoltarMargenML }) {
  const [consulta, setConsulta] = useState("");
  /* Un pago siempre, más los planes con comisión cargada: cada uno es una
     publicación distinta en ML y tiene su propio precio. */
  const planes = useMemo(() => planesPublicables(ajustes.cuotasML), [ajustes.cuotasML]);
  const columnas = columnasDeML(planes);

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
      <div className="mb-6">
        <h2 className="k-rotulo mb-1">Mercado Libre</h2>
        <p className="text-[12.5px]" style={{ color: "var(--humo)" }}>
          Un precio por plan de pago: cada plan es una publicación aparte. El nombre, la foto y
          el costo se cargan en el catálogo.
        </p>
      </div>

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

      <AjustesML ajustes={ajustes} onAjustes={onAjustes} />

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
                />
              ))}
            </ul>
          </div>
        </div>
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
            style={{ background: "var(--zona-ml-honda)", color: "var(--tinta)", gridColumn: "span 3" }}
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
          </Fragment>
        ))}
      </div>
    </div>
  );
}

const colorGanancia = (g) =>
  g === null ? "var(--humo-claro)" : g >= 0 ? "var(--ambar)" : "var(--oxido)";

function FilaML({ perfume, ajustes, planes, columnas, onCambiar, onSoltarMargenML }) {
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

      <span className="truncate px-2 text-[13px]" style={{ color: "var(--tinta)" }} title={perfume.nombre}>
        {perfume.nombre}
      </span>

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
        </Fragment>
      ))}
    </li>
  );
}
