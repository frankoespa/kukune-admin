import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, ImagePlus, Search, X, FileDown } from "lucide-react";
import { urlFoto } from "./almacenamiento";
import { analisisDePrecio } from "./precios";
import { NumberCell } from "./NumberCell";
import { pctSinMiles as pctCorto } from "./numeros";

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
    <section className="mx-auto max-w-[1100px] px-6 py-8">
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

        <div className="ml-auto flex items-end gap-3">
          <label className="block">
            <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
              Comision ML
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
          <button
            onClick={onExportarPrecios}
            disabled={conPrecio === 0 || exportando}
            title={
              conPrecio === 0
                ? "Ningun perfume tiene precio de venta todavia"
                : `Lista de precios de ${conPrecio} perfume(s) con el precio de venta directa`
            }
            className="k-col flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border px-3 py-[7px] transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: "var(--ambar)", color: "var(--ambar)" }}
          >
            <FileDown size={14} /> {exportando ? "Armando..." : "PDF de precios"}
          </button>
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
        <ul className="grid gap-2">
          {visibles.map((p) => (
            <FilaPerfume
              key={p.id}
              perfume={p}
              usos={usos[p.id] || 0}
              ajustes={ajustes}
              onCambiar={onCambiar}
              onBorrar={onBorrar}
              onFoto={onFoto}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* Los dos precios y lo que sale de ellos.

   El margen es sobre el costo, la misma definición que usa la columna Margen de
   los pedidos, así que los números son comparables entre pantallas.

   "En ML" es a cuánto habría que publicarlo para ganar LO MISMO que vendiendo
   directo, porque la plataforma se lleva comisión y envío. El porcentaje chico
   de abajo es lo que quedaría si publicaras el precio directo tal cual: es el
   número que avisa cuando un precio que parece bueno no sirve en ese canal. */
function Precios({ perfume, ajustes, onCambiar }) {
  const r = analisisDePrecio({
    costo: perfume.costo,
    precioPublico: perfume.precioPublico,
    comisionML: ajustes.comisionML,
    envioML: ajustes.envioML,
  });

  // NumberCell y no un <input> a mano: trae el string local mientras se escribe
  // y lee "38.155" como 38155, que es como se tipea un precio en Argentina.
  const campo = (clave) => (
    <div className="w-[96px]">
      <NumberCell
        value={perfume[clave] ?? 0}
        onChange={(v) => onCambiar(perfume.id, { [clave]: v })}
      />
    </div>
  );

  const tono = r.margen === null ? "var(--humo-claro)" : r.margen >= 0 ? "var(--verde)" : "var(--oxido)";

  return (
    <>
      {campo("costo")}
      {campo("precioPublico")}

      {/* La ganancia en pesos va en ámbar porque es lo que queda en el bolsillo,
          que es lo único que lleva ese color en toda la app. Al lado del margen
          y no lejos: son la misma cuenta mirada de dos maneras — cuántos pesos
          y qué proporción del costo. */}
      <div
        className="w-[92px] text-right"
        title={
          r.ganancia === null
            ? "Poné costo y precio de venta para ver cuánto te queda"
            : `Vendiendo directo a ${pesos(perfume.precioPublico)} te quedan ${pesos(r.ganancia)} por unidad, sobre un costo de ${pesos(perfume.costo)}. No incluye la comisión ni el envío de Mercado Libre.`
        }
      >
        <div
          className="k-num text-[13px] font-semibold"
          style={{ color: r.ganancia === null ? "var(--humo-claro)" : r.ganancia >= 0 ? "var(--ambar)" : "var(--oxido)" }}
        >
          {r.ganancia === null ? "—" : pesos(r.ganancia)}
        </div>
        <div className="k-col" style={{ color: "var(--humo-claro)" }}>
          ganancia
        </div>
      </div>

      <div className="w-[74px] text-right">
        <div className="k-num text-[13px] font-semibold" style={{ color: tono }}>
          {r.margen === null ? "—" : pctCorto(r.margen)}
        </div>
        <div className="k-col" style={{ color: "var(--humo-claro)" }}>
          margen
        </div>
      </div>

      {/* Un solo número visible y un rótulo que dice qué es. Antes acá abajo
          había un segundo porcentaje ("directo dejaría −20%") que contestaba
          otra pregunta y se leía como si se contradijera con el precio de
          arriba. Ese dato pasó al tooltip: disponible, pero sin competir. */}
      <div
        className="w-[104px] text-right"
        title={
          r.precioML === null
            ? "Poné costo y precio de venta para ver a cuánto publicarlo en ML"
            : `Publicando a ${pesos(r.precioML)} en Mercado Libre ganás lo mismo que vendiendo directo a ${pesos(perfume.precioPublico)}. ` +
              (r.margenEnML === null
                ? ""
                : `Si en cambio publicaras los ${pesos(perfume.precioPublico)} en ML, te quedaría ${pctCorto(r.margenEnML)}.`)
        }
      >
        {/* Antes iba en ámbar, pero el precio de publicación no es ganancia:
            con la columna de ganancia al lado, dos ámbares seguidos borraban
            el significado del color. */}
        <div className="k-num text-[13px]" style={{ color: "var(--tinta)" }}>
          {r.precioML === null ? "—" : pesos(r.precioML)}
        </div>
        <div className="k-col" style={{ color: "var(--humo-claro)" }}>
          publicar en ML
        </div>
      </div>
    </>
  );
}

const pesos = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);



function FilaPerfume({ perfume, usos, ajustes, onCambiar, onBorrar, onFoto }) {
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
      className="flex items-center gap-4 rounded-[4px] border px-3 py-2"
      style={{ borderColor: "var(--linea)", background: "var(--papel)" }}
    >
      <input ref={inputRef} type="file" accept="image/*" onChange={elegir} className="hidden" />
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
        className="h-[52px] w-[52px] shrink-0 overflow-hidden rounded-[3px] border transition"
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

      <input
        value={perfume.nombre}
        onChange={(e) => onCambiar(perfume.id, { nombre: e.target.value })}
        placeholder="Marca + nombre + ml"
        className="min-w-[180px] flex-1 rounded-[3px] border px-2 py-1.5 text-[13px]"
        style={{ background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" }}
      />

      <Precios perfume={perfume} ajustes={ajustes} onCambiar={onCambiar} />

      <span className="k-num w-[70px] text-right text-[11px]" style={{ color: "var(--humo-claro)" }}>
        {usos === 0 ? "sin usar" : `en ${usos}`}
      </span>

      <button
        onClick={() => onBorrar(perfume)}
        title={
          usos > 0
            ? `Está usado en ${usos} fila(s) de pedidos`
            : "Quitar del catálogo"
        }
        className="rounded-[3px] p-1.5 transition"
        style={{ color: usos > 0 ? "var(--humo-claro)" : "var(--humo)" }}
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}
