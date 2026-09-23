import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, ImagePlus, Search, X, FileDown } from "lucide-react";
import { urlFoto } from "./almacenamiento";
import { analisisDePrecio, gananciaPorCuotas } from "./precios";
import { NumberCell } from "./NumberCell";
import { pctSinMiles as pctCorto } from "./numeros";

/* Una sola grilla para el encabezado y para las filas. Si se escribieran por
   separado se desalinean al primer cambio de ancho, que es exactamente el error
   que ya se pagó en el diálogo de costos del pedido.
   Columnas: foto · nombre · costo ‖ precio · con envío · ganancia · margen ‖
             precio ML · ganancia · margen ‖ usos · borrar
   Sin `gap` horizontal a propósito: el aire lo pone cada celda con su padding,
   así el color de cada canal es una franja continua y no se corta entre
   columnas. */
const COLUMNAS_CATALOGO =
  "grid grid-cols-[52px_minmax(180px,1fr)_100px_104px_96px_100px_76px_120px_100px_76px_72px_32px] items-center";

const PLANES_DE_CUOTAS = [3, 6, 9, 12];

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
  /* En cuántas cuotas estoy mirando ML. Es estado de pantalla y no se guarda:
     es una lente para mirar, no un dato del perfume. */
  const [plan, setPlan] = useState(1);

  const comisionCuotas = plan === 1 ? 0 : Number(ajustes.cuotasML?.[plan]) || 0;

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
    <section className="mx-auto max-w-[1360px] px-6 py-8">
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
              <div className="w-[76px]">
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
                    <div className="w-[70px]">
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
            </div>

            <div>
              <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
                Mirar la tabla en
              </span>
              <div
                className="flex overflow-hidden rounded-[3px] border"
                style={{ borderColor: "var(--zona-ml-honda)", background: "var(--papel)" }}
              >
                {[1, ...PLANES_DE_CUOTAS].map((n) => (
                  <button
                    key={n}
                    onClick={() => setPlan(n)}
                    aria-pressed={plan === n}
                    title={
                      n === 1
                        ? "Un pago: solo la comision normal"
                        : `${n} cuotas: comision normal + ${pctCorto(ajustes.cuotasML?.[n] || 0)} extra`
                    }
                    className="k-num px-2.5 py-[7px] text-[12px] transition"
                    style={{
                      background: plan === n ? "var(--tinta)" : "transparent",
                      color: plan === n ? "#fff" : "var(--humo)",
                    }}
                  >
                    {n === 1 ? "1 pago" : `${n}x`}
                  </button>
                ))}
              </div>
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
          <div className="min-w-[1100px]">
            <EncabezadoCatalogo plan={plan} />
            <ul className="grid gap-1.5">
              {visibles.map((p) => (
                <FilaPerfume
                  key={p.id}
                  perfume={p}
                  usos={usos[p.id] ?? SIN_USOS}
                  ajustes={ajustes}
                  comisionCuotas={comisionCuotas}
                  onCambiar={onCambiar}
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
   canales, abajo las columnas. Usa `COLUMNAS_CATALOGO`, la misma grilla que las
   filas, y lleva el mismo `border` (transparente) para que el borde de la fila
   no le corra las columnas un píxel.
   Va `sticky` contra la ventana: esta pantalla scrollea con la página, no tiene
   contenedor propio como la tabla del pedido. */
function EncabezadoCatalogo({ plan }) {
  const grupo = (texto, fondo) => (
    <span
      className="k-col px-2 py-1.5"
      style={{ background: fondo, color: "var(--tinta)" }}
    >
      {texto}
    </span>
  );
  const col = (texto, fondo, alineado = "text-right") => (
    <span
      className={`k-col px-2 py-1.5 ${alineado}`}
      style={{ background: fondo, color: "var(--humo)" }}
    >
      {texto}
    </span>
  );

  return (
    <div className="sticky top-0 z-[5] pb-1.5 pt-1" style={{ background: "var(--vidrio)" }}>
      <div className={`${COLUMNAS_CATALOGO} border border-transparent`}>
        <span className="col-span-3 k-col px-2 py-1.5" style={{ color: "var(--humo)" }}>
          Perfume
        </span>
        <span className="col-span-4">{grupo("Venta directa", "var(--zona-directa-honda)")}</span>
        <span className="col-span-3">
          {grupo(plan === 1 ? "Mercado Libre · 1 pago" : `Mercado Libre · ${plan} cuotas`, "var(--zona-ml-honda)")}
        </span>
        <span className="col-span-2" />
      </div>
      <div className={`${COLUMNAS_CATALOGO} border border-transparent`}>
        <span />
        {col("Perfume", "transparent", "text-left")}
        {col("Costo", "transparent")}
        {col("Precio", "var(--zona-directa)")}
        {col("Con envio", "var(--zona-directa)")}
        {col("Ganancia", "var(--zona-directa)")}
        {col("Margen", "var(--zona-directa)")}
        {col("Precio ML", "var(--zona-ml)")}
        {col("Ganancia", "var(--zona-ml)")}
        {col("Margen", "var(--zona-ml)")}
        {col("Usos", "transparent")}
        <span />
      </div>
    </div>
  );
}

/* Las celdas de plata de una fila: el costo, y después los dos canales.

   Directo y Mercado Libre se leen como dos territorios porque tienen fondo
   propio (`--zona-directa` / `--zona-ml`). El ámbar no se usa para eso: sigue
   siendo solo la ganancia, en los dos canales.

   El envío de Rosario NO entra en ninguna cuenta: aparece como "con envío", que
   es el precio que se le cotiza al cliente cuando hay que llevárselo. La
   ganancia y el margen se miden contra el costo, igual que siempre. */
function Precios({ perfume, ajustes, comisionCuotas, onCambiar }) {
  const r = analisisDePrecio({
    costo: perfume.costo,
    precioPublico: perfume.precioPublico,
    precioML: perfume.precioML,
    comisionML: ajustes.comisionML,
    envioML: ajustes.envioML,
    envioLocal: ajustes.envioLocal,
    comisionCuotas,
  });

  const campo = (clave, fondo) => (
    <div className="px-1.5" style={{ background: fondo }}>
      <NumberCell
        value={perfume[clave] ?? 0}
        onChange={(v) => onCambiar(perfume.id, { [clave]: v })}
      />
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

  // El detalle de los cinco planes va al tooltip de la ganancia de ML: es la
  // comparación que se hace de vez en cuando, no todo el tiempo.
  const porPlan = gananciaPorCuotas({
    costo: perfume.costo,
    precioML: perfume.precioML,
    comisionML: ajustes.comisionML,
    envioML: ajustes.envioML,
    cuotas: ajustes.cuotasML,
  })
    .map(
      (x) =>
        `${x.plan === 1 ? "1 pago" : x.plan + " cuotas"}: ${
          x.ganancia === null ? "—" : pesos(x.ganancia)
        }`
    )
    .join(" · ");

  const puedeIgualar = r.ml.sugerido !== null && r.ml.sugerido !== (perfume.precioML ?? 0);

  return (
    <>
      {campo("costo", "transparent")}

      {/* ---- Venta directa ---- */}
      {campo("precioPublico", "var(--zona-directa)")}
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
      {cifra(r.directo.margen === null ? "—" : pctCorto(r.directo.margen), {
        fondo: "var(--zona-directa)",
        color: colorMargen(r.directo.margen),
        fuerte: true,
        titulo:
          "Ganancia sobre el costo, la misma definición que la columna Margen de los pedidos",
      })}

      {/* ---- Mercado Libre ---- */}
      <div className="flex items-center gap-1 px-1.5" style={{ background: "var(--zona-ml)" }}>
        <div className="min-w-0 flex-1">
          <NumberCell
            value={perfume.precioML ?? 0}
            onChange={(v) => onCambiar(perfume.id, { precioML: v })}
          />
        </div>
        {/* Atajo, no obligación: completa el precio que deja la misma ganancia
            que vendiendo directo. Aparece al pasar el mouse por la fila. */}
        {puedeIgualar && (
          <button
            onClick={() => onCambiar(perfume.id, { precioML: r.ml.sugerido })}
            title={`Poner ${pesos(
              r.ml.sugerido
            )}: a ese precio, con esta comisión, te queda lo mismo que vendiendo directo`}
            aria-label={`Igualar el precio de ML de ${perfume.nombre} a la ganancia directa`}
            className="k-num shrink-0 px-1 text-[13px] opacity-0 transition group-hover:opacity-100 focus:opacity-100"
            style={{ color: "var(--humo)" }}
          >
            =
          </button>
        )}
      </div>
      {cifra(r.ml.ganancia === null ? "—" : pesos(r.ml.ganancia), {
        fondo: "var(--zona-ml)",
        color: colorGanancia(r.ml.ganancia),
        fuerte: true,
        titulo:
          r.ml.ganancia === null
            ? "Poné costo y precio de ML para ver cuánto te queda en ese canal"
            : `Después de la comisión y el envío de ML. Según el plan — ${porPlan}`,
      })}
      {cifra(r.ml.margen === null ? "—" : pctCorto(r.ml.margen), {
        fondo: "var(--zona-ml)",
        color: colorMargen(r.ml.margen),
        fuerte: true,
        titulo: "Lo que queda en ML, sobre el costo",
      })}
    </>
  );
}

const pesos = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);



function FilaPerfume({ perfume, usos, ajustes, comisionCuotas, onCambiar, onBorrar, onFoto }) {
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
      className={`${COLUMNAS_CATALOGO} group overflow-hidden rounded-[4px] border py-1.5`}
      style={{ borderColor: "var(--linea)", background: "var(--papel)" }}
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
        comisionCuotas={comisionCuotas}
        onCambiar={onCambiar}
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

