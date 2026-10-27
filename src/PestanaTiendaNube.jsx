import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListTree, Search, X } from "lucide-react";
import { urlFoto } from "./almacenamiento";
import { analisisDePrecio, analisisTiendaNube, objetivoTN, precioTiendaNubeDesdeMargen } from "./precios";
import { AjustesTiendaNube, DetalleTiendaNube } from "./TiendaNube";
import { NumberCell } from "./NumberCell";
import { buscarPerfumes, ConVistaPrevia, margenReal, pesos } from "./Catalogo";
import { actualizarVarianteTN, cambiosParaTN, enviarCodigoTN, estadoTN, leerCuponesTN, leerProductosTN, pedirAutorizacionTN, vinculoTN } from "./clienteTN";
import { BandaConexionTN, CeldaTN, PanelActualizarTN } from "./ConexionTN";
import CuponesTN from "./CuponesTN";
import AplicarATodos from "./AplicarATodos";

/* ============================================================
   Tiendanube en su propia pestaña.

   Salió del catálogo como antes Mercado Libre (mismo molde que
   MercadoLibre.jsx). Los datos NO se mudaron: `precioTN`, `margenTN` y
   `ajustes.tiendaNube` siguen en `perfumes.json`, y esta pantalla recibe la
   misma lista resuelta que el catálogo. Nombre, foto y costo se editan en el
   catálogo; acá se ven como referencia.

   Un solo precio (`precioTN`) que tiene que dejar la ganancia pague como pague
   el cliente. El objetivo es un margen (`margenTN`) o una ganancia fija en
   pesos (`gananciaTN`), medido contra la forma de pago fijada (`formaTN`) o,
   sin ella, contra la que MENOS deja. El tercero es `igualarDirectoTN`: el
   precio sale de que la forma fijada le cobre al cliente lo mismo que la venta
   directa, para que la tienda no se vea más cara que comprar por fuera.
   Las cuentas viven en `precios.js` y el detalle por forma de pago en
   `TiendaNube.jsx`.
   ============================================================ */

// foto · nombre · costo · ganancia directa ‖ precio · margen · ganancia · en Tiendanube
const COLUMNAS_TN = "52px minmax(200px,1fr) 100px 100px 124px 88px 100px 132px";
const ANCHO_MINIMO = 52 + 200 + 200 + 312 + 132;

export default function PestanaTiendaNube({ perfumes, ajustes, onAjustes, onCambiar, onSoltarMargenTN, onFijarObjetivoTN, onConfirmar }) {
  const [consulta, setConsulta] = useState("");
  const [cuenta, setCuenta] = useState(null); // null = preguntando
  const [productos, setProductos] = useState(null);
  const [errorTN, setErrorTN] = useState("");
  const [trayendo, setTrayendo] = useState(false);
  const [panel, setPanel] = useState(null); // { renglones, perdidos }
  const [cupones, setCupones] = useState(null);
  const [errorCupones, setErrorCupones] = useState("");
  const [leyendoCupones, setLeyendoCupones] = useState(false);

  // Solo lectura. Sin el permiso de cupones el server dice qué hacer.
  const traerCupones = useCallback(async () => {
    setLeyendoCupones(true);
    setErrorCupones("");
    try {
      setCupones(await leerCuponesTN());
    } catch (e) {
      setErrorCupones(e.message);
    } finally {
      setLeyendoCupones(false);
    }
  }, []);

  /* Solo lectura: al entrar se pregunta si hay conexión y se traen los
     productos. Nada de esto escribe ni en Tiendanube ni en el catálogo. */
  const traerProductos = useCallback(async () => {
    setTrayendo(true);
    setErrorTN("");
    try {
      const lista = await leerProductosTN();
      setProductos(lista);
      return lista;
    } catch (e) {
      setErrorTN(`No se pudieron traer los productos (${e.message}).`);
      return null;
    } finally {
      setTrayendo(false);
    }
  }, []);

  useEffect(() => {
    let vigente = true;
    estadoTN()
      .then((c) => {
        if (!vigente) return;
        setCuenta(c);
        if (c.conectado) {
          traerProductos();
          traerCupones();
        }
      })
      .catch((e) => vigente && setCuenta({ conectado: false, error: e.message }));
    return () => {
      vigente = false;
    };
  }, [traerProductos, traerCupones]);

  /* Como con ML: Tiendanube vuelve a kukune.com.ar con el código en la
     dirección y Franco la pega acá. La pestaña se abre en el clic, antes del
     await: abierta después, el navegador la bloquea como popup. */
  const conectar = async () => {
    setErrorTN("");
    const ventana = window.open("", "_blank");
    try {
      const { url } = await pedirAutorizacionTN();
      if (ventana) {
        ventana.opener = null;
        ventana.location.href = url;
      } else setErrorTN(`El navegador no abrió la pestaña. Abrí esta dirección a mano: ${url}`);
      onConfirmar({
        titulo: "Conectar Tiendanube",
        texto:
          "Se abrió Tiendanube en otra pestaña. Entrá con la cuenta de KUKUNE y aceptá la app. Te va a mandar a kukune.com.ar: copiá la dirección completa de la barra (la que tiene ?code=…) y pegala acá. El código dura 5 minutos.",
        conCampo: true,
        marcador: "https://kukune.com.ar/?code=…",
        etiquetaOk: "Conectar",
        onAceptar: async (pegado) => {
          try {
            setCuenta(await enviarCodigoTN(pegado));
            traerProductos();
            traerCupones();
          } catch (e) {
            setErrorTN(`No se pudo conectar (${e.message}).`);
          }
        },
      });
    } catch (e) {
      ventana?.close();
      setErrorTN(e.message);
    }
  };

  // variantId → la variante con el nombre de su producto.
  const porVariante = useMemo(() => {
    const m = new Map();
    for (const p of productos ?? []) for (const v of p.variantes) m.set(String(v.id), { ...v, productoNombre: p.nombre });
    return m;
  }, [productos]);

  // A qué perfume está vinculada cada variante: el buscador no las ofrece dos veces.
  const usadas = useMemo(() => {
    const m = new Map();
    for (const p of perfumes) {
      const v = vinculoTN(p);
      if (v) m.set(String(v.variantId), p.nombre);
    }
    return m;
  }, [perfumes]);
  const vinculados = usadas.size;

  // Lo único que esta pantalla agrega a perfumes.json, y solo cuando se elige.
  const vincular = (perfume, vinculo) => onCambiar(perfume.id, { publicacionTN: vinculo ?? undefined });

  const abrirActualizar = async () => {
    // Se releen antes de comparar: el precio en la tienda pudo cambiar.
    const lista = await traerProductos();
    if (lista) setPanel(cambiosParaTN(perfumes, lista));
  };

  const cambiarStock = (perfume, variante, stock) =>
    onConfirmar({
      titulo: "Cambiar el stock en Tiendanube",
      texto: `"${variante.productoNombre}"${variante.valores ? ` (${variante.valores})` : ""}: de ${variante.stock} a ${stock} unidades. Se cambia en la tienda real.`,
      etiquetaOk: "Cambiar stock",
      onAceptar: async () => {
        try {
          await actualizarVarianteTN(vinculoTN(perfume).productId, variante.id, { stock });
          traerProductos();
        } catch (e) {
          setErrorTN(`No se pudo cambiar el stock (${e.message}).`);
        }
      },
    });

  /* Orden alfabético congelado por conjunto, como en el catálogo y en ML: acá se
     escriben precios y la lista no debe moverse por eso. */
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
        <h2 className="k-rotulo mb-1">Tiendanube</h2>
        <p className="text-[12.5px]" style={{ color: "var(--humo)" }}>
          Un solo precio que deja la ganancia pague como pague el cliente. El nombre, la foto y el
          costo se cargan en el catálogo.
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

      <BandaConexionTN
        cuenta={cuenta}
        productos={productos}
        vinculados={vinculados}
        trayendo={trayendo}
        onConectar={conectar}
        onRefrescar={traerProductos}
        onActualizar={abrirActualizar}
      />
      {errorTN && (
        <p className="mb-4 text-[12.5px]" style={{ color: "var(--oxido)" }}>
          {errorTN}
        </p>
      )}
      {panel && (
        <PanelActualizarTN {...panel} ajustesTN={ajustes.tiendaNube} onCerrar={() => setPanel(null)} onTerminado={traerProductos} />
      )}

      {cuenta?.conectado && (
        <CuponesTN
          cupones={cupones}
          error={errorCupones}
          cargando={leyendoCupones}
          perfumes={perfumes}
          ajustesTN={ajustes.tiendaNube}
          productos={productos ?? []}
          onRecargar={traerCupones}
          onConfirmar={onConfirmar}
          onReconectar={conectar}
        />
      )}

      <div className="mb-5">
        <AjustesTiendaNube tn={ajustes.tiendaNube} onCambiar={(tn) => onAjustes({ tiendaNube: tn })} onConfirmar={onConfirmar} />
      </div>

      <AplicarATodos
        perfumes={visibles}
        filtrado={!!consulta.trim()}
        formas={ajustes.tiendaNube?.formas ?? []}
        onFijar={onFijarObjetivoTN}
        onConfirmar={onConfirmar}
        esAMano={(p) => objetivoTN(p) === null}
        zona="var(--zona-tn)"
        avisoFinal={'No se manda nada a Tiendanube: después usá "Actualizar precios en Tiendanube".'}
      />

      {visibles.length === 0 ? (
        <p className="py-12 text-center text-[13px]" style={{ color: "var(--humo-claro)" }}>
          {perfumes.length === 0
            ? "El catálogo está vacío. Los perfumes se agregan en la pestaña Catálogo."
            : "Ningún perfume coincide con la búsqueda."}
        </p>
      ) : (
        <div className="overflow-x-auto pb-2">
          <div style={{ minWidth: ANCHO_MINIMO }}>
            <Encabezado />
            <ul className="grid gap-1.5">
              {visibles.map((p) => (
                <FilaTN
                  key={p.id}
                  perfume={p}
                  ajustes={ajustes}
                  onCambiar={onCambiar}
                  onSoltarMargenTN={onSoltarMargenTN}
                  onFijarObjetivoTN={onFijarObjetivoTN}
                  conexion={{ conectado: !!cuenta?.conectado, productos, porVariante, usadas, onVincular: vincular, onStock: cambiarStock }}
                  cuponesTienda={cupones ?? []}
                  productosTN={productos ?? []}
                />
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

/* Dos niveles, como el catálogo y ML: mismas columnas y mismo `border`
   transparente que las filas. */
function Encabezado() {
  const col = (texto, fondo, alineado = "text-right") => (
    <span className={`k-col px-2 py-1.5 ${alineado}`} style={{ background: fondo, color: "var(--humo)" }}>
      {texto}
    </span>
  );
  return (
    <div className="sticky top-0 z-[5] pb-1.5 pt-1" style={{ background: "var(--vidrio)" }}>
      <div className="grid items-center border border-transparent" style={{ gridTemplateColumns: COLUMNAS_TN }}>
        <span className="col-span-2 k-col px-2 py-1.5" style={{ color: "var(--humo)" }}>
          Perfume
        </span>
        <span className="col-span-2 k-col px-2 py-1.5" style={{ background: "var(--zona-directa-honda)", color: "var(--tinta)" }}>
          Referencia
        </span>
        <span className="col-span-4 k-col px-2 py-1.5" style={{ background: "var(--zona-tn-honda)", color: "var(--tinta)" }}>
          Tiendanube
        </span>
      </div>
      <div className="grid items-center border border-transparent" style={{ gridTemplateColumns: COLUMNAS_TN }}>
        <span />
        {col("Perfume", "transparent", "text-left")}
        {col("Costo", "var(--zona-directa)")}
        {col("Gan. directa", "var(--zona-directa)")}
        {col("Precio", "var(--zona-tn)")}
        {col("Margen", "var(--zona-tn)")}
        {col("Ganancia", "var(--zona-tn)")}
        {col("En Tiendanube", "var(--zona-tn)")}
      </div>
    </div>
  );
}

const colorGanancia = (g) => (g === null ? "var(--humo-claro)" : g >= 0 ? "var(--ambar)" : "var(--oxido)");

function FilaTN({ perfume, ajustes, onCambiar, onSoltarMargenTN, onFijarObjetivoTN, conexion, cuponesTienda, productosTN }) {
  const r = analisisDePrecio({
    costo: perfume.costo,
    precioPublico: perfume.precioPublico,
    perfume,
    envioLocal: ajustes.envioLocal,
    planes: [],
  });
  const sinCosto = !(Number(perfume.costo) > 0);

  const [detalleTN, setDetalleTN] = useState(false);
  const cerrarDetalleTN = useCallback(() => setDetalleTN(false), []);
  const precioTN = Number(perfume.precioTN) || 0;
  const objetivo = objetivoTN(perfume);
  const tnClavado = objetivo !== null;
  const porGanancia = objetivo?.ganancia != null;
  /* Los tres objetivos se excluyen, y el margen pedido existe solo en uno: con
     ganancia fija o igualando a la venta directa, la celda Margen muestra el que
     RESULTA, sin la marca de clavado. */
  const porMargen = objetivo?.margen != null;
  const igualandoTN = objetivo?.igualarDirecto === true;
  const envioTN = Number(ajustes.tiendaNube?.envioGratis) || 0;
  const tn = analisisTiendaNube({
    costo: perfume.costo,
    precio: precioTN,
    ajustesTN: ajustes.tiendaNube,
    formaId: objetivo?.formaId,
  });
  // Margen y ganancia de la forma que manda: la fijada, o la que menos deja.
  const formaManda = tn.manda >= 0 ? tn.formas[tn.manda].forma.nombre : null;
  const otraDejaMenos = tn.manda >= 0 && tn.define >= 0 && tn.manda !== tn.define;
  const fijarMargen = (v) =>
    onFijarObjetivoTN ? onFijarObjetivoTN([perfume.id], { margen: v / 100 }) : onCambiar(perfume.id, { margenTN: v / 100 });
  // A cuánto publicar para que la forma más cara deje lo mismo que la venta directa.
  const sugeridoTN =
    r.directo.ganancia === null
      ? null
      : precioTiendaNubeDesdeMargen({
          costo: perfume.costo,
          margen: r.directo.ganancia / Number(perfume.costo),
          ajustesTN: ajustes.tiendaNube,
        })?.precio ?? null;

  const cifra = (contenido, { fondo, color, titulo, fuerte }) => (
    <div className="px-2 text-right" style={{ background: fondo }} title={titulo}>
      <span className={`k-num text-[13px] ${fuerte ? "font-semibold" : ""}`} style={{ color: color ?? "var(--humo)" }}>
        {contenido}
      </span>
    </div>
  );

  return (
    <li
      className="group grid items-center overflow-hidden rounded-[4px] border py-1.5"
      style={{ gridTemplateColumns: COLUMNAS_TN, borderColor: "var(--linea)", background: "var(--papel)" }}
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
            {perfume.foto && <img src={urlFoto(perfume.foto)} alt={`Foto de ${perfume.nombre}`} className="h-full w-full object-cover" />}
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
            : `Vendiendo directo a ${pesos(perfume.precioPublico)}. Es la ganancia que iguala el "=".`,
      })}

      {/* ---- Un solo precio para todas las formas de pago ----
           El mismo par precio + margen. El margen que se muestra es el de la
           forma de pago que MENOS deja: con las demás se gana igual o más. Clic
           en el precio (o en el icono, si está a mano) abre el detalle. */}
      <div className="flex items-center gap-1 px-1.5" style={{ background: "var(--zona-tn)" }}>
        {tnClavado ? (
          <button
            type="button"
            onClick={() => setDetalleTN(true)}
            title={
              igualandoTN
                ? `Calculado para que "${formaManda ?? "esa forma"}" pague lo mismo que la venta directa. Clic para ver el detalle por forma de pago`
                : "Ver el detalle por forma de pago"
            }
            className="flex-1 rounded-[3px] px-0.5 py-1.5 text-right transition hover:bg-[var(--zona-tn-honda)]"
          >
            <span className="k-num text-[13px] font-semibold" style={{ color: "var(--tinta)" }}>
              {precioTN > 0 ? pesos(precioTN) : "—"}
            </span>
          </button>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <NumberCell value={precioTN || 0} onChange={(v) => onCambiar(perfume.id, { precioTN: v })} />
            </div>
            <div className="flex shrink-0 flex-col opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
              {sugeridoTN !== null && sugeridoTN !== precioTN && (
                <button
                  onClick={() => onCambiar(perfume.id, { precioTN: sugeridoTN })}
                  title={`Poner ${pesos(sugeridoTN)}: con ese precio en Tiendanube te queda al menos lo mismo que vendiendo directo, pague como pague`}
                  aria-label={`Igualar el precio de Tiendanube de ${perfume.nombre} a la ganancia directa`}
                  className="k-num px-0.5 text-[13px] leading-none"
                  style={{ color: "var(--humo)" }}
                >
                  =
                </button>
              )}
              {precioTN > 0 && (
                <button
                  onClick={() => setDetalleTN(true)}
                  title="Ver el detalle por forma de pago"
                  aria-label={`Detalle de Tiendanube de ${perfume.nombre}`}
                  className="px-0.5"
                  style={{ color: "var(--humo)" }}
                >
                  <ListTree size={12} />
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <div
        className="relative px-1.5"
        style={{ background: "var(--zona-tn)" }}
        title={
          !tnClavado
            ? undefined
            : (igualandoTN
                ? `El precio iguala lo que paga "${formaManda ?? "esa forma"}" a la venta directa (${pesos(
                    perfume.precioPublico
                  )}): el margen es el que queda.`
                : porGanancia
                  ? `Ganancia fija de ${pesos(objetivo.ganancia)}: el margen sale de ahí.`
                  : margenReal(objetivo.margen, tn.margenManda)) +
              (formaManda && !igualandoTN ? ` Medido contra "${formaManda}".` : "")
        }
      >
        {sinCosto ? (
          <div className="px-0.5 text-right" title="Cargá el costo para poder fijar un margen">
            <span className="k-num text-[13px]" style={{ color: "var(--humo-claro)" }}>
              —
            </span>
          </div>
        ) : (
          <NumberCell
            value={+((porMargen ? objetivo.margen : tnClavado ? tn.margenManda ?? 0 : tn.margen ?? 0) * 100).toFixed(1)}
            onChange={fijarMargen}
            suffix="%"
            className={porMargen ? "font-semibold" : ""}
            style={porMargen ? { borderLeft: "3px solid var(--ambar)", background: "#FFFDF7" } : undefined}
          />
        )}
        {tnClavado && (
          <button
            type="button"
            onClick={() => onSoltarMargenTN(perfume.id, precioTN)}
            title={
              igualandoTN
                ? "Dejar de igualar la venta directa y volver a poner el precio a mano"
                : "Soltar el margen y volver a poner el precio a mano"
            }
            aria-label={`Soltar el objetivo de Tiendanube de ${perfume.nombre}`}
            className="absolute -right-0.5 -top-1.5 rounded-full bg-white p-0.5 transition"
            style={{ color: "var(--humo)", boxShadow: "0 0 0 1px var(--linea)" }}
          >
            <X size={10} />
          </button>
        )}
      </div>
      {/* La ganancia de la forma que manda. Con ganancia fija lleva la marca de
          "clavado" (es el número que se pidió) y, si se mide contra una forma
          que no es la que menos deja, un "!" avisa que con otra se gana menos. */}
      <div className="px-1.5" style={{ background: "var(--zona-tn)" }}>
        <div
          className="flex items-center justify-end gap-1 rounded-[3px] px-1.5 py-1"
          style={porGanancia ? { borderLeft: "3px solid var(--ambar)", background: "#FFFDF7" } : undefined}
          title={
            tn.gananciaManda === null
              ? "Poné costo y precio para ver qué te deja en Tiendanube"
              : (porGanancia ? `Pediste ${pesos(objetivo.ganancia)} · queda ${pesos(tn.gananciaManda)}. ` : "") +
                (otraDejaMenos
                  ? `Con "${formaManda}" (la que fijaste) te quedan ${pesos(tn.gananciaManda)}; con "${
                      tn.formas[tn.define].forma.nombre
                    }" te queda menos, ${pesos(tn.ganancia)}.`
                  : `Con la forma de pago que más te cobra ("${tn.formas[tn.define].forma.nombre}") te quedan ${pesos(
                      tn.ganancia
                    )}, ya descontado el costo${envioTN > 0 ? " y el envío gratis" : ""}. Con las demás, igual o más.`)
          }
        >
          {otraDejaMenos && (
            <span className="k-num text-[12px] font-semibold" style={{ color: "var(--oxido)" }}>
              !
            </span>
          )}
          <span className="k-num text-[13px] font-semibold" style={{ color: colorGanancia(tn.gananciaManda) }}>
            {tn.gananciaManda === null ? "—" : pesos(tn.gananciaManda)}
          </span>
        </div>
      </div>

      <CeldaTN perfume={perfume} {...conexion} />

      {detalleTN && (
        <DetalleTiendaNube
          perfume={perfume}
          precio={precioTN}
          tn={ajustes.tiendaNube}
          onCerrar={cerrarDetalleTN}
          onFijar={onFijarObjetivoTN ? (o) => onFijarObjetivoTN([perfume.id], o) : undefined}
          onSoltar={() => onSoltarMargenTN(perfume.id, precioTN)}
          cuponesTienda={cuponesTienda}
          productosTN={productosTN}
        />
      )}
    </li>
  );
}
