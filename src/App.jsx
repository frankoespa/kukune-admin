import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  Copy,
  Trash2,
  Info,
  TrendingUp,
  TrendingDown,
  Download,
  Upload,
  FileDown,
  ImagePlus,
  X,
} from "lucide-react";
import { construirPDF, nombreArchivoPDF } from "./pdf";
import {
  listarPedidos,
  leerPedido,
  escribirPedido,
  crearPedido,
  borrarPedido,
  urlDePedido,
  leerPerfumes,
  escribirPerfumes,
  subirFoto,
  fotoComoDataUrl,
  urlFoto,
} from "./almacenamiento";
import Catalogo, { buscarPerfumes, ConVistaPrevia } from "./Catalogo";
import { resolverPrecios } from "./precios";

/* ============================================================
   KUKUNE · Análisis de Pedido
   Réplica de la hoja "AnalisisPedido" con recálculo en vivo.
   Todas las fórmulas siguen el Excel original.
   ============================================================ */

/* Qué pedido estabas mirando. Es una preferencia de esta pantalla, no un dato
   del negocio: por eso vive en localStorage y no en los archivos. */
const PEDIDO_ACTIVO = "kukune:pedido-activo";

const DEFAULT_GLOBALS = {
  precioUsdt: 1570,       // Precio Usdt (dólar en pesos)   -> D1
  comisionRedUsdt: 0,     // Comisión Red (Usdt)            -> F1
  envioCorreo: 16000,     // Envío Correo (Pesos)           -> F2
  comisionML: 0.1532,     // Comisión Mercado Libre (%)     -> 15,32%
  // En qué moneda te cobra el proveedor de ESTE pedido. No entra en ninguna
  // fórmula: con "ARS" el dólar queda en 1 y el motor sigue siendo el mismo.
  // Lo único que cambia es cómo se rotula y se formatea la pantalla.
  monedaPedido: "USD",
};

const nuevoProducto = (over = {}) => ({
  id: crypto.randomUUID(),
  producto: "",
  tamano: "",       // Tamaño (ml)
  cantidad: 1,      // C
  costoBase: 0,     // D  Costo Base (usdt)
  otrasComis: 0,    // J  Otras Comisiones (fracción)
  envioML: 7470,    // K  Costo Envío Mercado Libre
  vendeML: true,    // M  Se Vende Por Mercado Libre?
  precioFinal: 0,   // N  Precio Final (precio de venta)
  incluir: true,    // T  Incluir en Totales
  // La fila apunta al catálogo por id. `producto` queda como copia del nombre:
  // hace legible el JSON y sirve de red si la referencia se rompiera.
  perfumeId: null,
  // Margen al que está clavada la fila, como fracción. `null` = precio a mano
  // (el comportamiento de siempre). Si tiene valor, el Precio Final se despeja
  // de acá en cada recálculo: ver src/precios.js.
  margenObjetivo: null,
  ...over,
});

const SEED = [
  nuevoProducto({
    producto: "ARMAF CLUB DE NUIT ICONIC BLUE EDP 105ML",
    tamano: "105",
    cantidad: 10,
    costoBase: 38,
    otrasComis: 0,
    envioML: 7470,
    vendeML: true,
    precioFinal: 90000,
    incluir: true,
  }),
];

/* ---------- Motor de cálculo (idéntico al Excel) ---------- */
function calcular(globals, productos) {
  const { precioUsdt, comisionRedUsdt, envioCorreo, comisionML } = globals;

  // Inversión total en USD = SUM(Costo Total usdt) = SUM(C*D)   -> D2
  const inversionUsdt = productos.reduce(
    (s, p) => s + (p.cantidad || 0) * (p.costoBase || 0),
    0
  );
  const inversionPesos = inversionUsdt * precioUsdt;                 // B2
  const costosExtras = comisionRedUsdt * precioUsdt + envioCorreo;   // H2
  const factorGasto = inversionUsdt === 0 ? 0 : costosExtras / inversionUsdt; // H1

  const filas = productos.map((p) => {
    const costoTotalUsdt = (p.cantidad || 0) * (p.costoBase || 0);          // E
    const costosExtra = (p.costoBase || 0) * factorGasto;                   // F
    const precioSinGanPesos = (p.costoBase || 0) * precioUsdt + costosExtra; // G
    const precioSinGanUsdt = precioUsdt === 0 ? 0 : precioSinGanPesos / precioUsdt; // H (corregido)
    const comisionMLval = (p.precioFinal || 0) * comisionML;                // I
    const costoVentaML =
      comisionMLval + (p.envioML || 0) + (p.precioFinal || 0) * (p.otrasComis || 0); // L
    const gananciaBruta = p.vendeML ? (p.precioFinal || 0) - costoVentaML : (p.precioFinal || 0); // O
    const gananciaBrutaTotal = gananciaBruta * (p.cantidad || 0);           // P
    const gananciaNeta = gananciaBruta - precioSinGanPesos;                 // Q
    const margen = precioSinGanPesos === 0 ? 0 : gananciaNeta / precioSinGanPesos; // R
    const gananciaNetaTotal = gananciaNeta * (p.cantidad || 0);             // S
    return {
      ...p,
      costoTotalUsdt,
      costosExtra,
      precioSinGanPesos,
      precioSinGanUsdt,
      comisionMLval,
      costoVentaML,
      gananciaBruta,
      gananciaBrutaTotal,
      gananciaNeta,
      margen,
      gananciaNetaTotal,
    };
  });

  const gananciaBrutaTotalGeneral = filas
    .filter((f) => f.incluir)
    .reduce((s, f) => s + f.gananciaBrutaTotal, 0); // J2
  const gananciaNetaTotalGeneral = filas
    .filter((f) => f.incluir)
    .reduce((s, f) => s + f.gananciaNetaTotal, 0); // L2

  return {
    filas,
    inversionUsdt,
    inversionPesos,
    costosExtras,
    factorGasto,
    gananciaBrutaTotalGeneral,
    gananciaNetaTotalGeneral,
  };
}

/* ---------- Descomposición del ingreso ----------
   A dónde va cada peso que se cobra por el pedido. No es una fórmula nueva:
   es la misma cadena del Excel sumada sobre las filas incluidas. La identidad
   cierra exacta — ingresos − costo − comisión − envío − otras = ganancia neta —
   porque gananciaNeta ya es precioFinal menos todo eso. */
function descomponerIngreso(filas) {
  const incluidas = filas.filter((f) => f.incluir);
  // Solo entran las filas que ya tienen precio de venta. Una fila incluida con
  // Precio Final en 0 todavía no es una decisión de precio: es una fila a medio
  // cargar. Mezclarlas mostraba el costo de todo el pedido contra el ingreso de
  // las pocas ya cotizadas, y eso pintaba una pérdida enorme que no existe.
  const cotizadas = incluidas.filter((f) => (f.precioFinal || 0) > 0);
  const por = (fn) => cotizadas.reduce((s, f) => s + fn(f) * (f.cantidad || 0), 0);
  return {
    incluidas: incluidas.length,
    cotizadas: cotizadas.length,
    sinPrecio: incluidas.length - cotizadas.length,
    ingresos: por((f) => f.precioFinal || 0),
    costo: por((f) => f.precioSinGanPesos),
    comision: por((f) => (f.vendeML ? f.comisionMLval : 0)),
    envio: por((f) => (f.vendeML ? f.envioML || 0 : 0)),
    otras: por((f) => (f.vendeML ? (f.precioFinal || 0) * (f.otrasComis || 0) : 0)),
    neta: cotizadas.reduce((s, f) => s + f.gananciaNetaTotal, 0),
  };
}

/* ---------- Formateadores ---------- */
const ars = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);

const arsExact = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);

const usd = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);

/* es-AR: coma decimal, como el resto de los números de la app. */
const pct = (n, decimales = 1) =>
  new Intl.NumberFormat("es-AR", {
    style: "percent",
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(Number.isFinite(n) ? n : 0);

/* ---------- Fotos ----------
   Se guardan como data URL dentro del mismo JSON de localStorage, así que hay
   que achicarlas sí o sí: el navegador da unos pocos MB en total. 700 px de
   lado largo alcanza de sobra para el PDF (la foto se imprime a ~86 mm). */
const FOTO_MAX_LADO = 700;
const FOTO_CALIDAD = 0.72;

async function comprimirImagen(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const escala = Math.min(1, FOTO_MAX_LADO / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * escala));
  const h = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF"; // los PNG con transparencia quedarían negros en JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  return canvas.toDataURL("image/jpeg", FOTO_CALIDAD);
}

/* ---------- Inputs controlados ---------- */
function NumberCell({ value, onChange, align = "right", suffix, className = "", style }) {
  const [s, setS] = useState(String(value ?? ""));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setS(value === 0 || value ? String(value) : "");
  }, [value]);
  return (
    <div className="relative">
      <input
        inputMode="decimal"
        value={s}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setS(value === 0 || value ? String(value) : "");
        }}
        onChange={(e) => {
          const raw = e.target.value.replace(",", ".");
          setS(e.target.value);
          const num = parseFloat(raw);
          onChange(Number.isFinite(num) ? num : 0);
        }}
        className={`k-num w-full rounded-[3px] border py-1.5 pl-2 ${
          suffix ? "pr-8" : "pr-2"
        } text-[12.5px] transition focus:outline-none ${
          align === "right" ? "text-right" : "text-left"
        } ${className}`}
        style={{
          background: "var(--papel)",
          borderColor: "var(--linea)",
          color: "var(--tinta)",
          ...style,
        }}
      />
      {suffix && (
        <span
          className="k-col pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px]"
          style={{ color: "var(--humo-claro)" }}
        >
          {suffix}
        </span>
      )}
    </div>
  );
}

function TextCell({ value, onChange, placeholder }) {
  return (
    <input
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-[3px] border px-2 py-1.5 text-[12.5px] transition focus:outline-none"
      style={{ background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" }}
    />
  );
}

function CheckCell({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      role="switch"
      aria-checked={value}
      title={value ? "Activado — tocá para desactivar" : "Desactivado — tocá para activar"}
      className="mx-auto block min-w-[44px] rounded-full px-3 py-1 text-[11px] font-bold tracking-wide"
      style={{
        backgroundColor: value ? "#2E7D5B" : "#E7E4DC",
        color: value ? "#FFFFFF" : "#8A857C",
        border: value ? "1px solid #2E7D5B" : "1px solid #D8D4CB",
      }}
    >
      {value ? "SÍ" : "NO"}
    </button>
  );
}

function FotoCell({ value, onChange, nombre }) {
  const inputRef = useRef(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(false);

  const elegir = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo
    if (!file) return;
    setCargando(true);
    setError(false);
    try {
      onChange(await comprimirImagen(file));
    } catch (err) {
      setError(true);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className="relative mx-auto w-[46px]">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={elegir}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        title={
          error
            ? "No se pudo leer esa imagen. Probá con otra."
            : value
            ? "Cambiar la foto"
            : "Cargar una foto"
        }
        className="block h-[46px] w-[46px] overflow-hidden rounded-md border transition"
        style={{
          borderColor: error ? "#C0392B" : value ? "#DAD6CD" : "#D8D4CB",
          borderStyle: value ? "solid" : "dashed",
          backgroundColor: value ? "#FFFFFF" : "#F6F4EF",
        }}
      >
        {cargando ? (
          <span className="text-[9px] text-[#A39E93]">···</span>
        ) : value ? (
          <img
            src={value}
            alt={nombre ? `Foto de ${nombre}` : "Foto del perfume"}
            className="h-full w-full object-cover"
          />
        ) : (
          <ImagePlus size={16} className="mx-auto text-[#A39E93]" />
        )}
      </button>
      {value && !cargando && (
        <button
          type="button"
          onClick={() => onChange(null)}
          title="Quitar la foto"
          className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 text-[#9A958A] shadow-sm ring-1 ring-[#DAD6CD] hover:text-[#C0392B] transition"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

/* El par Precio Final / Margen.

   Una fila se maneja por precio (como siempre) o se clava a un margen objetivo.
   La caja blanca marca cuál de los dos manda: si la fila está clavada, el precio
   pasa a ser un valor calculado y sale de su caja.

   Margen queda siempre editable — si fuera texto suelto no habría dónde hacer
   clic para clavar la fila. La marca ámbar a la izquierda es la que dice, de un
   vistazo, qué filas están clavadas. */
function ParPrecioMargen({ fila, setP, onSoltar }) {
  const clavada = fila.margenObjetivo != null;
  const td = "px-2 py-1.5 border-b border-[#EFEDE7]";

  return (
    <>
      <td className={td}>
        {clavada ? (
          <CalcCell strong>{ars(fila.precioFinal)}</CalcCell>
        ) : (
          <NumberCell
            value={fila.precioFinal}
            onChange={(v) => setP(fila.id, "precioFinal", v)}
            suffix="ARS"
            className="font-semibold"
          />
        )}
      </td>
      <td className={td}>
        <div className="relative">
          <NumberCell
            value={+((clavada ? fila.margenObjetivo : fila.margen) * 100).toFixed(1)}
            onChange={(v) => setP(fila.id, "margenObjetivo", v / 100)}
            suffix="%"
            className={clavada ? "font-semibold" : ""}
            style={
              clavada
                ? { borderLeft: "3px solid var(--ambar)", background: "#FFFDF7" }
                : undefined
            }
          />
          {clavada && (
            <button
              type="button"
              onClick={() => onSoltar(fila.id, fila.precioFinal)}
              title="Soltar el margen y volver a poner el precio a mano"
              className="absolute -right-1.5 -top-1.5 rounded-full bg-white p-0.5 transition"
              style={{ color: "var(--humo)", boxShadow: "0 0 0 1px var(--linea)" }}
            >
              <X size={10} />
            </button>
          )}
        </div>
      </td>
    </>
  );
}

/* Celda Producto: busca en el catálogo mientras escribís.

   El nombre no se tipea libre — sale del catálogo. Si lo que escribiste no está,
   la última opción de la lista lo da de alta con ese nombre y engancha la fila.
   Ese alta va sin foto: la foto se carga solo en la pantalla del catálogo. */
function BuscadorPerfume({ fila, perfumes, huerfana, onElegir, onCrear }) {
  const [consulta, setConsulta] = useState(null); // null = mostrando el nombre guardado
  const [abierto, setAbierto] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const contenedor = useRef(null);
  const campo = useRef(null);
  // Posición de la lista en coordenadas de pantalla. La lista se dibuja en un
  // portal al body: dentro de la celda quedaba recortada por el `overflow` de
  // la tabla y se veía cortada por abajo.
  const [caja, setCaja] = useState(null);

  const texto = consulta ?? fila.producto ?? "";
  const coincidencias = useMemo(
    () => (consulta === null ? [] : buscarPerfumes(perfumes, consulta).slice(0, 8)),
    [perfumes, consulta]
  );
  const puedeCrear =
    consulta !== null &&
    consulta.trim().length > 0 &&
    !perfumes.some((p) => p.nombre.trim().toLowerCase() === consulta.trim().toLowerCase());

  const opciones = [...coincidencias, ...(puedeCrear ? [{ crear: true }] : [])];

  const medir = () => {
    const r = campo.current?.getBoundingClientRect();
    if (r) setCaja({ left: r.left, top: r.top, bottom: r.bottom, width: r.width });
  };

  const abrir = () => {
    setConsulta("");
    setAbierto(true);
    medir();
  };

  const cerrar = () => {
    setAbierto(false);
    setConsulta(null);
    setResaltado(0);
    setCaja(null);
  };

  // La tabla scrollea por dentro: si se mueve, la lista tiene que seguir al campo.
  useEffect(() => {
    if (!abierto) return;
    const seguir = () => medir();
    window.addEventListener("scroll", seguir, true);
    window.addEventListener("resize", seguir);
    return () => {
      window.removeEventListener("scroll", seguir, true);
      window.removeEventListener("resize", seguir);
    };
  }, [abierto]);

  const elegir = (opcion) => {
    if (!opcion) return;
    if (opcion.crear) onElegir(onCrear(consulta.trim()));
    else onElegir(opcion);
    cerrar();
  };

  const teclas = (e) => {
    if (!abierto || !opciones.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setResaltado((i) => (i + 1) % opciones.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setResaltado((i) => (i - 1 + opciones.length) % opciones.length); }
    else if (e.key === "Enter") { e.preventDefault(); elegir(opciones[resaltado]); }
    else if (e.key === "Escape") cerrar();
  };

  return (
    <div className="relative" ref={contenedor}>
      <input
        ref={campo}
        value={texto}
        placeholder="Buscar en el catálogo"
        onFocus={abrir}
        onBlur={() => setTimeout(cerrar, 120)} // da tiempo al clic de la lista
        onChange={(e) => { setConsulta(e.target.value); setAbierto(true); setResaltado(0); medir(); }}
        onKeyDown={teclas}
        title={
          huerfana
            ? "Este perfume ya no está en el catálogo. Elegí otro de la lista."
            : undefined
        }
        className="w-full rounded-[3px] border px-2 py-1.5 text-[12.5px] transition focus:outline-none"
        style={{
          background: huerfana ? "#FDF3F1" : "var(--papel)",
          // ámbar: falta elegir perfume · óxido: apunta a uno que ya no existe
          borderColor: huerfana
            ? "var(--oxido)"
            : fila.perfumeId
            ? "var(--linea)"
            : "var(--ambar)",
          color: "var(--tinta)",
        }}
      />
      {abierto && opciones.length > 0 && caja && createPortal(
        <ul
          className="fixed z-[80] max-h-[280px] overflow-auto rounded-[4px] border py-1 shadow-xl"
          style={{
            background: "var(--papel)",
            borderColor: "var(--linea)",
            width: Math.max(caja.width, 320),
            left: Math.min(caja.left, window.innerWidth - Math.max(caja.width, 320) - 8),
            // Si abajo no entra, se abre para arriba.
            ...(window.innerHeight - caja.bottom < 300 && caja.top > 300
              ? { bottom: window.innerHeight - caja.top + 4 }
              : { top: caja.bottom + 4 }),
          }}
        >
          {opciones.map((o, i) => (
            <li key={o.crear ? "crear" : o.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => elegir(o)}
                onMouseEnter={() => setResaltado(i)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12.5px]"
                style={{ background: i === resaltado ? "#F4F6F2" : "transparent" }}
              >
                {o.crear ? (
                  <>
                    <Plus size={14} style={{ color: "var(--ambar)" }} />
                    <span style={{ color: "var(--ambar)" }}>
                      Crear &laquo;{consulta.trim()}&raquo; en el catálogo
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      className="h-7 w-7 shrink-0 overflow-hidden rounded-[2px]"
                      style={{ background: "#F4F6F2" }}
                    >
                      {o.foto && (
                        <img src={urlFoto(o.foto)} alt="" className="h-full w-full object-cover" />
                      )}
                    </span>
                    <span style={{ color: "var(--tinta)" }}>{o.nombre}</span>
                    {!o.foto && (
                      <span className="k-col ml-auto" style={{ color: "var(--humo-claro)" }}>
                        sin foto
                      </span>
                    )}
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  );
}

/* La foto se ve, no se toca: se carga en el catálogo.
   Al pasar el mouse por encima se agranda, que con 46 px es la única forma de
   reconocer un frasco sin irse a la otra pantalla. */
function FotoDeFila({ perfume, huerfana }) {
  if (!perfume) {
    return (
      <div
        className="mx-auto flex h-[46px] w-[46px] items-center justify-center rounded-md"
        title={huerfana ? "Este perfume ya no está en el catálogo" : undefined}
        style={{
          background: huerfana ? "#FDF3F1" : "#F4F6F2",
          border: huerfana ? "1px dashed var(--oxido)" : "none",
        }}
      >
        {huerfana && <X size={14} style={{ color: "var(--oxido)" }} />}
      </div>
    );
  }
  return (
    <ConVistaPrevia archivo={perfume.foto} nombre={perfume.nombre}>
      <div
        className="mx-auto h-[46px] w-[46px] overflow-hidden rounded-md border"
        title={
          perfume.foto
            ? perfume.nombre
            : `${perfume.nombre} todavía no tiene foto — se carga en el catálogo`
        }
        style={{
          borderColor: "var(--linea)",
          borderStyle: perfume.foto ? "solid" : "dashed",
          background: perfume.foto ? "var(--papel)" : "#F4F6F2",
        }}
      >
        {perfume.foto ? (
          <img
            src={urlFoto(perfume.foto)}
            alt={`Foto de ${perfume.nombre}`}
            className="h-full w-full object-cover"
          />
        ) : (
          <ImagePlus size={15} className="mx-auto mt-3.5" style={{ color: "var(--humo-claro)" }} />
        )}
      </div>
    </ConVistaPrevia>
  );
}

/* Diálogo propio para pedir un nombre o confirmar algo.

   No se usa `window.prompt` ni `window.confirm`: en el navegador embebido
   `prompt()` directamente no existe y `confirm()` devuelve siempre false, así que
   los botones que dependían de ellos no hacían nada — y sin decir por qué. */
function Dialogo({ dialogo, onCerrar }) {
  const [valor, setValor] = useState("");
  const campo = useRef(null);

  useEffect(() => {
    setValor(dialogo?.valor ?? "");
    if (dialogo?.conCampo) setTimeout(() => campo.current?.select(), 30);
  }, [dialogo]);

  if (!dialogo) return null;
  const puedeAceptar = !dialogo.conCampo || valor.trim().length > 0;
  const aceptar = () => {
    if (!puedeAceptar) return;
    onCerrar();
    dialogo.onAceptar?.(valor.trim());
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onCerrar}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={dialogo.titulo}
        className="w-full max-w-md rounded-[5px] p-5 shadow-xl"
        style={{ background: "var(--papel)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-[15px] font-semibold" style={{ color: "var(--tinta)" }}>
          {dialogo.titulo}
        </h3>
        {dialogo.texto && (
          <p className="mb-3 text-[12.5px]" style={{ color: "var(--humo)" }}>
            {dialogo.texto}
          </p>
        )}
        {dialogo.conCampo && (
          <input
            ref={campo}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") aceptar();
              if (e.key === "Escape") onCerrar();
            }}
            placeholder={dialogo.marcador}
            className="mb-4 w-full rounded-[3px] border px-2 py-2 text-[13px]"
            style={{ background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" }}
          />
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={onCerrar}
            className="rounded-[3px] border px-3 py-1.5 text-[12.5px]"
            style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
          >
            Cancelar
          </button>
          {/* Segunda acción, para cuando hay dos salidas razonables y elegir por
              el usuario sería decidir algo que no nos toca. */}
          {dialogo.segunda && (
            <button
              onClick={() => {
                onCerrar();
                dialogo.segunda.onAceptar?.();
              }}
              className="rounded-[3px] border px-3 py-1.5 text-[12.5px] font-medium"
              style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}
            >
              {dialogo.segunda.etiqueta}
            </button>
          )}
          <button
            onClick={aceptar}
            disabled={!puedeAceptar}
            className="rounded-[3px] px-3.5 py-1.5 text-[12.5px] font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: dialogo.peligro ? "var(--oxido)" : "var(--tinta)" }}
          >
            {dialogo.etiquetaOk ?? "Aceptar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Celda calculada (solo lectura) */
function CalcCell({ children, tone = "default", strong = false }) {
  const color =
    tone === "pos" ? "var(--verde)" : tone === "neg" ? "var(--oxido)" : "var(--tinta-suave)";
  return (
    <div
      className="k-num px-2 py-1.5 text-right text-[12.5px]"
      style={{ color, fontWeight: strong ? 600 : 400 }}
    >
      {children}
    </div>
  );
}

/* ---------- Encabezado de grupo ---------- */
/* Alto de la barra espejo de scroll. Se pega al viewport de la página. */
const ALTO_BARRA = 12;

/* Alto de la fila de grupos. Lo *impone* (`height`) y a la vez es el offset del
   ColHead, así que los dos no pueden desalinearse.
   OJO: estos dos offsets son relativos al contenedor de la tabla, no a la
   página — el contenedor tiene `overflow-y: auto` (se lo fuerza el
   `overflow-x`), así que es él el scrollport de los `sticky` de adentro. No
   encadenar estos valores con los de la barra espejo: viven en sistemas de
   coordenadas distintos. */
const ALTO_GRUPOS = 32;

function GroupHead({ label, span, accent }) {
  return (
    <th
      colSpan={span}
      className="sticky z-20 px-3 text-left text-[10px] font-semibold uppercase tracking-[0.14em]"
      style={{
        top: 0,
        background: accent,
        color: "rgba(255,255,255,.9)",
        height: ALTO_GRUPOS,
      }}
    >
      {label}
    </th>
  );
}

/* Ancho exacto de la columna "Incluir". Es la primera y queda fija al hacer
   scroll horizontal, así que "Producto" se pega justo a continuación: los dos
   valores tienen que coincidir o las columnas se superponen. */
const ANCHO_INCLUIR = 72;

function ColHead({ children, w, left }) {
  const fija = left !== undefined;
  return (
    <th
      className={`k-col sticky ${fija ? "z-20" : "z-10"} whitespace-nowrap px-2 py-2`}
      style={{
        top: ALTO_GRUPOS,
        minWidth: w,
        ...(fija ? { width: w, left } : null),
        background: "var(--tinta)",
        color: "#9AA094",
        borderBottom: "1px solid rgba(255,255,255,.12)",
      }}
    >
      {children}
    </th>
  );
}

/* ---------- Persistencia (localStorage) ----------
   Cada guardado escribe dos claves: la principal y un respaldo. Si la principal
   aparece vacía o ilegible al arrancar, se recupera del respaldo en vez de caer
   al SEED — caer al SEED y volver a guardar borraba el pedido entero. */
/* Deja los datos crudos (de localStorage o del archivo) con la forma que espera
   la app: completa globals faltantes y le pone a cada producto los campos que
   se hayan agregado después de que ese dato se guardó. */
export function normalizarEstado(data) {
  const productos = Array.isArray(data?.productos) ? data.productos : null;
  if (!productos || !productos.length) return null;
  const globals = { ...DEFAULT_GLOBALS, ...(data.globals || {}) };
  // Migración de pedidos viejos: antes de que existiera monedaPedido, la forma
  // de armar un pedido en pesos era poner el dólar en 1. Un dólar que vale un
  // peso no es un pedido en dólares, así que se infiere una sola vez y después
  // queda guardado explícito.
  if (data.globals?.monedaPedido === undefined && globals.precioUsdt === 1) {
    globals.monedaPedido = "ARS";
  }
  return {
    globals,
    productos: productos.map((x) => ({ ...nuevoProducto(), ...x })),
  };
}

/* ============================================================ */
export default function App() {
  const tablaRef = useRef(null);
  const [vista, setVista] = useState("pedido");

  /* --- Estado del pedido que se está mirando --- */
  const [globals, setGlobals] = useState(DEFAULT_GLOBALS);
  const [productos, setProductos] = useState([]);
  const [pedidos, setPedidos] = useState([]);           // la lista, sin las filas
  const [pedidoId, setPedidoId] = useState(null);
  const [nombrePedido, setNombrePedido] = useState("");

  // "cargando" | "archivo" (guarda en disco) | "sin-servidor"
  const [modoGuardado, setModoGuardado] = useState("cargando");
  const [rutaArchivo, setRutaArchivo] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [avisoCarga, setAvisoCarga] = useState("");
  const [dialogo, setDialogo] = useState(null);

  const [perfumes, setPerfumes] = useState([]);
  const perfumePorId = useMemo(() => new Map(perfumes.map((p) => [p.id, p])), [perfumes]);

  // Foto del estado tal como se cargó, para saber si el usuario cambió algo.
  const jsonInicial = useRef(null);
  // El id del pedido que está en pantalla, leído desde los temporizadores.
  const idActivo = useRef(null);
  idActivo.current = pedidoId;

  /* --- Carga inicial: la lista de pedidos y el que estabas mirando --- */
  useEffect(() => {
    let vigente = true;
    (async () => {
      const lista = await listarPedidos();
      if (!vigente) return;
      if (lista.estado === "sin-servidor") {
        setModoGuardado("sin-servidor");
        return;
      }
      setPedidos(lista.pedidos);

      // Cuál estaba abierto es una preferencia de esta pantalla, no un dato:
      // por eso vive en localStorage y no en los archivos.
      const guardado = localStorage.getItem(PEDIDO_ACTIVO);
      const elegido =
        lista.pedidos.find((p) => p.id === guardado) ?? lista.pedidos[0] ?? null;

      if (!elegido) {
        // Instalación limpia: se crea el primero para que haya dónde escribir.
        const creado = await crearPedido({
          nombre: "Pedido 1",
          globals: DEFAULT_GLOBALS,
          productos: [],
        });
        if (!vigente) return;
        setPedidos([{ id: creado.id, nombre: creado.nombre, filas: 0 }]);
        abrirPedido(creado.id, creado);
      } else {
        const r = await leerPedido(elegido.id);
        if (!vigente) return;
        if (r.estado === "ok") abrirPedido(elegido.id, r.datos);
        else setModoGuardado("sin-servidor");
      }
    })();
    return () => {
      vigente = false;
    };
  }, []);

  // Deja un pedido en pantalla. `jsonInicial` se reinicia acá: es lo que evita
  // que abrir o cambiar de pedido dispare un guardado por sí solo.
  const abrirPedido = (id, datos) => {
    const normalizado = normalizarEstado(datos) ?? {
      globals: { ...DEFAULT_GLOBALS, ...(datos?.globals || {}) },
      productos: [],
    };
    setGlobals(normalizado.globals);
    setProductos(normalizado.productos);
    setNombrePedido(datos?.nombre || "Sin nombre");
    setPedidoId(id);
    idActivo.current = id;
    jsonInicial.current = JSON.stringify(normalizado);
    yaGuarda.current = false;
    pendiente.current = null;
    clearTimeout(temporizador.current);
    localStorage.setItem(PEDIDO_ACTIVO, id);
    setModoGuardado("archivo");
    setRutaArchivo(`datos/pedidos/${id}.json`);
    setAvisoCarga("");
  };

  // Pasada previa: las filas clavadas a un margen reciben su Precio Final
  // despejado. Recién después corre el motor de siempre, sin enterarse.
  const productosResueltos = useMemo(() => {
    const conPrecio = resolverPrecios(globals, productos);
    // El nombre lo manda el catálogo. En la fila queda una copia (hace legible
    // el JSON y sirve de red si la referencia se rompiera), pero si el catálogo
    // dice otra cosa, gana el catálogo: renombrar ahí tiene que verse acá.
    let cambio = false;
    const conNombre = conPrecio.map((p) => {
      const nombre = perfumePorId.get(p.perfumeId)?.nombre;
      if (nombre === undefined || nombre === p.producto) return p;
      cambio = true;
      return { ...p, producto: nombre };
    });
    return cambio ? conNombre : conPrecio;
  }, [globals, productos, perfumePorId]);
  const R = useMemo(
    () => calcular(globals, productosResueltos),
    [globals, productosResueltos]
  );
  const D = useMemo(() => descomponerIngreso(R.filas), [R.filas]);

  // El catálogo se lee una vez y se guarda con el mismo respiro que el pedido.
  // `catalogoInicial` evita que abrir la app escriba el archivo por las dudas.
  const catalogoInicial = useRef(null);
  useEffect(() => {
    let vigente = true;
    leerPerfumes().then((r) => {
      if (!vigente) return;
      catalogoInicial.current = JSON.stringify(r.perfumes);
      setPerfumes(r.perfumes);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const guardaCatalogo = useRef(null);
  useEffect(() => {
    if (catalogoInicial.current === null) return; // todavía no cargó
    const json = JSON.stringify(perfumes);
    if (json === catalogoInicial.current) return; // nada cambió
    // La marca se actualiza ACÁ, no cuando el PUT responde. Si se esperara a la
    // respuesta, un cambio hecho mientras la escritura anterior está en vuelo se
    // compara contra una marca vieja; y si ese cambio devuelve el catálogo a una
    // forma ya guardada antes, la comparación da igual y el guardado se saltea
    // en silencio. Pasó: crear un perfume y borrarlo enseguida dejaba el archivo
    // con el perfume que la pantalla ya no mostraba.
    catalogoInicial.current = json;
    clearTimeout(guardaCatalogo.current);
    guardaCatalogo.current = setTimeout(() => {
      escribirPerfumes(perfumes).catch((e) => {
        // Se suelta la marca para que el próximo cambio reintente.
        catalogoInicial.current = "";
        setErrorGuardado(`No se pudo guardar el catálogo (${e.message}).`);
      });
    }, 800);
  }, [perfumes]);

  const [showHelp, setShowHelp] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [copiado, setCopiado] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState("");
  const [margenMasivo, setMargenMasivo] = useState(30);

  // Guardar en localStorage ante cualquier cambio.
  // Abrir la app NO escribe nada: mientras el estado siga siendo idéntico al que
  // se cargó, no se guarda. Si el arranque cayó al SEED porque el localStorage
  // no se pudo leer en ese momento, guardar acá pisaría el pedido entero con el
  // producto de ejemplo — que es exactamente como se perdieron los datos una vez.
  // La comparación (y no un "primer render") es a propósito: StrictMode corre
  // los efectos dos veces en desarrollo y un contador de renders no alcanza.
  const yaGuarda = useRef(false);
  const temporizador = useRef(null);
  const pendiente = useRef(null); // { id, json } todavía no confirmado en disco

  // Guardar ante cualquier cambio.
  // Abrir un pedido NO escribe nada: mientras el estado siga siendo idéntico al
  // que se cargó, no se guarda. Es lo que evita que un arranque a medias pise
  // un pedido entero — así se perdieron los datos una vez.
  // La comparación (y no un "primer render") es a propósito: StrictMode corre
  // los efectos dos veces en desarrollo y un contador de renders no alcanza.
  useEffect(() => {
    if (modoGuardado !== "archivo" || !pedidoId) return;
    const json = JSON.stringify({ globals, productos: productosResueltos }); // para comparar
    if (!yaGuarda.current) {
      if (json === jsonInicial.current) return; // nada cambió todavía
      yaGuarda.current = true;
    }

    // El guardado pendiente se marca con el pedido que lo originó. Si al
    // despertarse el temporizador ya estás en otro pedido, NO escribe: sin esto,
    // cambiar de pedido antes de los 800 ms mete los datos de uno en el archivo
    // del otro.
    const idAlProgramar = pedidoId;
    // Lo pendiente lleva el pedido entero, con su nombre. `json` de arriba es
    // solo para comparar contra el estado cargado (que no incluye el nombre).
    pendiente.current = {
      id: idAlProgramar,
      json: JSON.stringify({ nombre: nombrePedido, globals, productos: productosResueltos }),
    };
    setGuardando(true);
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(async () => {
      if (idActivo.current !== idAlProgramar) {
        setGuardando(false);
        return;
      }
      try {
        const r = await escribirPedido(idAlProgramar, {
          nombre: nombrePedido,
          globals,
          productos: productosResueltos,
        });
        setRutaArchivo(r.ruta);
        pendiente.current = null;
        setErrorGuardado("");
      } catch (e) {
        setErrorGuardado(
          `No se pudo guardar el pedido (${e.message}). Fijate que el servidor (npm run dev) siga corriendo.`
        );
      } finally {
        setGuardando(false);
      }
    }, 800);
  }, [globals, productosResueltos, modoGuardado, pedidoId, nombrePedido]);

  // Si cerrás la pestaña con un guardado a medio camino, se manda igual.
  useEffect(() => {
    const alSalir = () => {
      const p = pendiente.current;
      if (!p) return;
      navigator.sendBeacon?.(urlDePedido(p.id), new Blob([p.json], { type: "application/json" }));
    };
    window.addEventListener("pagehide", alSalir);
    return () => window.removeEventListener("pagehide", alSalir);
  }, []);

  /* --- Cambiar, crear, renombrar y borrar pedidos --- */

  // Antes de soltar un pedido se fuerza su guardado pendiente: si no, los
  // últimos 800 ms de edición se perderían al cambiar de hoja.
  const guardarPendiente = async () => {
    clearTimeout(temporizador.current);
    const p = pendiente.current;
    if (!p) return;
    try {
      await escribirPedido(p.id, JSON.parse(p.json));
    } catch (e) {
      /* si falla, el aviso ya lo da el efecto de guardado */
    }
    pendiente.current = null;
  };

  const refrescarLista = async () => {
    const lista = await listarPedidos();
    if (lista.estado === "ok") setPedidos(lista.pedidos);
  };

  const cambiarPedido = async (id) => {
    if (id === pedidoId) return;
    await guardarPendiente();
    const r = await leerPedido(id);
    if (r.estado === "ok") {
      abrirPedido(id, r.datos);
      refrescarLista();
    }
  };

  const nuevoPedido = (duplicando) =>
    setDialogo({
      titulo: duplicando ? "Duplicar el pedido" : "Pedido nuevo",
      texto: duplicando
        ? "Se copian los perfumes, las cantidades y los costos. Los precios y los márgenes clavados arrancan vacíos."
        : "Arranca sin perfumes, con los mismos parámetros que el pedido actual.",
      conCampo: true,
      valor: duplicando ? `${nombrePedido} (copia)` : "",
      marcador: "Nombre del proveedor",
      etiquetaOk: duplicando ? "Duplicar" : "Crear",
      onAceptar: (nombre) => crearPedidoConNombre(nombre, duplicando),
    });

  const crearPedidoConNombre = async (nombre, duplicando) => {
    await guardarPendiente();
    // Al duplicar se lleva los perfumes, cantidades y costos, pero no los
    // precios: son de ese pedido, no del proveedor.
    const filas = duplicando
      ? productosResueltos.map((p) => ({
          ...p,
          id: crypto.randomUUID(),
          precioFinal: 0,
          margenObjetivo: null,
        }))
      : [];
    const creado = await crearPedido({ nombre, globals, productos: filas });
    abrirPedido(creado.id, creado);
    refrescarLista();
  };

  const renombrarPedido = () =>
    setDialogo({
      titulo: "Renombrar el pedido",
      conCampo: true,
      valor: nombrePedido,
      marcador: "Nombre del proveedor",
      etiquetaOk: "Guardar",
      onAceptar: (nombre) => {
        setNombrePedido(nombre);
        // También en la lista del selector, o el desplegable sigue mostrando el
        // nombre viejo hasta la próxima recarga.
        setPedidos((ps) => ps.map((p) => (p.id === pedidoId ? { ...p, nombre } : p)));
        yaGuarda.current = true; // el nombre es parte del pedido: hay que guardarlo
      },
    });

  const eliminarPedido = () => {
    if (pedidos.length <= 1) {
      setDialogo({
        titulo: "Es el único pedido",
        texto: "No se puede borrar el último: la app necesita al menos un pedido donde escribir.",
        etiquetaOk: "Entendido",
      });
      return;
    }
    setDialogo({
      titulo: `¿Mandar "${nombrePedido}" a la papelera?`,
      texto: "El archivo queda en datos/papelera/ con la fecha en el nombre. No se borra.",
      etiquetaOk: "Mandar a la papelera",
      peligro: true,
      onAceptar: eliminarPedidoConfirmado,
    });
  };

  const eliminarPedidoConfirmado = async () => {
    clearTimeout(temporizador.current);
    pendiente.current = null;
    await borrarPedido(pedidoId);
    const lista = await listarPedidos();
    const quedan = lista.estado === "ok" ? lista.pedidos : [];
    setPedidos(quedan);
    if (quedan[0]) {
      const r = await leerPedido(quedan[0].id);
      if (r.estado === "ok") abrirPedido(quedan[0].id, r.datos);
    }
  };

  const exportar = async () => {
    try {
      await navigator.clipboard.writeText(
        JSON.stringify({ globals, productos: productosResueltos }, null, 2)
      );
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch (e) {}
  };

  // Importar: pega el JSON exportado desde la app anterior
  const importar = () => {
    try {
      const data = JSON.parse(importText);
      const g = { ...DEFAULT_GLOBALS, ...(data.globals || {}) };
      const p = Array.isArray(data.productos)
        ? data.productos.map((x) => ({ ...nuevoProducto(), ...x }))
        : null;
      if (!p || !p.length) throw new Error("No encontré perfumes en el texto.");
      setGlobals(g);
      setProductos(p);
      setImportError("");
      setImportText("");
      setShowImport(false);
    } catch (e) {
      setImportError("El texto no es válido. Pegá exactamente lo que copiaste de la app anterior.");
    }
  };


  // Catálogo para el proveedor: solo las filas con "Incluir" en SÍ.
  const paraProveedor = productosResueltos.filter((p) => p.incluir);
  const [armandoPDF, setArmandoPDF] = useState(false);
  const exportarPDF = async () => {
    setArmandoPDF(true);
    try {
      const fecha = new Date();
      // Las fotos viven como archivos: hay que traerlas y pasarlas a data URL,
      // que es lo único que jsPDF sabe incrustar. Solo las filas incluidas.
      const filas = await Promise.all(
        paraProveedor.map(async (p) => {
          const perfume = perfumePorId.get(p.perfumeId);
          return {
            producto: perfume?.nombre ?? p.producto,
            cantidad: p.cantidad,
            foto: await fotoComoDataUrl(perfume?.foto),
          };
        })
      );
      construirPDF(filas, { fecha }).save(nombreArchivoPDF(fecha));
    } finally {
      setArmandoPDF(false);
    }
  };

  const setG = (k) => (v) => setGlobals((g) => ({ ...g, [k]: v }));

  // Moneda del pedido: solo cambia rótulos y formatos. Lo único que toca del
  // cálculo es el dólar — en pesos vale 1, que es lo que deja el motor intacto.
  const enPesos = globals.monedaPedido === "ARS";
  const monedaCosto = enPesos ? "ARS" : "USD";
  const montoCosto = enPesos ? ars : usd; // formatea las columnas de costo base
  const cambiarMoneda = (moneda) =>
    setGlobals((g) => ({
      ...g,
      monedaPedido: moneda,
      precioUsdt:
        moneda === "ARS"
          ? 1
          : // Al volver a dólares, un dólar en 1 quedó del modo pesos: no sirve.
          g.precioUsdt === 1
          ? DEFAULT_GLOBALS.precioUsdt
          : g.precioUsdt,
    }));
  const setP = (id, k, v) =>
    setProductos((ps) => ps.map((p) => (p.id === id ? { ...p, [k]: v } : p)));
  const addP = () => setProductos((ps) => [...ps, nuevoProducto()]);
  const dupP = (id) =>
    setProductos((ps) => {
      const i = ps.findIndex((p) => p.id === id);
      const clone = { ...ps[i], id: crypto.randomUUID(), producto: ps[i].producto + " (copia)" };
      const next = [...ps];
      next.splice(i + 1, 0, clone);
      return next;
    });
  const delP = (id) => setProductos((ps) => ps.filter((p) => p.id !== id));

  /* --- Catálogo --- */
  // Cuántas filas de pedidos usan cada perfume: se muestra en el catálogo y
  // evita borrar sin saber qué se lleva puesto.
  const usosPorPerfume = useMemo(() => {
    const cuenta = {};
    for (const p of productos) if (p.perfumeId) cuenta[p.perfumeId] = (cuenta[p.perfumeId] || 0) + 1;
    return cuenta;
  }, [productos]);

  const crearPerfume = (nombre) => {
    const perfume = { id: crypto.randomUUID(), nombre: nombre.trim(), foto: null };
    setPerfumes((ps) => [...ps, perfume]);
    return perfume;
  };

  const cambiarPerfume = (id, campos) =>
    setPerfumes((ps) => ps.map((p) => (p.id === id ? { ...p, ...campos } : p)));

  const borrarPerfume = (perfume) => {
    const usos = usosPorPerfume[perfume.id] || 0;
    const quitarDelCatalogo = () => setPerfumes((ps) => ps.filter((p) => p.id !== perfume.id));

    if (usos === 0) {
      setDialogo({
        titulo: `¿Quitar "${perfume.nombre}" del catálogo?`,
        texto: "No está usado en ninguna fila de este pedido.",
        etiquetaOk: "Quitar",
        peligro: true,
        onAceptar: quitarDelCatalogo,
      });
      return;
    }

    // Con filas en uso hay dos salidas razonables y ninguna es obviamente la
    // correcta: borrar filas del pedido se lleva puestos costos y cantidades,
    // y dejarlas huérfanas tampoco es gratis. Lo elige el usuario.
    setDialogo({
      titulo: `"${perfume.nombre}" está en ${usos} fila${usos === 1 ? "" : "s"} de este pedido`,
      texto:
        "Si lo quitás solo del catálogo, esas filas se quedan con el nombre pero sin foto, " +
        "marcadas en rojo hasta que les elijas otro perfume. También podés borrarlas del pedido, " +
        "con sus cantidades y costos.",
      etiquetaOk: `Quitar y borrar ${usos === 1 ? "la fila" : `las ${usos} filas`}`,
      peligro: true,
      segunda: {
        etiqueta: "Quitar y dejar las filas",
        onAceptar: quitarDelCatalogo,
      },
      onAceptar: () => {
        setProductos((ps) => ps.filter((p) => p.perfumeId !== perfume.id));
        quitarDelCatalogo();
      },
    });
  };

  // La foto se achica en el navegador y se sube; el servidor la guarda como
  // archivo nombrado por el hash de su contenido.
  const ponerFoto = async (id, file) => {
    const archivo = await subirFoto(await comprimirImagen(file));
    cambiarPerfume(id, { foto: archivo });
  };

  // Engancha una fila del pedido a un perfume del catálogo.
  const asignarPerfume = (filaId, perfume) =>
    setProductos((ps) =>
      ps.map((p) =>
        p.id === filaId ? { ...p, perfumeId: perfume.id, producto: perfume.nombre } : p
      )
    );

  // Soltar el margen deja el precio donde había quedado. El precio resuelto
  // vive en la lista derivada, no en el estado, así que hay que devolvérselo en
  // el mismo movimiento: si no, la fila vuelve al precio viejo (normalmente 0).
  const soltarMargen = (id, precioResuelto) =>
    setProductos((ps) =>
      ps.map((p) =>
        p.id === id ? { ...p, margenObjetivo: null, precioFinal: precioResuelto } : p
      )
    );

  // Clava al mismo margen las filas incluidas, salteando las que ya tienen un
  // precio puesto a mano: ese precio es una decisión tomada y pisarla en silencio
  // sería destructivo. Las que ya estaban clavadas sí se recalculan, así que
  // volver a aplicar con otro margen funciona como uno espera.
  const conPrecioPropio = (p) => p.margenObjetivo == null && (p.precioFinal || 0) > 0;
  const alcanzadasPorMasivo = productos.filter((p) => p.incluir && !conPrecioPropio(p));
  const clavarIncluidas = () =>
    setProductos((ps) =>
      ps.map((p) =>
        p.incluir && !conPrecioPropio(p) ? { ...p, margenObjetivo: margenMasivo / 100 } : p
      )
    );

  const AMBER = "#B8862F";

  return (
    <div className="min-h-screen" style={{ background: "var(--vidrio)" }}>
      {/* Cabecera de marca */}
      <header style={{ background: "var(--tinta)" }}>
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-baseline justify-between gap-y-3 px-6 py-4">
          <div className="flex items-baseline gap-3">
            <span className="text-[21px] font-light tracking-[0.38em] text-white">KUKUNE</span>
            <nav className="flex items-baseline gap-4">
              {[
                ["pedido", "Mesa de precios"],
                ["catalogo", "Catálogo"],
              ].map(([id, texto]) => (
                <button
                  key={id}
                  onClick={() => setVista(id)}
                  aria-current={vista === id ? "page" : undefined}
                  className="k-col transition"
                  style={{
                    color: vista === id ? "var(--ambar)" : "#8E938A",
                    letterSpacing: "0.16em",
                    borderBottom: vista === id ? "1px solid var(--ambar)" : "1px solid transparent",
                    paddingBottom: 2,
                  }}
                >
                  {texto}
                </button>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={exportarPDF}
              disabled={paraProveedor.length === 0}
              title={
                paraProveedor.length === 0
                  ? "Marcá al menos un perfume con Incluir en SÍ"
                  : `Descargar el catálogo de ${paraProveedor.length} perfume(s) para el proveedor`
              }
              className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-[12px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{ borderColor: "#B8862F", color: "#B8862F" }}
            >
              <FileDown size={14} /> {armandoPDF ? "Armando…" : "PDF proveedor"}
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 text-[12px] text-[#CBC7BE] hover:text-white transition"
            >
              <Upload size={14} /> Importar datos
            </button>
            <button
              onClick={exportar}
              className="flex items-center gap-1.5 text-[12px] text-[#CBC7BE] hover:text-white transition"
            >
              <Download size={14} /> {copiado ? "¡Copiado!" : "Exportar"}
            </button>
            <button
              onClick={() => setShowHelp((s) => !s)}
              className="flex items-center gap-1.5 text-[12px] text-[#CBC7BE] hover:text-white transition"
            >
              <Info size={14} /> Cómo funciona
            </button>
          </div>
        </div>
      </header>

      {avisoCarga && (
        <div className="mx-auto max-w-[1400px] px-6 pt-4">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-[#E5D3A8] bg-[#FBF5E7] px-4 py-3 text-[12.5px] text-[#7A5B18]">
            <span>{avisoCarga}</span>
            <button
              onClick={() => setAvisoCarga("")}
              className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium hover:bg-[#F2E7CC] transition"
            >
              Entendido
            </button>
          </div>
        </div>
      )}

      {errorGuardado && (
        <div className="mx-auto max-w-[1400px] px-6 pt-4">
          <div className="rounded-lg border border-[#E8C4BD] bg-[#FBEFEC] px-4 py-3 text-[12.5px] text-[#8E3B2D]">
            {errorGuardado}
          </div>
        </div>
      )}

      {showImport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowImport(false)}
        >
          <div
            className="w-full max-w-2xl rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-semibold text-[#373737] mb-1">Importar datos</h3>
            <p className="text-[12.5px] text-[#6B665D] mb-3">
              Pegá acá el texto que copiaste de la app anterior (botón <b>Exportar datos</b>).
              Reemplaza tus parámetros y perfumes actuales.
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder='Pegá acá el JSON, por ejemplo: {"globals":{...},"productos":[...]}'
              className="w-full h-64 rounded-md border border-[#DAD6CD] bg-[#FBFAF7] p-3 text-[11px] font-mono text-[#4A463E] resize-none focus:outline-none focus:border-[#B8862F]"
            />
            {importError && <p className="mt-2 text-[12px] text-[#C0392B]">{importError}</p>}
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                onClick={() => { setShowImport(false); setImportError(""); }}
                className="rounded-lg border border-[#DAD6CD] bg-white px-3 py-1.5 text-[12.5px] text-[#6B665D] hover:bg-[#F5F3EE] transition"
              >
                Cancelar
              </button>
              <button
                onClick={importar}
                className="rounded-lg bg-[#373737] px-3.5 py-1.5 text-[12.5px] font-medium text-white hover:bg-[#2A2A2A] transition"
              >
                Importar
              </button>
            </div>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="mx-auto max-w-[1400px] px-6 pt-4">
          <div className="rounded-lg border border-[#E4E1DA] bg-white p-4 text-[13px] leading-relaxed text-[#4A463E]">
            <p className="mb-1"><b>Celdas blancas</b> = las editás vos. <b>Celdas grises</b> = se calculan solas.</p>
            <p className="mb-1"><b>Precio en la mano (Ganancia Bruta):</b> lo que te queda tras las comisiones de venta. <b>Ganancia Neta:</b> lo que ganás de verdad, ya descontado tu costo.</p>
            <p className="mb-1"><b>Costos Extras</b> (envío del correo + comisión de red) se reparten entre los productos según su costo en dólares, con el <b>Factor de Gasto</b>. Solo las filas con <b>Incluir</b> tildado suman a los totales de arriba.</p>
            <p><b>PDF proveedor:</b> descarga un catálogo con la foto, el nombre y la cantidad de cada perfume — sin precios ni márgenes. Incluye únicamente las filas con <b>Incluir</b> en <b>SÍ</b>.</p>
          </div>
        </div>
      )}

      <Dialogo dialogo={dialogo} onCerrar={() => setDialogo(null)} />

      {vista === "catalogo" && (
        <Catalogo
          perfumes={perfumes}
          usos={usosPorPerfume}
          onCambiar={cambiarPerfume}
          onCrear={crearPerfume}
          onBorrar={borrarPerfume}
          onFoto={ponerFoto}
        />
      )}

      {vista === "pedido" && (
        <>
      {/* Qué pedido estás mirando */}
      <section style={{ background: "var(--vidrio)", borderBottom: "1px solid var(--linea)" }}>
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-3">
            <span className="k-col" style={{ color: "var(--humo)" }}>
              Pedido
            </span>
            <select
              value={pedidoId ?? ""}
              onChange={(e) => cambiarPedido(e.target.value)}
              className="rounded-[3px] border px-2 py-1.5 text-[13px] font-medium"
              style={{ background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" }}
            >
              {pedidos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                  {p.filas ? ` · ${p.filas} perfumes` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            {[
              ["Nuevo", () => nuevoPedido(false), "Crear un pedido vacío, con los mismos parámetros"],
              ["Duplicar", () => nuevoPedido(true), "Copiar los perfumes y costos de este pedido, sin los precios"],
              ["Renombrar", renombrarPedido, "Cambiar el nombre de este pedido"],
              ["Borrar", eliminarPedido, "Mandar este pedido a datos/papelera/"],
            ].map(([texto, accion, ayuda]) => (
              <button
                key={texto}
                onClick={accion}
                title={ayuda}
                className="k-col rounded-[3px] px-2.5 py-1.5 transition"
                style={{ color: "var(--humo)" }}
              >
                {texto}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* La banda: a dónde va cada peso del pedido */}
      <section style={{ background: "var(--tinta)" }}>
        <div className="mx-auto max-w-[1400px] px-6 py-7">
          <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h2 className="k-rotulo" style={{ color: "var(--ambar)" }}>
              A dónde va cada peso de este pedido
            </h2>
            {/* El margen se mide sobre las mismas filas que la barra, no sobre
                todo el pedido: si no, la línea y la barra se contradicen. */}
            <p className="k-num text-[11px]" style={{ color: "#7C8177" }}>
              {D.cotizadas > 0
                ? `${ars(D.ingresos)} de venta · ${
                    D.costo > 0 ? pct(D.neta / D.costo) : "0,0%"
                  } de margen sobre el costo`
                : `${ars(R.inversionPesos)} invertidos en este pedido`}
            </p>
          </div>
          <BarraDelPedido d={D} />
        </div>
      </section>

      {/* Instrumentos: lo que se ajusta y lo que sale de eso */}
      <section
        style={{ background: "var(--vidrio-hondo)", borderBottom: "1px solid var(--linea)" }}
      >
        <div className="mx-auto grid max-w-[1400px] gap-x-8 gap-y-5 px-6 py-5 lg:grid-cols-2">
          <div>
            <h2 className="k-rotulo mb-3">Lo que ajustás</h2>
            <div className="grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
              <SelectorMoneda valor={globals.monedaPedido} onChange={cambiarMoneda} />
              {/* En pesos no hay conversión que hacer: el campo Dólar no va. */}
              {!enPesos && (
                <Field label="Dólar" hint="ARS por USD">
                  <NumberCell value={globals.precioUsdt} onChange={setG("precioUsdt")} suffix="ARS" />
                </Field>
              )}
              <Field label="Comisión red">
                <NumberCell
                  value={globals.comisionRedUsdt}
                  onChange={setG("comisionRedUsdt")}
                  suffix={monedaCosto}
                />
              </Field>
              <Field label="Envío correo" hint="fijo del pedido">
                <NumberCell value={globals.envioCorreo} onChange={setG("envioCorreo")} suffix="ARS" />
              </Field>
              <Field label="Comisión ML">
                <NumberCell
                  value={+(globals.comisionML * 100).toFixed(2)}
                  onChange={(v) => setG("comisionML")(v / 100)}
                  suffix="%"
                />
              </Field>
            </div>
          </div>
          <div>
            <h2 className="k-rotulo mb-3">Lo que sale de eso</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {/* Como porcentaje se lee solo: "el envío del correo le agrega
                  tanto por ciento arriba del costo a cada frasco". El número
                  crudo queda abajo para poder cruzarlo contra el Excel. */}
              <Derived
                label="Factor de gasto"
                value={R.inversionPesos > 0 ? pct(R.costosExtras / R.inversionPesos, 2) : "0,00 %"}
                nota={`sobre el costo · ${arsExact(R.factorGasto)}`}
              />
              <Derived label="Costos extras" value={ars(R.costosExtras)} />
              {!enPesos && <Derived label="Inversión USD" value={usd(R.inversionUsdt)} />}
              <Derived
                label={enPesos ? "Inversión" : "Inversión ARS"}
                value={ars(R.inversionPesos)}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Barra de acciones */}
      <section className="mx-auto max-w-[1400px] px-6 pt-6 pb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-[#373737]">
          Perfumes <span className="text-[#A39E93] font-normal">({productos.length})</span>
          <span className="text-[#A39E93] font-normal">
            {" · "}
            {productos.reduce((s, p) => s + (Number(p.cantidad) || 0), 0)} unidades
          </span>
        </h2>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-[74px]">
              <NumberCell value={margenMasivo} onChange={setMargenMasivo} suffix="%" />
            </div>
            <button
              onClick={clavarIncluidas}
              disabled={alcanzadasPorMasivo.length === 0}
              title={
                alcanzadasPorMasivo.length === 0
                  ? "Todas las filas incluidas ya tienen un precio puesto a mano"
                  : `Calcula el precio de ${alcanzadasPorMasivo.length} fila(s) incluida(s) para ese margen. No toca las que ya tienen un precio puesto a mano.`
              }
              className="k-col rounded-[3px] border px-3 py-[7px] transition disabled:cursor-not-allowed disabled:opacity-40"
              style={{ borderColor: "var(--ambar)", color: "var(--ambar)" }}
            >
              Aplicar margen
            </button>
          </div>
          <button
            onClick={addP}
            className="flex items-center gap-1.5 rounded-[3px] px-4 py-2 text-[13px] font-medium text-white transition"
            style={{ background: "var(--tinta)" }}
          >
            <Plus size={16} /> Agregar perfume
          </button>
        </div>
      </section>

      {/* Tabla */}
      <section className="mx-auto max-w-[1400px] px-6 pb-16">
        <ScrollEspejo objetivo={tablaRef} />
        {/* El alto máximo es lo que hace que los encabezados se peguen de verdad:
            sin él el contenedor nunca scrollea por dentro y los `sticky` de la
            tabla no tienen contra qué pegarse. De paso deja la barra horizontal
            de abajo siempre a la vista. */}
        <div
          ref={tablaRef}
          className="overflow-auto rounded-[4px]"
          style={{
            border: "1px solid var(--linea)",
            background: "var(--papel)",
            maxHeight: "calc(100vh - 5rem)",
          }}
        >
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {/* Los tonos de los grupos son los mismos tramos de la barra de
                    arriba: costo, lo que se lleva ML, y en ámbar lo que queda. */}
                <GroupHead label="Producto" span={4} accent="var(--tinta)" />
                <GroupHead label="Costo" span={5} accent="#4A4F45" />
                <GroupHead label="Venta · Mercado Libre" span={7} accent="#5A5F55" />
                <GroupHead label="Resultado" span={4} accent={AMBER} />
                <th className="sticky top-0 z-20" style={{ background: "var(--tinta)" }} />
              </tr>
              <tr>
                <ColHead w={ANCHO_INCLUIR} left={0}>Incluir</ColHead>
                <ColHead w={380} left={ANCHO_INCLUIR}>Producto</ColHead>
                <ColHead w={64}>Foto</ColHead>
                <ColHead w={70}>Cantidad</ColHead>
                <ColHead w={90}>Costo Base {monedaCosto}</ColHead>
                <ColHead w={90}>Costo Total {monedaCosto}</ColHead>
                <ColHead w={100}>Costos Extra</ColHead>
                <ColHead w={120}>Precio s/Ganancia</ColHead>
                <ColHead w={90}>s/Gan. {monedaCosto}</ColHead>
                <ColHead w={70}>Vende ML</ColHead>
                <ColHead w={100}>Comisión ML</ColHead>
                <ColHead w={80}>Otras %</ColHead>
                <ColHead w={120}>Envío ML</ColHead>
                <ColHead w={110}>Costo Venta ML</ColHead>
                <ColHead w={120}>Precio Final</ColHead>
                <ColHead w={90}>Margen</ColHead>
                <ColHead w={110}>Gan. Bruta</ColHead>
                <ColHead w={120}>Gan. Bruta Tot.</ColHead>
                <ColHead w={110}>Gan. Neta</ColHead>
                <ColHead w={120}>Gan. Neta Tot.</ColHead>
                <ColHead w={70}></ColHead>
              </tr>
            </thead>
            <tbody>
              {R.filas.map((f, idx) => (
                <tr
                  key={f.id}
                  className="transition"
                  style={{
                    background: idx % 2 ? "#F4F6F2" : "var(--papel)",
                    // Las filas que no entran al pedido se apagan, pero siguen
                    // legibles: se leen igual, pesan menos.
                    opacity: f.incluir ? 1 : 0.45,
                  }}
                >
                  {/* Producto */}
                  <td
                    className="sticky left-0 z-[2] px-2 py-1.5 border-b border-[#EFEDE7]"
                    style={{ background: "inherit", width: ANCHO_INCLUIR, minWidth: ANCHO_INCLUIR }}
                  >
                    <CheckCell value={f.incluir} onChange={(v) => setP(f.id, "incluir", v)} />
                  </td>
                  <td
                    className="sticky z-[1] px-2 py-1.5 border-b border-[#EFEDE7]"
                    style={{ background: "inherit", left: ANCHO_INCLUIR }}
                  >
                    <BuscadorPerfume
                      fila={f}
                      perfumes={perfumes}
                      huerfana={!!f.perfumeId && !perfumePorId.has(f.perfumeId)}
                      onElegir={(perfume) => asignarPerfume(f.id, perfume)}
                      onCrear={crearPerfume}
                    />
                  </td>
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]">
                    <FotoDeFila
                      perfume={perfumePorId.get(f.perfumeId)}
                      huerfana={!!f.perfumeId && !perfumePorId.has(f.perfumeId)}
                    />
                  </td>
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]">
                    <NumberCell value={f.cantidad} onChange={(v) => setP(f.id, "cantidad", v)} />
                  </td>
                  {/* Costo */}
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]">
                    <NumberCell value={f.costoBase} onChange={(v) => setP(f.id, "costoBase", v)} suffix={monedaCosto} />
                  </td>
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]"><CalcCell>{montoCosto(f.costoTotalUsdt)}</CalcCell></td>
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]"><CalcCell>{ars(f.costosExtra)}</CalcCell></td>
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]"><CalcCell strong>{ars(f.precioSinGanPesos)}</CalcCell></td>
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]"><CalcCell>{montoCosto(f.precioSinGanUsdt)}</CalcCell></td>
                  {/* Venta ML */}
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]"><CheckCell value={f.vendeML} onChange={(v) => setP(f.id, "vendeML", v)} /></td>
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]"><CalcCell>{f.vendeML ? ars(f.comisionMLval) : "—"}</CalcCell></td>
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]">
                    <NumberCell value={+(f.otrasComis * 100).toFixed(2)} onChange={(v) => setP(f.id, "otrasComis", v / 100)} suffix="%" />
                  </td>
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]">
                    <NumberCell value={f.envioML} onChange={(v) => setP(f.id, "envioML", v)} suffix="ARS" />
                  </td>
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]"><CalcCell>{f.vendeML ? ars(f.costoVentaML) : "—"}</CalcCell></td>
                  <ParPrecioMargen fila={f} setP={setP} onSoltar={soltarMargen} />
                  {/* Resultado */}
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]">
                    <CalcCell tone={f.gananciaBruta >= 0 ? "pos" : "neg"} strong>{ars(f.gananciaBruta)}</CalcCell>
                  </td>
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]">
                    <CalcCell tone={f.gananciaBrutaTotal >= 0 ? "pos" : "neg"}>{ars(f.gananciaBrutaTotal)}</CalcCell>
                  </td>
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]">
                    <CalcCell tone={f.gananciaNeta >= 0 ? "pos" : "neg"} strong>{ars(f.gananciaNeta)}</CalcCell>
                  </td>
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]">
                    <CalcCell tone={f.gananciaNetaTotal >= 0 ? "pos" : "neg"} strong>{ars(f.gananciaNetaTotal)}</CalcCell>
                  </td>
                  {/* Acciones */}
                  <td className="px-2 py-1.5 border-b border-[#EFEDE7]">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => dupP(f.id)} title="Duplicar" className="rounded-md p-1.5 text-[#9A958A] hover:bg-[#EEEBE3] hover:text-[#373737] transition">
                        <Copy size={14} />
                      </button>
                      <button onClick={() => delP(f.id)} title="Eliminar" className="rounded-md p-1.5 text-[#9A958A] hover:bg-[#F7E4E0] hover:text-[#C0392B] transition">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {R.filas.length === 0 && (
                <tr>
                  <td colSpan={21} className="px-6 py-12 text-center text-[#A39E93] text-[13px]">
                    No hay perfumes cargados. Tocá <b>Agregar perfume</b> para empezar.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={21} className="border-t border-[#E4E1DA] bg-[#FBFAF7] px-3 py-2">
                  <button
                    onClick={addP}
                    className="flex items-center gap-1.5 text-[13px] font-medium text-[#6B665D] hover:text-[#373737] transition"
                  >
                    <Plus size={15} /> Agregar perfume
                  </button>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-3 text-[11.5px] text-[#A39E93]">
          <IndicadorGuardado modo={modoGuardado} ruta={rutaArchivo} guardando={guardando} />{" "}
          El "Precio Final" es lo que ponés a la venta;
          mirá la columna <b>Gan. Bruta</b> para saber qué te queda en la mano y el <b>Margen</b> para decidir el precio.
        </p>
      </section>
        </>
      )}
    </div>
  );
}

/* La firma de la pantalla: a dónde se va cada peso del pedido.
   El ámbar es lo único saturado de la banda — y es siempre lo que te queda. */
function BarraDelPedido({ d }) {
  const perdida = d.neta < 0;
  const costos = d.costo + d.comision + d.envio + d.otras;
  // La barra mide siempre lo más grande entre lo que cobrás y lo que te cuesta,
  // así los tramos suman 100% exacto en los dos casos. Con ganancia, la cola
  // ámbar es tu margen. Con pérdida, la barra es el costo y una zona rayada
  // marca la parte que tu precio de venta no llega a cubrir.
  const base = perdida ? costos : d.ingresos;
  const tramos = [
    { id: "costo", etiqueta: "Costo de los frascos", valor: d.costo, color: "#4A4F45" },
    { id: "comision", etiqueta: "Comisión Mercado Libre", valor: d.comision, color: "#6E7369" },
    { id: "envio", etiqueta: "Envío Mercado Libre", valor: d.envio, color: "#8C9186" },
    { id: "otras", etiqueta: "Otras comisiones", valor: d.otras, color: "#A9AEA3" },
    ...(perdida
      ? []
      : [{ id: "neta", etiqueta: "Te queda", valor: d.neta, color: "var(--ambar)" }]),
  ].filter((t) => t.valor > 0.5);

  const leyenda = perdida
    ? [...tramos, { id: "falta", etiqueta: "Tu precio no cubre", valor: -d.neta, color: "var(--oxido)" }]
    : tramos;

  if (!d.incluidas) {
    return (
      <p className="text-[13px]" style={{ color: "var(--humo-claro)" }}>
        Marcá un perfume con Incluir en SÍ para ver a dónde va tu plata.
      </p>
    );
  }
  if (!d.cotizadas) {
    return (
      <p className="text-[13px]" style={{ color: "var(--humo-claro)" }}>
        Ninguno de los {d.incluidas} perfumes incluidos tiene Precio Final todavía. Poné el precio
        de venta de alguno y acá vas a ver cuánto te queda.
      </p>
    );
  }

  return (
    <div>
      <div
        className="relative flex h-11 w-full overflow-hidden rounded-[3px]"
        role="img"
        aria-label={
          perdida
            ? `Cobrando ${ars(d.ingresos)} te faltan ${ars(-d.neta)} para cubrir el costo de ${ars(costos)}`
            : `De ${ars(d.ingresos)} de venta, te quedan ${ars(d.neta)}`
        }
      >
        {tramos.map((t) => (
          <div
            key={t.id}
            title={`${t.etiqueta}: ${ars(t.valor)}`}
            /* El reparto va por flex-grow con basis 0, no por width en %:
               dentro de un flex container los porcentajes de ancho no dan el
               reparto proporcional y los tramos terminan mintiendo.
               Y va como fracción con decimales fijos, no como el importe crudo:
               con pesos del orden del millón, React lo serializa en notación
               científica (1.3603e+06) y CSS no la toma. */
            style={{
              flex: `${(t.valor / base).toFixed(6)} 0 0%`,
              background: t.color,
              borderRight: "1px solid rgba(230,233,227,.35)",
            }}
          />
        ))}
        {perdida && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0"
            title={`Tu precio no cubre: ${ars(-d.neta)}`}
            style={{
              width: `${(((-d.neta) / base) * 100).toFixed(4)}%`,
              borderLeft: "2px solid var(--oxido)",
              background:
                "repeating-linear-gradient(-45deg, rgba(166,58,42,.85) 0 6px, rgba(166,58,42,.45) 6px 12px)",
            }}
          />
        )}
      </div>

      {d.sinPrecio > 0 && (
        <p className="mt-3 text-[11.5px]" style={{ color: "#8E938A" }}>
          Calculado sobre {d.cotizadas} de los {d.incluidas} perfumes incluidos: a los otros{" "}
          {d.sinPrecio} todavía no les pusiste Precio Final.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-x-9 gap-y-3">
        {leyenda.map((t) => (
          <div key={t.id} className="min-w-[124px]">
            <div className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-[1px]"
                style={{ background: t.color }}
              />
              <span
                className="k-col"
                style={{
                  color:
                    t.id === "neta" ? "var(--ambar-vivo)" : t.id === "falta" ? "#E8917F" : "#8E938A",
                }}
              >
                {t.etiqueta}
              </span>
            </div>
            <div
              className="k-num mt-1.5"
              style={{
                fontSize: t.id === "neta" || t.id === "falta" ? 27 : 16,
                fontWeight: t.id === "neta" || t.id === "falta" ? 500 : 400,
                lineHeight: 1.1,
                color:
                  t.id === "neta"
                    ? "var(--ambar-vivo)"
                    : t.id === "falta"
                    ? "#E8917F"
                    : "#D3D7CE",
              }}
            >
              {ars(t.valor)}
            </div>
            <div className="k-num mt-0.5 text-[10.5px]" style={{ color: "#787D74" }}>
              {pct(t.valor / base)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IndicadorGuardado({ modo, ruta, guardando }) {
  if (modo === "cargando") return <span>Buscando el archivo de datos…</span>;
  if (modo === "navegador") {
    return (
      <span style={{ color: "#B8862F" }}>
        Guardando <b>solo en este navegador</b> — no encontré el servidor, así que no hay archivo.
        Exportá un respaldo por las dudas.
      </span>
    );
  }
  return (
    <span>
      {guardando ? "Guardando en " : "Guardado en "}
      <b>{ruta || "datos/analisis-pedido.json"}</b>
      {guardando ? "…" : ", dentro de la carpeta del proyecto."}
    </span>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="k-col mb-1.5 block" style={{ color: "var(--humo)" }}>
        {label}
      </span>
      {children}
      {hint && (
        <span className="mt-1 block text-[9.5px]" style={{ color: "var(--humo-claro)" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

/* Copia de la barra de scroll horizontal de la tabla, arriba y pegajosa.
   No duplica la tabla: es un div vacío del mismo ancho que el contenido, y las
   dos barras se espejan. Sin esto hay que bajar hasta la última fila para
   mover las columnas de lado. */
function ScrollEspejo({ objetivo }) {
  const propia = useRef(null);
  const [medidas, setMedidas] = useState({ contenido: 0, visible: 0 });
  const sincronizando = useRef(false);

  useEffect(() => {
    const cont = objetivo.current;
    if (!cont) return;
    const medir = () =>
      setMedidas({ contenido: cont.scrollWidth, visible: cont.clientWidth });
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(cont);
    if (cont.firstElementChild) ro.observe(cont.firstElementChild); // la tabla
    return () => ro.disconnect();
  }, [objetivo]);

  useEffect(() => {
    const cont = objetivo.current;
    const barra = propia.current;
    if (!cont || !barra) return;
    // El guard evita el ping-pong: mover una dispara el scroll de la otra.
    const espejar = (desde, hacia) => () => {
      if (sincronizando.current) return;
      sincronizando.current = true;
      hacia.scrollLeft = desde.scrollLeft;
      requestAnimationFrame(() => (sincronizando.current = false));
    };
    const deBarra = espejar(barra, cont);
    const deTabla = espejar(cont, barra);
    barra.addEventListener("scroll", deBarra, { passive: true });
    cont.addEventListener("scroll", deTabla, { passive: true });
    return () => {
      barra.removeEventListener("scroll", deBarra);
      cont.removeEventListener("scroll", deTabla);
    };
  }, [objetivo, medidas.contenido]);

  // Si la tabla entra entera en pantalla no hay nada que arrastrar.
  if (medidas.contenido <= medidas.visible + 1) return null;

  return (
    <div
      ref={propia}
      className="k-scroll-espejo sticky z-30"
      style={{ top: 0, height: ALTO_BARRA, background: "var(--vidrio)" }}
      aria-hidden="true"
    >
      <div style={{ width: medidas.contenido, height: 1 }} />
    </div>
  );
}

function SelectorMoneda({ valor, onChange }) {
  const opciones = [
    ["USD", "Dólares"],
    ["ARS", "Pesos"],
  ];
  return (
    <div>
      <span className="k-col mb-1.5 block" style={{ color: "var(--humo)" }}>
        El proveedor cobra en
      </span>
      <div
        className="inline-flex rounded-[3px] p-[2px]"
        style={{ background: "var(--papel)", border: "1px solid var(--linea)" }}
        role="group"
      >
        {opciones.map(([id, texto]) => {
          const activo = valor === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={activo}
              onClick={() => onChange(id)}
              className="k-col rounded-[2px] px-3 py-[5px] transition"
              style={{
                background: activo ? "var(--tinta)" : "transparent",
                color: activo ? "#FFFFFF" : "var(--humo)",
              }}
            >
              {texto}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* Valor calculado: sin caja, colgado de una línea. Se lee, no se toca.
   `nota` es para el valor crudo que queda abajo en chico (el Factor de Gasto
   se muestra como porcentaje, pero el número del Excel sigue a la vista). */
function Derived({ label, value, nota }) {
  return (
    <div style={{ borderTop: "1px solid var(--linea)" }} className="pt-2">
      <div className="k-col" style={{ color: "var(--humo)" }}>
        {label}
      </div>
      <div className="k-num mt-1 text-[15px]" style={{ color: "var(--tinta)" }}>
        {value}
      </div>
      {nota && (
        <div className="k-num mt-0.5 text-[10px]" style={{ color: "var(--humo-claro)" }}>
          {nota}
        </div>
      )}
    </div>
  );
}
