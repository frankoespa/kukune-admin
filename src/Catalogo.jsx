import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Trash2, ImagePlus, Search, X, FileDown } from "lucide-react";
import { leerCotizacion, urlFoto } from "./almacenamiento";
import { analisisDePrecio, gananciaDeBanda, objetivoDirecto } from "./precios";
import AplicarATodos from "./AplicarATodos";
import { estaAtado, resumenDeCambio } from "./dolar";
import { SelectorRedondeo } from "./TiendaNube";
import { NumberCell } from "./NumberCell";
import { CampoProtegido } from "./CampoProtegido";
import { pctSinMiles as pctCorto } from "./numeros";
import { estaSinStock, stockPorPerfume, totalEnMano } from "./stock";
import { actualizarPublicacionML, estadoML, leerPublicacionesML } from "./clienteML";
import { actualizarVarianteTN, estadoTN, leerProductosTN, vinculoTN } from "./clienteTN";

/* Una sola fuente para las columnas del encabezado y de las filas. Si se
   escribieran por separado se desalinean al primer cambio de ancho, que es
   exactamente el error que ya se pagó en el diálogo de costos del pedido.

   Va como `gridTemplateColumns` en línea, igual que en la pestaña de Mercado
   Libre, donde sí hace falta: ahí la cantidad de columnas depende de cuántos
   planes se publiquen y una clase de Tailwind armada en tiempo de ejecución no
   existiría en el CSS.

   Columnas: foto · nombre · costo ‖ precio · margen · con envío · ganancia ‖
             sin publicar · en ML · en TN · total ‖ usos · borrar
   Mercado Libre y Tiendanube tienen su propia pestaña (`MercadoLibre.jsx`,
   `PestanaTiendaNube.jsx`): acá no entraban.
   Sin `gap` horizontal a propósito: el aire lo pone cada celda con su padding,
   así el color de cada canal es una franja continua. */
const COLUMNAS_CATALOGO =
  [
    "52px minmax(180px,1fr) 100px",
    // Precio y Margen pegados: son un par que se maneja junto, igual que en la
    // tabla del pedido. Con envío y Ganancia salen de ellos.
    "104px 88px 96px 100px",
    // Stock: la base (sin publicar, editable), lo que hay en cada canal (en
    // vivo, con +/− para mover unidades) y el total en mano. Va acá y no al lado
    // del Costo porque Costo sale de `Precios` junto con las cuatro de venta
    // directa. Pegado a Usos, que dice lo mismo desde otro lado: dónde está
    // este perfume.
    // Los canales son más anchos que la base y el total porque además del número
    // llevan los botones de mover unidades y, con un cambio pendiente, la línea
    // para mandarlo.
    "72px 96px 96px 64px",
    "72px 32px",
  ].join(" ");


const usd2 = (n) => new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0);

const CASAS = [
  ["cripto", "Cripto (USDT)"],
  ["blue", "Blue"],
  ["bolsa", "MEP"],
  ["contadoconliqui", "Contado con liqui"],
  ["oficial", "Oficial"],
  ["mayorista", "Mayorista"],
  ["tarjeta", "Tarjeta"],
];
const nombreCasa = (casa) => CASAS.find(([c]) => c === casa)?.[1] ?? casa;
const fechaCorta = (iso) => (iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

/* El dólar del catálogo: de él sale el costo en pesos de los perfumes atados.
   Se cambia escribiéndolo (o trayendo la cotización del día) y tocando
   "Aplicar", que confirma si hay atados: cambia sus costos y, con ellos, los
   precios clavados de los tres canales. No va con el candado de doble clic
   porque ese escribe en cada tecla, y acá cada tecla repreciaría el catálogo. */
/* Cuánto hay de cada perfume en ML y en Tiendanube, leído en vivo al entrar.

   NO se guarda nada: un espejo en `perfumes.json` habría que refrescarlo con
   cada lectura, o sea escribir por entrar a la pantalla, que es justo lo que la
   app evita en todos lados. El precio de esto es que las dos columnas aparecen
   con "?" hasta que vuelven las respuestas.

   Solo lectura, y si un canal no está conectado o falla, su columna queda en "no
   se sabe" y el resto del catálogo sigue andando igual: estas dos columnas son
   información al costado, no algo de lo que dependa la pantalla. */
function useStockDeCanales(perfumes) {
  const [publicaciones, setPublicaciones] = useState(null);
  const [productosTN, setProductosTN] = useState(null);
  /* Lo que ya se cambió desde acá y el canal aceptó, pisado sobre lo leído. Se
     anota en vez de volver a leer el canal entero: la respuesta del PUT ya trae
     el número, y releer las 44 publicaciones por mover una unidad es tirar el
     tope de 2 pedidos/s de ML por la ventana. */
  const [escrito, setEscrito] = useState({});

  useEffect(() => {
    let vigente = true;
    estadoML()
      .then((c) => c?.conectado && leerPublicacionesML())
      .then((pubs) => vigente && pubs && setPublicaciones(pubs))
      .catch(() => {}); // sin conexión: las columnas quedan en "?"
    estadoTN()
      .then((c) => c?.conectado && leerProductosTN())
      .then((ps) => vigente && ps && setProductosTN(ps))
      .catch(() => {});
    return () => {
      vigente = false;
    };
  }, []);

  const leido = useMemo(
    () => stockPorPerfume(perfumes, publicaciones, productosTN),
    [perfumes, publicaciones, productosTN]
  );
  const mapa = useMemo(() => {
    const ids = Object.keys(escrito);
    if (!ids.length) return leido; // el mismo Map: no invalida los memos de arriba
    const m = new Map(leido);
    for (const id of ids) if (m.has(id)) m.set(id, { ...m.get(id), ...escrito[id] });
    return m;
  }, [leido, escrito]);

  const anotar = useCallback(
    (perfumeId, cambio) =>
      setEscrito((e) => ({ ...e, [perfumeId]: { ...e[perfumeId], ...cambio } })),
    []
  );

  return [mapa, anotar];
}

function CajaDolar({ perfumes, dolar, onCambiarDolar, onConfirmar }) {
  const actual = Number(dolar?.valor) || 0;
  const [casa, setCasa] = useState(dolar?.casa || "cripto");
  const [nuevo, setNuevo] = useState(actual || 0);
  const [cotizacion, setCotizacion] = useState(null);
  const [error, setError] = useState("");
  const [trayendo, setTrayendo] = useState(false);
  const atados = perfumes.filter(estaAtado).length;

  useEffect(() => setNuevo(actual || 0), [actual]);

  const traer = async () => {
    setTrayendo(true);
    setError("");
    try {
      const c = await leerCotizacion(casa);
      setCotizacion(c);
      setNuevo(Number(c.venta) || 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setTrayendo(false);
    }
  };

  const aplicar = () => {
    const valor = Number(nuevo) || 0;
    if (!(valor > 0) || valor === actual) return;
    const guardar = () => onCambiarDolar(valor, cotizacion?.casa === casa ? casa : dolar?.casa || casa);
    const r = resumenDeCambio(perfumes, actual, valor);
    if (!r.atados) return guardar();
    onConfirmar({
      titulo: `Dólar del catálogo: ${actual ? `$${usd2(actual)} → ` : ""}$${usd2(valor)}`,
      texto:
        `Cambia el costo de ${r.cambian} perfume${r.cambian === 1 ? "" : "s"} atado${r.cambian === 1 ? "" : "s"} al dólar` +
        (r.variacion != null ? ` (${r.variacion >= 0 ? "+" : ""}${pctCorto(r.variacion, 1)})` : "") +
        " y, con ellos, el precio de los que tienen el margen clavado en venta directa, Mercado Libre y Tiendanube. " +
        "Los precios puestos a mano no se tocan. En ML y Tiendanube se mandan después, con \"Actualizar precios\".",
      etiquetaOk: "Aplicar",
      onAceptar: guardar,
    });
  };

  return (
    <div className="rounded-[4px] border px-3 py-2.5" style={{ background: "var(--papel)", borderColor: "var(--linea)" }}>
      <span className="k-col mb-2 block" style={{ color: "var(--tinta)" }}>
        Dólar del catálogo
      </span>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <label className="block">
          <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
            {actual ? `Hoy $${usd2(actual)}` : "Sin cargar"}
          </span>
          <div className="w-[112px]">
            <NumberCell value={nuevo} onChange={(v) => setNuevo(Math.max(0, v))} suffix="ARS" />
          </div>
        </label>
        <button
          type="button"
          onClick={aplicar}
          disabled={!(Number(nuevo) > 0) || Number(nuevo) === actual}
          className="rounded-[3px] px-3 py-[6px] text-[12.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: "var(--tinta)" }}
        >
          Aplicar
        </button>
        <label className="block">
          <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
            Cotización
          </span>
          <select value={casa} onChange={(e) => setCasa(e.target.value)} className="rounded-[3px] border px-2 py-[6px] text-[12.5px]" style={{ borderColor: "var(--linea)", background: "var(--papel)", color: "var(--tinta)" }}>
            {CASAS.map(([c, n]) => (
              <option key={c} value={c}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={traer}
          disabled={trayendo}
          className="k-col rounded-[3px] border px-2.5 py-[6px] disabled:opacity-40"
          style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
        >
          {trayendo ? "Trayendo…" : "Traer cotización"}
        </button>
      </div>
      <p className="mt-1.5 max-w-[420px] text-[11px]" style={{ color: error ? "var(--oxido)" : "var(--humo)" }}>
        {error
          ? error
          : cotizacion
            ? `${cotizacion.nombre}: venta $${usd2(cotizacion.venta)} (actualizado ${fechaCorta(cotizacion.fecha)}). Tocá Aplicar para usarlo.`
            : actual
              ? `${nombreCasa(dolar?.casa)} · rige desde ${fechaCorta(dolar?.fecha)} · ${atados} perfume${atados === 1 ? "" : "s"} atado${atados === 1 ? "" : "s"} al dólar.`
              : "Cargalo para poder atar costos al dólar: el costo en pesos de los atados sale de acá."}
      </p>
    </div>
  );
}

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
  onFijarObjetivo,
  onCrear,
  onBorrar,
  onFoto,
  onAjustes,
  onConfirmar,
  onExportarPrecios,
  exportando,
  onCambiarDolar,
  onAtar,
  onDesatar,
  onStockBase,
}) {
  const [consulta, setConsulta] = useState("");
  const [soloSinFoto, setSoloSinFoto] = useState(false);
  const [soloFueraDeBanda, setSoloFueraDeBanda] = useState(false);
  const [soloSinStock, setSoloSinStock] = useState(false);
  const [porMargen, setPorMargen] = useState(false);
  const [nuevo, setNuevo] = useState("");
  const columnas = COLUMNAS_CATALOGO;

  const sinFoto = perfumes.filter((p) => !p.foto).length;

  // Cuánto hay en cada canal. No se guarda: se lee en vivo (ver el hook).
  const [enCanales, anotarCanal] = useStockDeCanales(perfumes);

  /* Mandarle al canal las unidades que se juntaron con los +/−. Devuelve `null`
     si salió bien o el texto del error, que la celda muestra en su renglón.

     El orden importa y es el mismo que en las dos pestañas: **primero escribe el
     canal y solo después se mueve la base**. Si el PUT falla, el stock sin
     publicar no se toca — si no, una unidad desaparecería del cajón sin haber
     llegado a ninguna publicación.

     El delta sale de `anterior`, que es lo que el canal tenía cuando se leyó, y
     a ML se le escribe **la misma publicación de la que salió ese número**
     (`mlPubId`): comparten stock entre las del mismo User Product, así que
     elegir otra sería calcular el delta contra un número ajeno. */
  const moverEnCanal = async (perfume, canal, destino) => {
    const { ml, tn, mlPubId } = enCanales.get(perfume.id) ?? {};
    const anterior = canal === "ml" ? ml : tn;
    if (typeof anterior !== "number") return "No se sabe cuánto hay";
    try {
      if (canal === "ml") {
        if (!mlPubId) return "Sin publicación vinculada";
        const r = await actualizarPublicacionML(mlPubId, { available_quantity: destino });
        anotarCanal(perfume.id, { ml: Number(r?.publicacion?.stock ?? destino) });
      } else {
        const v = vinculoTN(perfume);
        if (!v) return "Sin variante vinculada";
        await actualizarVarianteTN(v.productId, v.variantId, { stock: destino });
        anotarCanal(perfume.id, { tn: destino });
      }
    } catch (e) {
      return e.message || "No se pudo";
    }
    if (destino !== anterior) onStockBase?.(perfume.id, anterior, destino);
    return null;
  };

  /* Los que hay que mirar: nunca se les cargó el stock, o están agotados. La
     regla vive en `estaSinStock` (`stock.js`), que es donde se puede probar.
     Depende de los canales, así que el contador se recalcula cuando llegan sus
     lecturas. */
  const sinStock = useMemo(
    () => new Set(perfumes.filter((p) => estaSinStock(p, enCanales.get(p.id))).map((p) => p.id)),
    [perfumes, enCanales]
  );

  /* Los que se salieron de la banda que se aplicó la última vez — porque les
     cambió el costo, casi siempre por el dólar. Solo se miran los que tienen
     una ganancia fija puesta: uno con precio a mano o con margen clavado es una
     excepción deliberada y no hay que darle la lata. Sin banda guardada no hay
     nada que comparar y el botón ni aparece. */
  const banda = ajustes?.bandaDirecta ?? null;
  const fueraDeBanda = useMemo(() => {
    if (!banda) return new Set();
    return new Set(
      perfumes
        .filter((p) => {
          if (!((Number(p.costo) || 0) > 0) || p.gananciaObjetivo == null) return false;
          const g = gananciaDeBanda(p.costo, banda);
          return g != null && Math.abs(Number(p.gananciaObjetivo) - g) > 1;
        })
        .map((p) => p.id)
    );
  }, [perfumes, banda]);
  const conPrecio = perfumes.filter((p) => (p.precioPublico || 0) > 0).length;

  /* El orden alfabético se recalcula solo cuando cambia el CONJUNTO de perfumes
     visibles (alta, baja o búsqueda), nunca cuando cambia un nombre. Si se
     reordenara por nombre, cada letra que escribís mueve la fila de lugar y se
     te va de abajo del cursor. Se reacomoda al agregar o borrar algo, al buscar,
     o al volver a entrar a esta pantalla. */
  const orden = useRef({ clave: null, ids: [] });

  const visibles = useMemo(() => {
    const conFiltro = soloFueraDeBanda ? perfumes.filter((p) => fueraDeBanda.has(p.id)) : perfumes;
    const conStock = soloSinStock ? conFiltro.filter((p) => sinStock.has(p.id)) : conFiltro;
    const base = soloSinFoto ? conStock.filter((p) => !p.foto) : conStock;
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
  }, [perfumes, consulta, soloSinFoto, porMargen, soloFueraDeBanda, fueraDeBanda, soloSinStock, sinStock]);

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
        {/* Los que se desalinearon de la banda. Óxido y no ámbar: es un "esto se
            corrió", el mismo sentido con el que se marcan las filas huérfanas;
            el ámbar sigue siendo sólo para la ganancia. Misma regla que el de
            arriba: no desaparece mientras el filtro esté puesto. */}
        {banda && (fueraDeBanda.size > 0 || soloFueraDeBanda) && (
          <button
            onClick={() => setSoloFueraDeBanda((v) => !v)}
            aria-pressed={soloFueraDeBanda}
            title={`La banda aplicada es ${pesos(banda.piso)} de piso, ${(banda.margen * 100)
              .toFixed(0)
              .replace(".", ",")}% de margen y ${pesos(banda.techo)} de techo. Estos quedaron con otra ganancia porque les cambió el costo.`}
            className="k-col rounded-[3px] border px-3 py-[7px] transition"
            style={{
              borderColor: soloFueraDeBanda ? "var(--oxido)" : "var(--linea)",
              color: soloFueraDeBanda ? "var(--oxido)" : "var(--humo)",
              background: soloFueraDeBanda ? "#FDF6F4" : "transparent",
            }}
          >
            {soloFueraDeBanda && fueraDeBanda.size === 0 ? "Ver todos" : `${fueraDeBanda.size} fuera de banda`}
          </button>
        )}

        {/* Los que no tienen stock sin publicar: o nunca se cargó, o se agotó.
            Misma regla que los dos de arriba: no desaparece mientras el filtro
            esté puesto, porque si no quedaría activo sin forma de apagarlo.
            Humo y no óxido: no tener stock cargado no es un error, y al principio
            van a ser todos. */}
        {(sinStock.size > 0 || soloSinStock) && (
          <button
            onClick={() => setSoloSinStock((v) => !v)}
            aria-pressed={soloSinStock}
            title="No tienen unidades en ninguna parte: cero sin publicar y cero en los canales. Uno con unidades en ML o Tiendanube no entra acá, aunque todavía no le hayas cargado la base — que falte cargarla se ve en la fila, que muestra un guión. Las unidades entran solas al cerrar un pedido; el stock inicial se carga a mano."
            className="k-col rounded-[3px] border px-3 py-[7px] transition"
            style={{
              borderColor: soloSinStock ? "var(--tinta)" : "var(--linea)",
              color: soloSinStock ? "var(--tinta)" : "var(--humo)",
              background: soloSinStock ? "var(--vidrio-hondo)" : "transparent",
            }}
          >
            {soloSinStock && sinStock.size === 0 ? "Ver todos" : `${sinStock.size} sin stock`}
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
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
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
            <SelectorRedondeo
              valor={ajustes.redondeoDirecto}
              onCambiar={(redondeoDirecto) => onAjustes({ redondeoDirecto })}
            />
          </div>
          <p className="mt-1.5 max-w-[150px] text-[11px]" style={{ color: "var(--humo)" }}>
            Se le suma al precio cuando hay entrega. No toca la ganancia.
          </p>
        </div>
        <CajaDolar perfumes={perfumes} dolar={ajustes.dolar} onCambiarDolar={onCambiarDolar} onConfirmar={onConfirmar} />
      </div>

      {/* Solo la venta directa: ML y Tiendanube fijan lo suyo en sus pestañas. */}
      <AplicarATodos
        perfumes={visibles}
        conBanda
        banda={banda}
        redondeo={ajustes?.redondeoDirecto ?? 1}
        ajustesTN={ajustes?.tiendaNube}
        filtrado={!!consulta.trim() || soloSinFoto || soloFueraDeBanda || soloSinStock}
        onFijar={onFijarObjetivo}
        onConfirmar={onConfirmar}
        esAMano={(p) => objetivoDirecto(p) === null}
        zona="var(--zona-directa)"
        avisoFinal="Cambia el precio de venta directa del catálogo; Mercado Libre y Tiendanube no se tocan."
      />

      {/* Qué es cada columna de Stock, ESCRITO y no en un `title`. Franco cargó
          el primer perfume dando por hecho que "Sin publicar" era el total y
          estuvo por poner ahí los frascos que ya tenía publicados, que los
          habría contado dos veces. Es la misma lección que el campo Stock del
          panel de publicar en ML: lo que explica un campo va en pantalla, porque
          un `title` no se descubre si no se pasa el mouse justo por encima. */}
      {perfumes.length > 0 && (
        <p className="mb-2 text-[12px] leading-relaxed" style={{ color: "var(--humo)" }}>
          <span style={{ color: "var(--tinta)" }}>Sin publicar</span> son los frascos que no están en
          ninguna publicación: el total en mano es sin publicar + en ML + en TN, así que lo que ya
          está publicado no va acá. Las dos columnas de los canales se leen en vivo y no se guardan —
          un <span className="k-num">?</span> quiere decir que no se sabe, nunca cero.
        </p>
      )}

      {visibles.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-[13px]" style={{ color: "var(--humo-claro)" }}>
            {perfumes.length === 0
              ? "El catálogo está vacío. Agregá el primer perfume arriba."
              : soloSinFoto
              ? "Ya no queda ningún perfume sin foto."
              : soloSinStock
              ? "Todos los que se ven tienen unidades en algún lado."
              : "Ningún perfume coincide con la búsqueda."}
          </p>
          {(soloSinFoto || soloSinStock) && perfumes.length > 0 && (
            <button
              onClick={() => {
                setSoloSinFoto(false);
                setSoloSinStock(false);
              }}
              className="k-col mt-3 rounded-[3px] border px-3 py-[7px] transition"
              style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
            >
              Ver todo el catálogo
            </button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div style={{ minWidth: 1120 }}>
            <EncabezadoCatalogo columnas={columnas} />
            <ul className="grid gap-1.5">
              {visibles.map((p) => (
                <FilaPerfume
                  key={p.id}
                  perfume={p}
                  usos={usos[p.id] ?? SIN_USOS}
                  ajustes={ajustes}
                  columnas={columnas}
                  enCanales={enCanales.get(p.id)}
                  onMoverCanal={moverEnCanal}
                  onCambiar={onCambiar}
                  onSoltarMargen={onSoltarMargen}
                  onFijarObjetivo={onFijarObjetivo}
                  onBorrar={onBorrar}
                  onFoto={onFoto}
                  onAtar={onAtar}
                  onDesatar={onDesatar}
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
   canales y abajo las columnas. Recibe
   las mismas `columnas` que las filas y lleva el mismo `border` (transparente)
   para que el borde de la fila no le corra las columnas un píxel.
   Va `sticky` contra la ventana: esta pantalla scrollea con la página, no tiene
   contenedor propio como la tabla del pedido. */
function EncabezadoCatalogo({ columnas }) {
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
        {grupo("Stock", "transparent", 4)}
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
        {col("Sin publicar", "transparent")}
        {col("En ML", "var(--zona-ml)")}
        {col("En TN", "var(--zona-tn)")}
        {col("Total", "transparent")}
        {col("Usos", "transparent")}
        <span />
      </div>
    </div>
  );
}

/* Las celdas de plata de una fila: el costo y la venta directa (Tiendanube
   tiene su pestaña).

   La venta directa se lee como territorio porque tiene fondo propio
   (`--zona-directa`). El ámbar no se usa para eso: sigue siendo solo la ganancia.

   El envío de Rosario NO entra en ninguna cuenta: aparece como "con envío", el
   precio que se le cotiza al cliente cuando hay que llevárselo. */
function Precios({ perfume, ajustes, onCambiar, onSoltarMargen, onFijarObjetivo, onAtar, onDesatar }) {
  // Sin planes: los de ML se miran en su pestaña.
  const r = analisisDePrecio({
    costo: perfume.costo,
    precioPublico: perfume.precioPublico,
    perfume,
    envioLocal: ajustes.envioLocal,
    planes: [],
  });

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
  // Margen o ganancia fija: con cualquiera de los dos el precio es calculado.
  const objetivo = objetivoDirecto(perfume);
  const clavado = objetivo != null;
  const sinCosto = !(Number(perfume.costo) > 0);

  /* Margen y Ganancia son las dos formas de fijar el precio: escribir en una la
     fija (y suelta la otra). La fijada lleva el borde ámbar y la X para
     soltarla; la otra muestra lo que sale del precio. Sin costo no hay cuenta. */
  const celdaObjetivo = ({ fijado, valor, onChange, suffix, titulo, que, color }) => (
    <div className="relative px-1.5" style={{ background: "var(--zona-directa)" }} title={sinCosto ? undefined : titulo}>
      {sinCosto ? (
        <div className="px-0.5 text-right" title={`Cargá el costo para poder fijar ${que}`}>
          <span className="k-num text-[13px]" style={{ color: "var(--humo-claro)" }}>
            —
          </span>
        </div>
      ) : (
        <NumberCell
          value={valor}
          onChange={onChange}
          suffix={suffix}
          className={fijado ? "font-semibold" : ""}
          style={{
            ...(color ? { color } : null),
            ...(fijado ? { borderLeft: "3px solid var(--ambar)", background: "#FFFDF7" } : null),
          }}
        />
      )}
      {fijado && (
        <button
          type="button"
          onClick={() => onSoltarMargen(perfume.id, perfume.precioPublico)}
          title={`Soltar ${que} y volver a poner el precio a mano`}
          aria-label={`Soltar ${que} de ${perfume.nombre}`}
          className="absolute -right-0.5 -top-1.5 rounded-full bg-white p-0.5 transition"
          style={{ color: "var(--humo)", boxShadow: "0 0 0 1px var(--linea)" }}
        >
          <X size={10} />
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* De este número cuelga todo lo demás —márgenes, ganancias y los precios
           clavados—: va detrás de un doble clic (`CampoProtegido`). */}
      <div className="px-1.5">
        <CampoProtegido
          valor={perfume.costo}
          onCambiar={(v) => onCambiar(perfume.id, { costo: v })}
          mostrar={(v) => (v > 0 ? pesos(v) : "—")}
          etiqueta="el costo"
        />
        {/* Atado al dólar: el costo en pesos sale de su costo en USD por el dólar
            del catálogo. El botón aparece al pasar el mouse, como los atajos. */}
        <div className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px]">
          {estaAtado(perfume) && (
            <span className="k-num" style={{ color: "var(--humo)" }} title="Costo en dólares: se mueve con el dólar del catálogo">
              US$ {usd2(perfume.costoUSD)}
            </span>
          )}
          {estaAtado(perfume) ? (
            <button
              type="button"
              onClick={() => onDesatar?.(perfume.id)}
              className="k-col rounded-[2px] px-1 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
              style={{ color: "var(--humo)" }}
              title="Dejar el costo fijo en pesos (deja de seguir al dólar)"
            >
              desatar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onAtar?.(perfume.id)}
              disabled={!(Number(ajustes.dolar?.valor) > 0) || !(Number(perfume.costo) > 0)}
              className="k-col rounded-[2px] px-1 opacity-0 transition group-hover:opacity-100 focus:opacity-100 disabled:cursor-not-allowed"
              style={{ color: "var(--humo)" }}
              title={
                !(Number(ajustes.dolar?.valor) > 0)
                  ? "Primero cargá el dólar del catálogo"
                  : !(Number(perfume.costo) > 0)
                    ? "Cargá el costo para poder atarlo"
                    : `Atar al dólar: el costo de hoy se toma como US$ ${usd2(perfume.costo / ajustes.dolar.valor)} y sube o baja con el dólar`
              }
            >
              $ atar al dólar
            </button>
          )}
        </div>
      </div>

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
      {celdaObjetivo({
        fijado: objetivo?.margen != null,
        valor: +((objetivo?.margen ?? r.directo.margen ?? 0) * 100).toFixed(1),
        onChange: (v) => onFijarObjetivo([perfume.id], { margen: v / 100 }),
        suffix: "%",
        titulo:
          objetivo?.margen != null
            ? margenReal(objetivo.margen, r.directo.margen)
            : objetivo?.ganancia != null
              ? `Ganancia fija de ${pesos(objetivo.ganancia)}: el margen sale de ahí. Escribir acá fija el margen.`
              : "Escribir acá fija el margen: el precio sale de él",
        que: "el margen",
      })}
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
      {/* La ganancia también fija el precio: en pesos, queda igual aunque cambie
          el costo. Mantiene su ámbar (u óxido si es pérdida). */}
      {celdaObjetivo({
        fijado: objetivo?.ganancia != null,
        valor: Math.round(objetivo?.ganancia ?? r.directo.ganancia ?? 0),
        onChange: (v) => onFijarObjetivo([perfume.id], { ganancia: v }),
        suffix: "$",
        color: colorGanancia(r.directo.ganancia),
        titulo:
          objetivo?.ganancia != null
            ? r.directo.ganancia != null && Math.round(r.directo.ganancia) !== Math.round(objetivo.ganancia)
              ? `Pediste ${pesos(objetivo.ganancia)} · con el precio redondeado quedan ${pesos(r.directo.ganancia)}`
              : `Ganancia fija de ${pesos(objetivo.ganancia)}: el precio es el costo más esto, y sigue al costo si cambia`
            : r.directo.ganancia === null
              ? "Escribí una ganancia en pesos para fijar el precio, o poné el precio a mano"
              : `Vendiendo directo a ${pesos(perfume.precioPublico)} te quedan ${pesos(
                  r.directo.ganancia
                )} por unidad, sobre un costo de ${pesos(perfume.costo)}. El envío no entra: se cobra aparte. Escribir acá fija la ganancia.`,
        que: "la ganancia",
      })}

    </>
  );
}

/* Con el margen clavado la celda muestra el margen PEDIDO, pero el precio pasa
   por el redondeo y deja un poco más. El `title` dice cuánto queda de verdad. */
export const margenReal = (pedido, real) =>
  real == null
    ? "Margen clavado: el precio sale de acá"
    : `Pediste ${pctCorto(pedido, 1)} · con el precio redondeado queda ${pctCorto(real, 1)}`;

export const pesos = (n) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);



/* Una celda de canal: el número que hay publicado ahí, los botones para mover
   unidades y, cuando hay un cambio sin mandar, la línea que lo manda.

   **Los +/− no escriben en el canal.** Juntan el cambio en pantalla y recién el
   tilde lo manda (pedido de Franco, elegido sobre "escribe en cada clic"): subir
   dos unidades es un solo PUT con el número final en vez de dos, un clic de más
   se corrige con el otro botón antes de mandar, y nada toca la publicación viva
   hasta que se pide. Mientras hay algo pendiente el número va en tinta con el
   anterior al lado, así se ve de dónde a dónde.

   Se puede mover solo si el canal está vinculado y se sabe cuánto hay: con `?`
   no hay contra qué calcular el delta y con `∞` no hay cuenta que llevar. */
function CeldaDeCanal({ valor, fondo, nombre, vinculado, pendiente, estado, onMover, onMandar, onCancelar }) {
  const editable = vinculado && typeof valor === "number";
  const mostrado = pendiente ?? valor;
  const hayCambio = pendiente != null && pendiente !== valor;

  const boton = (texto, delta, titulo) => (
    <button
      onClick={() => onMover(delta)}
      title={titulo}
      className="k-num w-[13px] shrink-0 text-[13px] leading-none opacity-0 transition group-hover:opacity-100"
      style={{ color: "var(--humo-claro)" }}
    >
      {texto}
    </button>
  );

  return (
    <div className="px-1.5 py-1" style={{ background: fondo }}>
      <div className="flex items-center justify-end gap-1">
        {editable && boton("−", -1, `Una unidad menos en ${nombre}. Vuelve al stock sin publicar.`)}
        <span
          className="k-num text-[12px]"
          style={{
            color: hayCambio
              ? "var(--tinta)"
              : valor == null || !vinculado
                ? "var(--humo-claro)"
                : "var(--humo)",
          }}
          title={
            valor == null
              ? `No se sabe cuánto hay en ${nombre}: está vinculado pero todavía no llegó la lectura, o no hay conexión. No es cero.`
              : !vinculado
                ? `No está publicado en ${nombre}, así que no tiene unidades ahí. Se vincula desde la pestaña de ${nombre}.`
                : valor === "inf"
                  ? `En ${nombre} la variante no lleva la cuenta del stock (gestión de stock apagada), así que no se puede mover.`
                  : `${valor} en ${nombre}. Movelo con los botones: sale del stock sin publicar y se manda con el tilde.`
          }
        >
          {mostrado == null ? "?" : mostrado === "inf" ? "∞" : mostrado}
        </span>
        {editable && boton("+", 1, `Una unidad más en ${nombre}. Sale del stock sin publicar.`)}
      </div>

      {/* El renglón de abajo y no un botón al costado: la columna es angosta y
          al costado no entra. Mismo recurso que el vínculo de catálogo en ML. */}
      {hayCambio && (
        <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[10.5px] leading-none">
          <span className="k-num" style={{ color: "var(--humo-claro)" }}>
            era {valor}
          </span>
          <button
            onClick={onMandar}
            disabled={estado === "mandando"}
            title={`Mandarle ${pendiente} unidades a ${nombre}. Se cambia en la publicación real y el stock sin publicar se ajusta solo.`}
            style={{ color: "var(--verde)" }}
          >
            {estado === "mandando" ? "…" : "✓ mandar"}
          </button>
          <button onClick={onCancelar} title="Dejarlo como está" style={{ color: "var(--humo-claro)" }}>
            ✕
          </button>
        </div>
      )}
      {estado && estado !== "mandando" && estado !== "ok" && (
        <div className="mt-0.5 text-right text-[10.5px] leading-tight" style={{ color: "var(--oxido)" }}>
          {estado}
        </div>
      )}
    </div>
  );
}

/* Las cuatro celdas de stock: la base (sin publicar, lo único que esta app posee
   y lo único que se escribe en el archivo), lo que hay en cada canal (en vivo,
   con los botones para mover unidades) y el total en mano.

   Un perfume sin stock cargado muestra "—" y no 0: la clave `stock` aparece en
   `perfumes.json` recién cuando se carga, así que abrir la app no escribe nada.

   El total era un `title` y pasó a columna a pedido de Franco: con los +/− al
   lado, es el número contra el que se comprueba que lo repartido cierre con lo
   que hay. Sigue sin existir con un canal en infinito. */
function CeldasDeStock({ perfume, enCanales, onCambiar, onMoverCanal }) {
  const base = Number(perfume.stock) || 0;
  const cargado = perfume.stock != null && perfume.stock !== "";
  const { ml, tn } = enCanales ?? { ml: null, tn: null };
  const { total, parcial, infinito } = totalEnMano(base, ml, tn);
  /* Lo tecleado y todavía sin mandar, por canal, y cómo salió el último envío.
     Es estado de pantalla: se pierde al recargar y no toca ningún archivo. */
  const [pendiente, setPendiente] = useState({});
  const [estado, setEstado] = useState({});

  const mover = (canal, valor, delta) =>
    setPendiente((p) => ({ ...p, [canal]: Math.max(0, (p[canal] ?? valor) + delta) }));

  const mandar = async (canal) => {
    const destino = pendiente[canal];
    setEstado((e) => ({ ...e, [canal]: "mandando" }));
    const error = await onMoverCanal(perfume, canal, destino);
    setEstado((e) => ({ ...e, [canal]: error ?? "ok" }));
    if (!error) setPendiente((p) => ({ ...p, [canal]: undefined }));
  };

  const comun = (canal, valor) => ({
    valor,
    nombre: canal === "ml" ? "Mercado Libre" : "Tiendanube",
    pendiente: pendiente[canal],
    estado: estado[canal],
    onMover: (d) => mover(canal, valor, d),
    onMandar: () => mandar(canal),
    onCancelar: () => {
      setPendiente((p) => ({ ...p, [canal]: undefined }));
      setEstado((e) => ({ ...e, [canal]: undefined }));
    },
  });

  return (
    <>
      <div
        className="px-1.5"
        title={
          cargado
            ? "Los frascos que no están en ninguna publicación. Se edita a mano; las unidades entran solas al cerrar un pedido y salen al asignarlas a un canal."
            : "Todavía no se cargó. Escribí cuántos frascos tenés que no estén publicados en ningún canal."
        }
      >
        <NumberCell
          value={base}
          onChange={(v) => onCambiar(perfume.id, { stock: v })}
          className={cargado ? "" : "opacity-60"}
        />
      </div>
      <CeldaDeCanal
        {...comun("ml", ml)}
        fondo="var(--zona-ml)"
        vinculado={Object.keys(perfume.publicacionesML ?? {}).length > 0}
      />
      <CeldaDeCanal {...comun("tn", tn)} fondo="var(--zona-tn)" vinculado={!!perfume.publicacionTN} />
      <div
        className="px-2 text-right"
        title={
          infinito
            ? "No hay total posible: un canal no lleva la cuenta del stock."
            : parcial
              ? "Falta leer algún canal, así que todavía no se puede sumar el total."
              : `${total} en mano: ${base} sin publicar + ${ml} en Mercado Libre + ${tn} en Tiendanube.`
        }
      >
        <span
          className="k-num text-[12px]"
          style={{ color: infinito || parcial ? "var(--humo-claro)" : "var(--tinta)" }}
        >
          {infinito ? "∞" : parcial ? "?" : total}
        </span>
      </div>
    </>
  );
}

function FilaPerfume({
  perfume,
  usos,
  ajustes,
  columnas,
  enCanales,
  onMoverCanal,
  onCambiar,
  onSoltarMargen,
  onFijarObjetivo,
  onBorrar,
  onFoto,
  onAtar,
  onDesatar,
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
        onCambiar={onCambiar}
        onSoltarMargen={onSoltarMargen}
        onFijarObjetivo={onFijarObjetivo}
        onAtar={onAtar}
        onDesatar={onDesatar}
      />

      <CeldasDeStock
        perfume={perfume}
        enCanales={enCanales}
        onCambiar={onCambiar}
        onMoverCanal={onMoverCanal}
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

