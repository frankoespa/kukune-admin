import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, ImagePlus, Search, X, FileDown } from "lucide-react";
import { urlFoto } from "./almacenamiento";
import {
  analisisDePrecio,
  margenesDePlanes,
  planesPublicables,
  preciosDePlanes,
} from "./precios";
import { NumberCell } from "./NumberCell";
import { pctSinMiles as pctCorto } from "./numeros";

/* Una sola fuente para las columnas del encabezado y de las filas. Si se
   escribieran por separado se desalinean al primer cambio de ancho, que es
   exactamente el error que ya se pagó en el diálogo de costos del pedido.

   Va como `gridTemplateColumns` en línea y no como clase de Tailwind porque la
   cantidad de columnas depende de cuántos planes de pago se publiquen: Tailwind
   genera sus clases leyendo el código, así que una clase armada en tiempo de
   ejecución (`grid-cols-[...]`) no existiría en el CSS.

   Columnas: foto · nombre · costo ‖ precio · con envío · ganancia · margen ‖
             (precio · ganancia) por cada plan ‖ usos · borrar
   Sin `gap` horizontal a propósito: el aire lo pone cada celda con su padding,
   así el color de cada canal es una franja continua. */
const columnasDeCatalogo = (planes) =>
  [
    "52px minmax(180px,1fr) 100px",
    // Precio y Margen pegados: son un par que se maneja junto, igual que en la
    // tabla del pedido. Con envío y Ganancia salen de ellos.
    "104px 88px 96px 100px",
    // Por plan: precio · margen · ganancia, el mismo trío que la venta directa.
    planes.map(() => "112px 88px 100px").join(" "),
    "72px 32px",
  ].join(" ");

const PLANES_DE_CUOTAS = [3, 6, 9, 12];

const nombreDePlan = (plan) => (plan === 1 ? "1 pago" : `${plan} cuotas`);

/* Lo que ve una fila de un perfume que no está en ningún pedido. Constante y no
   un literal nuevo por render: si no, cada fila recibe un objeto distinto. */
const SIN_USOS = { total: 0, enPantalla: 0, enOtros: 0, pedidos: [] };

/* ---------- Vista previa de la foto al pasar el mouse ----------
   Va en un portal al body y con `position: fixed` a propósito: la tabla del
   pedido scrollea por dentro (`overflow: auto`), así que un panel posicionado
   dentro de la celda quedaría recortado por el contenedor.
   El retardo evita que parpadeen mil previas al cruzar la tabla con el mouse. */
const LADO_PREVIA = 300;
const RETARDO = 180;

export function ConVistaPrevia({ archivo, nombre, children }) {
  const [caja, setCaja] = useState(null);
  const contenedor = useRef(null);
  const temporizador = useRef(null);

  const ocultar = () => {
    clearTimeout(temporizador.current);
    setCaja(null);
  };

  const mostrar = () => {
    if (!archivo) return;
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => {
      const r = contenedor.current?.getBoundingClientRect();
      if (r) setCaja(r);
    }, RETARDO);
  };

  // Al scrollear, la posición calculada queda vieja: se esconde y listo.
  useEffect(() => {
    if (!caja) return;
    const fuera = () => ocultar();
    window.addEventListener("scroll", fuera, true);
    return () => window.removeEventListener("scroll", fuera, true);
  }, [caja]);

  useEffect(() => () => clearTimeout(temporizador.current), []);

  let panel = null;
  if (caja && archivo) {
    const entraADerecha = caja.right + 12 + LADO_PREVIA <= window.innerWidth - 8;
    const izquierda = entraADerecha
      ? caja.right + 12
      : Math.max(8, caja.left - LADO_PREVIA - 12);
    const arriba = Math.min(
      Math.max(8, caja.top + caja.height / 2 - LADO_PREVIA / 2),
      window.innerHeight - LADO_PREVIA - 8
    );
    panel = createPortal(
      <div
        className="pointer-events-none fixed z-[70] overflow-hidden rounded-[4px] shadow-xl"
        style={{
          left: izquierda,
          top: arriba,
          width: LADO_PREVIA,
          height: LADO_PREVIA,
          background: "var(--papel)",
          border: "1px solid var(--linea)",
        }}
      >
        <img
          src={urlFoto(archivo)}
          alt={nombre ? `Foto de ${nombre}` : "Foto del perfume"}
          className="h-full w-full object-contain"
        />
      </div>,
      document.body
    );
  }

  return (
    <div ref={contenedor} onMouseEnter={mostrar} onMouseLeave={ocultar}>
      {children}
      {panel}
    </div>
  );
}

/* ============================================================
   El catálogo de perfumes.

   Es la única pantalla donde se carga una foto. Los pedidos apuntan acá por id,
   así que arreglar una foto o corregir un nombre se refleja en todos los
   pedidos a la vez.
   ============================================================ */

export const normalizarTexto = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/* Busca por palabras sueltas y sin acentos: "yara 100", "lattafa yara" y
   "YARA" encuentran lo mismo. Con nombres cargados a mano hace falta. */
export function buscarPerfumes(perfumes, consulta) {
  const palabras = normalizarTexto(consulta).split(/\s+/).filter(Boolean);
  if (!palabras.length) return perfumes;
  return perfumes.filter((p) => {
    const nombre = normalizarTexto(p.nombre);
    return palabras.every((w) => nombre.includes(w));
  });
}

export default function Catalogo({
  perfumes,
  usos,
  ajustes,
  onCambiar,
  onSoltarMargen,
  onSoltarMargenML,
  onCrear,
  onBorrar,
  onFoto,
  onAjustes,
  onExportarPrecios,
  exportando,
}) {
  const [consulta, setConsulta] = useState("");
  const [soloSinFoto, setSoloSinFoto] = useState(false);
  const [porMargen, setPorMargen] = useState(false);
  const [nuevo, setNuevo] = useState("");
  /* Un pago siempre, más los planes con comisión cargada: cada uno es una
     publicación distinta en ML y tiene su propio precio. */
  const planes = useMemo(() => planesPublicables(ajustes.cuotasML), [ajustes.cuotasML]);
  const columnas = columnasDeCatalogo(planes);

  const sinFoto = perfumes.filter((p) => !p.foto).length;
  const conPrecio = perfumes.filter((p) => (p.precioPublico || 0) > 0).length;

  /* El orden alfabético se recalcula solo cuando cambia el CONJUNTO de perfumes
     visibles (alta, baja o búsqueda), nunca cuando cambia un nombre. Si se
     reordenara por nombre, cada letra que escribís mueve la fila de lugar y se
     te va de abajo del cursor. Se reacomoda al agregar o borrar algo, al buscar,
     o al volver a entrar a esta pantalla. */
  const orden = useRef({ clave: null, ids: [] });

  const visibles = useMemo(() => {
    const base = soloSinFoto ? perfumes.filter((p) => !p.foto) : perfumes;
    const filtrados = buscarPerfumes(base, consulta);
    const porId = new Map(filtrados.map((p) => [p.id, p]));

    // Ordenar por margen sí mira los precios, así que ese orden no se congela:
    // es para revisar, no para escribir.
    if (porMargen) {
      const m = (p) =>
        (p.costo || 0) > 0 && (p.precioPublico || 0) > 0
          ? (p.precioPublico - p.costo) / p.costo
          : Infinity; // los que no tienen precio, al final
      return filtrados.slice().sort((a, b) => m(a) - m(b));
    }

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
  }, [perfumes, consulta, soloSinFoto, porMargen]);

  const crear = () => {
    const nombre = nuevo.trim();
    if (!nombre) return;
    onCrear(nombre);
    setNuevo("");
  };

  return (
    <section className="mx-auto max-w-[1480px] px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="k-rotulo mb-1">Catálogo de perfumes</h2>
          <p className="text-[12.5px]" style={{ color: "var(--humo)" }}>
            {perfumes.length} perfume{perfumes.length === 1 ? "" : "s"}. Acá se carga la foto y se
            corrige el nombre; los pedidos toman los dos de acá.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className="block">
            <span className="k-col mb-1.5 block" style={{ color: "var(--humo)" }}>
              Agregar un perfume
            </span>
            <input
              value={nuevo}
              onChange={(e) => setNuevo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && crear()}
              placeholder="Marca + nombre + ml"
              className="w-[280px] rounded-[3px] border px-2 py-1.5 text-[12.5px]"
              style={{ background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" }}
            />
          </label>
          <button
            onClick={crear}
            disabled={!nuevo.trim()}
            className="flex items-center gap-1.5 rounded-[3px] px-3 py-2 text-[12.5px] font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "var(--tinta)" }}
          >
            <Plus size={15} /> Agregar
          </button>
        </div>
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
        {/* El botón sigue visible mientras el filtro esté puesto, aunque ya no
            quede ninguno sin foto: si desapareciera al cargar la última, el
            filtro quedaría activo y sin forma de apagarlo. */}
        {(sinFoto > 0 || soloSinFoto) && (
          <button
            onClick={() => setSoloSinFoto((v) => !v)}
            aria-pressed={soloSinFoto}
            className="k-col rounded-[3px] border px-3 py-[7px] transition"
            style={{
              borderColor: soloSinFoto ? "var(--ambar)" : "var(--linea)",
              color: soloSinFoto ? "var(--ambar)" : "var(--humo)",
              background: soloSinFoto ? "#FFFDF7" : "transparent",
            }}
          >
            {soloSinFoto && sinFoto === 0 ? "Ver todos" : `${sinFoto} sin foto`}
          </button>
        )}

        <button
          onClick={() => setPorMargen((v) => !v)}
          aria-pressed={porMargen}
          title="Ordena de menor a mayor margen: arriba queda lo que estas vendiendo mas barato"
          className="k-col rounded-[3px] border px-3 py-[7px] transition"
          style={{
            borderColor: porMargen ? "var(--ambar)" : "var(--linea)",
            color: porMargen ? "var(--ambar)" : "var(--humo)",
            background: porMargen ? "#FFFDF7" : "transparent",
          }}
        >
          Por margen
        </button>

        <button
          onClick={onExportarPrecios}
          disabled={conPrecio === 0 || exportando}
          title={
            conPrecio === 0
              ? "Ningun perfume tiene precio de venta todavia"
              : `Lista de precios de ${conPrecio} perfume(s) con el precio de venta directa`
          }
          className="k-col ml-auto flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border px-3 py-[7px] transition disabled:cursor-not-allowed disabled:opacity-40"
          style={{ borderColor: "var(--ambar)", color: "var(--ambar)" }}
        >
          <FileDown size={14} /> {exportando ? "Armando..." : "PDF de precios"}
        </button>
      </div>

      {/* Los ajustes se agrupan por canal y cada caja lleva el color de su
          franja en la tabla: así se ve qué configura qué sin leer el rótulo. */}
      <div className="mb-5 flex flex-wrap items-stretch gap-3">
        <div
          className="rounded-[4px] border px-3 py-2.5"
          style={{ background: "var(--zona-directa)", borderColor: "var(--zona-directa-honda)" }}
        >
          <span className="k-col mb-2 block" style={{ color: "var(--tinta)" }}>
            Venta directa
          </span>
          <label className="block">
            <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
              Envio en Rosario
            </span>
            <div className="w-[104px]">
              <NumberCell
                value={ajustes.envioLocal || 0}
                onChange={(v) => onAjustes({ envioLocal: v })}
              />
            </div>
          </label>
          <p className="mt-1.5 max-w-[150px] text-[11px]" style={{ color: "var(--humo)" }}>
            Se le suma al precio cuando hay entrega. No toca la ganancia.
          </p>
        </div>

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

      {visibles.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-[13px]" style={{ color: "var(--humo-claro)" }}>
            {perfumes.length === 0
              ? "El catálogo está vacío. Agregá el primer perfume arriba."
              : soloSinFoto
              ? "Ya no queda ningún perfume sin foto."
              : "Ningún perfume coincide con la búsqueda."}
          </p>
          {soloSinFoto && perfumes.length > 0 && (
            <button
              onClick={() => setSoloSinFoto(false)}
              className="k-col mt-3 rounded-[3px] border px-3 py-[7px] transition"
              style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
            >
              Ver todo el catálogo
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div style={{ minWidth: 824 + planes.length * 300 }}>
            <EncabezadoCatalogo planes={planes} columnas={columnas} />
            <ul className="grid gap-1.5">
              {visibles.map((p) => (
                <FilaPerfume
                  key={p.id}
                  perfume={p}
                  usos={usos[p.id] ?? SIN_USOS}
                  ajustes={ajustes}
                  planes={planes}
                  columnas={columnas}
                  onCambiar={onCambiar}
                  onSoltarMargen={onSoltarMargen}
                  onSoltarMargenML={onSoltarMargenML}
                  onBorrar={onBorrar}
                  onFoto={onFoto}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

/* El encabezado de la tabla, en dos niveles como la del pedido: arriba los
   canales —y una banda por cada publicación de ML— y abajo las columnas. Recibe
   las mismas `columnas` que las filas y lleva el mismo `border` (transparente)
   para que el borde de la fila no le corra las columnas un píxel.
   Va `sticky` contra la ventana: esta pantalla scrollea con la página, no tiene
   contenedor propio como la tabla del pedido. */
function EncabezadoCatalogo({ planes, columnas }) {
  const grupo = (texto, fondo, span) => (
    <span
      className="k-col px-2 py-1.5"
      style={{ background: fondo, color: "var(--tinta)", gridColumn: `span ${span}` }}
    >
      {texto}
    </span>
  );
  const col = (texto, fondo, alineado = "text-right") => (
    <span className={`k-col px-2 py-1.5 ${alineado}`} style={{ background: fondo, color: "var(--humo)" }}>
      {texto}
    </span>
  );

  return (
    <div className="sticky top-0 z-[5] pb-1.5 pt-1" style={{ background: "var(--vidrio)" }}>
      <div className="grid items-center border border-transparent" style={{ gridTemplateColumns: columnas }}>
        <span className="col-span-3 k-col px-2 py-1.5" style={{ color: "var(--humo)" }}>
          Perfume
        </span>
        {grupo("Venta directa", "var(--zona-directa-honda)", 4)}
        {/* Un grupo por plan: cada publicación de ML es una publicación distinta,
            con su precio y su ganancia. */}
        {planes.map((plan) => (
          <span
            key={plan}
            className="k-col px-2 py-1.5"
            style={{ background: "var(--zona-ml-honda)", color: "var(--tinta)", gridColumn: "span 3" }}
          >
            Mercado Libre · {nombreDePlan(plan)}
          </span>
        ))}
        <span className="col-span-2" />
      </div>
      <div className="grid items-center border border-transparent" style={{ gridTemplateColumns: columnas }}>
        <span />
        {col("Perfume", "transparent", "text-left")}
        {col("Costo", "transparent")}
        {col("Precio", "var(--zona-directa)")}
        {col("Margen", "var(--zona-directa)")}
        {col("Con envio", "var(--zona-directa)")}
        {col("Ganancia", "var(--zona-directa)")}
        {planes.map((plan) => (
          <Fragment key={plan}>
            {col("Precio", "var(--zona-ml)")}
            {col("Margen", "var(--zona-ml)")}
            {col("Ganancia", "var(--zona-ml)")}
          </Fragment>
        ))}
        {col("Usos", "transparent")}
        <span />
      </div>
    </div>
  );
}

/* Las celdas de plata de una fila: el costo, la venta directa, y después una
   pareja de columnas por cada publicación de Mercado Libre.

   Los dos canales se leen como territorios porque tienen fondo propio
   (`--zona-directa` / `--zona-ml`). El ámbar no se usa para eso: sigue siendo
   solo la ganancia.

   El envío de Rosario NO entra en ninguna cuenta: aparece como "con envío", el
   precio que se le cotiza al cliente cuando hay que llevárselo. */
function Precios({ perfume, ajustes, planes, onCambiar, onSoltarMargen, onSoltarMargenML }) {
  const r = analisisDePrecio({
    costo: perfume.costo,
    precioPublico: perfume.precioPublico,
    perfume,
    comisionML: ajustes.comisionML,
    envioML: ajustes.envioML,
    envioLocal: ajustes.envioLocal,
    cuotasML: ajustes.cuotasML,
    planes,
  });

  const campo = (valor, alCambiar, fondo) => (
    <div className="px-1.5" style={{ background: fondo }}>
      <NumberCell value={valor ?? 0} onChange={alCambiar} />
    </div>
  );

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

  const colorGanancia = (g) =>
    g === null ? "var(--humo-claro)" : g >= 0 ? "var(--ambar)" : "var(--oxido)";
  const colorMargen = (m) =>
    m === null ? "var(--humo-claro)" : m >= 0 ? "var(--verde)" : "var(--oxido)";

  const envio = Number(ajustes.envioLocal) || 0;
  const clavado = perfume.margenObjetivo != null;
  const sinCosto = !(Number(perfume.costo) > 0);

  /* Cada plan guarda su precio. Al escribir el mapa nuevo se deja de escribir el
     `precioML` viejo: su valor ya vive en `preciosML["1"]` y tener los dos sería
     tener dos verdades. */
  /* Clavar el margen de un plan: el precio de ESE plan pasa a salir de acá.
     Los demás planes y la venta directa no se enteran. */
  const ponerMargen = (plan, margen) =>
    onCambiar(perfume.id, {
      margenesML: { ...margenesDePlanes(perfume), [plan]: margen },
    });

  const ponerPrecio = (plan, valor) =>
    onCambiar(perfume.id, {
      preciosML: { ...preciosDePlanes(perfume), [plan]: valor },
      precioML: undefined,
    });

  return (
    <>
      {campo(perfume.costo, (v) => onCambiar(perfume.id, { costo: v }), "transparent")}

      {/* ---- Venta directa: precio y margen son un par ----
           Clavado el margen, el precio pasa a ser calculado y se muestra sin
           caja; suelto, el precio se edita y el margen muestra el que sale de
           él. Escribir en el margen lo clava. Es el mismo trato que en la tabla
           del pedido. */}
      <div className="px-1.5" style={{ background: "var(--zona-directa)" }}>
        {clavado ? (
          <div className="px-0.5 text-right">
            <span className="k-num text-[13px] font-semibold" style={{ color: "var(--tinta)" }}>
              {pesos(perfume.precioPublico)}
            </span>
          </div>
        ) : (
          <NumberCell
            value={perfume.precioPublico ?? 0}
            onChange={(v) => onCambiar(perfume.id, { precioPublico: v })}
          />
        )}
      </div>
      <div className="relative px-1.5" style={{ background: "var(--zona-directa)" }}>
        {sinCosto ? (
          <div
            className="px-0.5 text-right"
            title="Cargá el costo para poder fijar un margen"
          >
            <span className="k-num text-[13px]" style={{ color: "var(--humo-claro)" }}>
              —
            </span>
          </div>
        ) : (
          <NumberCell
            value={+((clavado ? perfume.margenObjetivo : r.directo.margen ?? 0) * 100).toFixed(1)}
            onChange={(v) => onCambiar(perfume.id, { margenObjetivo: v / 100 })}
            suffix="%"
            className={clavado ? "font-semibold" : ""}
            style={
              clavado ? { borderLeft: "3px solid var(--ambar)", background: "#FFFDF7" } : undefined
            }
          />
        )}
        {clavado && (
          <button
            type="button"
            onClick={() => onSoltarMargen(perfume.id, perfume.precioPublico)}
            title="Soltar el margen y volver a poner el precio a mano"
            aria-label={`Soltar el margen de ${perfume.nombre}`}
            className="absolute -right-0.5 -top-1.5 rounded-full bg-white p-0.5 transition"
            style={{ color: "var(--humo)", boxShadow: "0 0 0 1px var(--linea)" }}
          >
            <X size={10} />
          </button>
        )}
      </div>
      {cifra(r.directo.precioConEnvio === null ? "—" : pesos(r.directo.precioConEnvio), {
        fondo: "var(--zona-directa)",
        color: r.directo.precioConEnvio === null ? "var(--humo-claro)" : "var(--tinta)",
        titulo:
          r.directo.precioConEnvio === null
            ? envio > 0
              ? "Poné el precio de venta para ver cuánto cotizar con envío"
              : "Cargá el envío de Rosario arriba para ver este precio"
            : `${pesos(perfume.precioPublico)} + ${pesos(envio)} de envío. Es lo que le cotizás al cliente con entrega; tu ganancia no cambia.`,
      })}
      {cifra(r.directo.ganancia === null ? "—" : pesos(r.directo.ganancia), {
        fondo: "var(--zona-directa)",
        color: colorGanancia(r.directo.ganancia),
        fuerte: true,
        titulo:
          r.directo.ganancia === null
            ? "Poné costo y precio de venta para ver cuánto te queda"
            : `Vendiendo directo a ${pesos(perfume.precioPublico)} te quedan ${pesos(
                r.directo.ganancia
              )} por unidad, sobre un costo de ${pesos(perfume.costo)}. El envío no entra: se cobra aparte.`,
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
          <div className="relative px-1.5" style={{ background: "var(--zona-ml)" }}>
            {sinCosto ? (
              <div className="px-0.5 text-right" title="Cargá el costo para poder fijar un margen">
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
    </>
  );
}

const pesos = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);



function FilaPerfume({
  perfume,
  usos,
  ajustes,
  planes,
  columnas,
  onCambiar,
  onSoltarMargen,
  onSoltarMargenML,
  onBorrar,
  onFoto,
}) {
  const inputRef = useRef(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);

  const elegir = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCargando(true);
    setError(false);
    try {
      await onFoto(perfume.id, file);
    } catch (err) {
      setError(true);
    } finally {
      setCargando(false);
    }
  };

  return (
    <li
      className="group grid items-center overflow-hidden rounded-[4px] border py-1.5"
      style={{
        gridTemplateColumns: columnas,
        borderColor: "var(--linea)",
        background: "var(--papel)",
      }}
    >
      <input ref={inputRef} type="file" accept="image/*" onChange={elegir} className="hidden" />
      <div className="px-1.5">
        <ConVistaPrevia archivo={perfume.foto} nombre={perfume.nombre}>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            title={
              error
                ? "No se pudo leer esa imagen. Probá con otra."
                : perfume.foto
                ? "Cambiar la foto"
                : "Cargar una foto"
            }
            className="h-[46px] w-[46px] shrink-0 overflow-hidden rounded-[3px] border transition"
            style={{
              borderColor: error ? "var(--oxido)" : "var(--linea)",
              borderStyle: perfume.foto ? "solid" : "dashed",
              background: perfume.foto ? "var(--papel)" : "#F4F6F2",
            }}
          >
            {cargando ? (
              <span className="text-[10px]" style={{ color: "var(--humo-claro)" }}>
                ···
              </span>
            ) : perfume.foto ? (
              <img
                src={urlFoto(perfume.foto)}
                alt={`Foto de ${perfume.nombre}`}
                className="h-full w-full object-cover"
              />
            ) : (
              <ImagePlus size={17} className="mx-auto" style={{ color: "var(--humo-claro)" }} />
            )}
          </button>
        </ConVistaPrevia>
      </div>

      <div className="px-2">
        <input
          value={perfume.nombre}
          onChange={(e) => onCambiar(perfume.id, { nombre: e.target.value })}
          placeholder="Marca + nombre + ml"
          className="w-full rounded-[3px] border px-2 py-1.5 text-[13px]"
          style={{ background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" }}
        />
      </div>

      <Precios
        perfume={perfume}
        ajustes={ajustes}
        planes={planes}
        onCambiar={onCambiar}
        onSoltarMargen={onSoltarMargen}
        onSoltarMargenML={onSoltarMargenML}
      />

      {/* Cuenta TODOS los pedidos, no solo el que está en pantalla: es el aviso
          de qué se lleva puesto un borrado. El detalle dice en cuáles. */}
      <span
        className="k-num px-2 text-right text-[11px]"
        style={{ color: usos.total === 0 ? "var(--humo-claro)" : "var(--humo)" }}
        title={
          usos.total === 0
            ? "No está en ninguna fila de ningún pedido"
            : usos.pedidos.map((x) => `${x.nombre}: ${x.filas} fila${x.filas === 1 ? "" : "s"}`).join(" · ")
        }
      >
        {usos.total === 0 ? "sin usar" : `en ${usos.total}`}
      </span>

      <button
        onClick={() => onBorrar(perfume)}
        title={
          usos.total > 0
            ? `Está usado en ${usos.total} fila(s) de pedidos: te va a avisar antes de borrar`
            : "Quitar del catálogo"
        }
        className="rounded-[3px] p-1.5 transition"
        style={{ color: usos.total > 0 ? "var(--humo-claro)" : "var(--humo)" }}
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}

