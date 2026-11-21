import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListTree, Search, X } from "lucide-react";
import { urlFoto } from "./almacenamiento";
import { analisisDePrecio, analisisTiendaNube, objetivoTN, ofertaDeTN, precioTiendaNubeDesdeMargen } from "./precios";
import { AjustesTiendaNube, DetalleTiendaNube } from "./TiendaNube";
import { NumberCell } from "./NumberCell";
import { buscarPerfumes, ConVistaPrevia, margenReal, pesos } from "./Catalogo";
import { ordenar, siguienteOrden } from "./orden";
import { ColumnaOrdenable } from "./ColumnaOrdenable";
import { ALTO_TABLA, anchoDeColumnas } from "./tabla";
import { actualizarVarianteTN, cambiosParaTN, crearVarianteTN, enviarCodigoTN, estadoTN, leerCategoriasTN, leerCuponesTN, leerProductosTN, pedirAutorizacionTN, vinculoTN } from "./clienteTN";
import { ajustesTNDeDecants, decantsComoVendibles, nombreDeTipo, tiposDeDecant } from "./cuentasDecant";
import { BandaConexionTN, CeldaTN, PanelActualizarTN } from "./ConexionTN";
import CuponesTN from "./CuponesTN";
import AplicarATodos from "./AplicarATodos";
import EnvioGratisTN from "./EnvioGratisTN";
import SimuladorCarrito from "./SimuladorCarrito";
import { zonaEnvioTN } from "./umbralEnvioTN";

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

   Ofertas reales (`ofertaTN`): un % sobre `precioTN` que se pone y se saca en
   el detalle del precio. El par precio/margen sigue midiendo el precio normal;
   la fila muestra aparte el de oferta y lo que deja.
   ============================================================ */

// foto · nombre · costo · ganancia directa ‖ precio · margen · ganancia · en Tiendanube
const COLUMNAS_TN = "52px minmax(200px,1fr) 100px 100px 124px 88px 100px 132px";

/* Frascos o decants: nunca mezclados en la tabla (pedido de Franco, más
   práctico). Se recuerda entre visitas; es una preferencia de pantalla. */
const CLAVE_MODO = "kukune:modo-tn";
const leerModo = () => {
  try {
    return localStorage.getItem(CLAVE_MODO) === "decants" ? "decants" : "frascos";
  } catch {
    return "frascos";
  }
};

export default function PestanaTiendaNube({ perfumes: frascos, ajustes: ajustesTodos, onAjustes, onCambiar, onSoltarMargenTN, onFijarObjetivoTN, onStockBase, onConfirmar }) {
  const [modo, setModoEstado] = useState(leerModo);
  const setModo = (m) => {
    setModoEstado(m);
    try {
      localStorage.setItem(CLAVE_MODO, m);
    } catch {
      /* sin almacenamiento: el modo dura lo que la pantalla */
    }
  };
  const [tipoFiltro, setTipoFiltro] = useState("");
  const enDecants = modo === "decants";

  /* Los decants como si fueran perfumes (`decantsComoVendibles`): así la fila,
     el detalle, Aplicar a todos y Actualizar precios sirven igual. Las
     escrituras llevan su id compuesto y App las enruta a la entrada del decant. */
  const decants = useMemo(() => decantsComoVendibles(frascos, ajustesTodos), [frascos, ajustesTodos]);
  const tipos = tiposDeDecant(ajustesTodos);
  // Lo que mira la tienda entera (cupones, envío gratis, vínculos) va con los dos.
  const todos = useMemo(() => [...frascos, ...decants], [frascos, decants]);
  // Los de la tabla: los del modo.
  const perfumes = useMemo(
    () => (enDecants ? (tipoFiltro ? decants.filter((d) => d.tipo.id === tipoFiltro) : decants) : frascos),
    [enDecants, decants, frascos, tipoFiltro]
  );
  /* Los decants redondean con el suyo: todo lo que cuenta en la tabla usa los
     ajustes del modo. La caja de ajustes, en modo Decants, guarda el redondeo
     en `ajustes.decants.redondeoTN` y el resto en la tienda. */
  const ajustes = useMemo(
    () => (enDecants ? { ...ajustesTodos, tiendaNube: ajustesTNDeDecants(ajustesTodos) } : ajustesTodos),
    [enDecants, ajustesTodos]
  );
  const cambiarAjustesTN = (tn) => {
    if (!enDecants) return onAjustes({ tiendaNube: tn });
    const { redondeo, ...resto } = tn;
    onAjustes({
      tiendaNube: { ...resto, redondeo: ajustesTodos.tiendaNube?.redondeo },
      decants: { ...(ajustesTodos.decants ?? {}), redondeoTN: redondeo },
    });
  };

  const [consulta, setConsulta] = useState("");
  const [soloEnvioGratis, setSoloEnvioGratis] = useState(false);
  const [soloOferta, setSoloOferta] = useState(false);
  const [categorias, setCategorias] = useState(null); // las de la tienda, solo lectura
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

  // Solo lectura: para elegir cuál es la categoría de ofertas y nombrarla.
  const traerCategorias = useCallback(async () => {
    try {
      setCategorias(await leerCategoriasTN());
    } catch {
      setCategorias(null);
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
          traerCategorias();
        }
      })
      .catch((e) => vigente && setCuenta({ conectado: false, error: e.message }));
    return () => {
      vigente = false;
    };
  }, [traerProductos, traerCupones, traerCategorias]);

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
            traerCategorias();
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
    for (const p of todos) {
      const v = vinculoTN(p);
      if (v) m.set(String(v.variantId), p.nombre);
    }
    return m;
  }, [todos]);
  // Los del modo: Actualizar precios trabaja sobre ellos.
  const vinculados = perfumes.filter((p) => vinculoTN(p)).length;

  /* Publicar un decant como variante del producto del frasco. Escribe en la
     tienda real: con confirmación, diciendo producto, tamaño, precio y stock. */
  const publicarVariante = (decant, stock) => {
    const frasco = vinculoTN(decant.decantDe);
    const producto = (productos ?? []).find((x) => String(x.id) === String(frasco?.productId));
    const valor = nombreDeTipo(decant.tipo);
    const precio = Number(decant.precioTN) || 0;
    if (!frasco || !(precio > 0)) {
      setErrorTN(!frasco ? "Primero vinculá el frasco." : `"${decant.nombre}" no tiene precio de Tiendanube todavía.`);
      return;
    }
    onConfirmar({
      titulo: "Publicar el decant en Tiendanube",
      texto: `Se agrega la variante "${valor}" al producto "${producto?.nombre ?? frasco.productId}", a ${pesos(precio)}${
        stock == null ? ", sin llevar la cuenta de stock" : `, con ${stock} de stock`
      }. Es la tienda real: la variante queda visible. La publicación del frasco no se toca. Si ya hay una variante "${valor}", se vincula esa y no se crea otra.`,
      etiquetaOk: "Publicar",
      onAceptar: async () => {
        try {
          const r = await crearVarianteTN(frasco.productId, { valor, precio, stock });
          onCambiar(decant.id, { publicacionTN: { productId: frasco.productId, variantId: r.variante.id } });
          if (r.yaExistia) setErrorTN(`Ya había una variante "${valor}" en ese producto: quedó vinculada. Revisá su precio con Actualizar precios.`);
          traerProductos();
        } catch (e) {
          setErrorTN(`No se pudo publicar el decant (${e.message}).`);
        }
      },
    });
  };

  // Lo único que esta pantalla agrega a perfumes.json, y solo cuando se elige.
  const vincular = (perfume, vinculo) => onCambiar(perfume.id, { publicacionTN: vinculo ?? undefined });

  const abrirActualizar = async () => {
    // Se releen antes de comparar: el precio en la tienda pudo cambiar.
    const lista = await traerProductos();
    if (lista) setPanel(cambiosParaTN(perfumes, lista, ajustes.tiendaNube ?? {}));
  };

  /* El stock que le asignás a Tiendanube sale del stock base del catálogo (lo que
     tenías sin publicar). `variante.stock` es lo que la tienda tiene ahora mismo,
     así que el delta es correcto aunque haya vendido en el medio. La base se mueve
     DESPUÉS de que Tiendanube acepta: si el PUT falla, no se toca nada.

     Con `stock: null` la variante tiene la gestión de stock apagada (infinito): no
     hay delta posible y la base no se toca. */
  const cambiarStock = (perfume, variante, stock) => {
    const infinito = variante.stock == null;
    const delta = infinito ? 0 : Number(stock) - Number(variante.stock);
    onConfirmar({
      titulo: "Cambiar el stock en Tiendanube",
      texto:
        `"${variante.productoNombre}"${variante.valores ? ` (${variante.valores})` : ""}: de ${
          infinito ? "infinito" : variante.stock
        } a ${stock} unidades. Se cambia en la tienda real.` +
        // Un decant no tiene stock base en el catálogo: no hay nada que mover.
        (perfume.decantDe
          ? ""
          : delta !== 0
          ? ` En el catálogo, el stock sin publicar de "${perfume.nombre}" ${delta > 0 ? "baja" : "sube"} ${Math.abs(delta)}.`
          : infinito
            ? " Venía sin llevar la cuenta, así que el stock sin publicar del catálogo no cambia: ajustalo a mano."
            : ""),
      etiquetaOk: "Cambiar stock",
      onAceptar: async () => {
        try {
          await actualizarVarianteTN(vinculoTN(perfume).productId, variante.id, { stock });
          traerProductos();
          if (delta !== 0 && !perfume.decantDe) onStockBase?.(perfume.id, variante.stock, stock);
        } catch (e) {
          setErrorTN(`No se pudo cambiar el stock (${e.message}).`);
        }
      },
    });
  };

  /* Orden alfabético congelado por conjunto, como en el catálogo y en ML: acá se
     escriben precios y la lista no debe moverse por eso. */
  const [orden, setOrden] = useState({ col: "nombre", dir: "asc" });
  const onOrdenar = useCallback((col) => setOrden((o) => siguienteOrden(o, col)), []);
  const alfabetico = useRef({ clave: null, dir: null, ids: [] });
  const visibles = useMemo(() => {
    const filtrados = buscarPerfumes(perfumes, consulta);

    if (orden.col !== "nombre") {
      /* Margen y ganancia son los de la forma que MANDA (la fijada, o la que
         menos deja), que es exactamente lo que muestra la fila. */
      const deTN = (p) => {
        if (!(Number(p.costo) > 0) || !(Number(p.precioTN) > 0)) return null;
        return analisisTiendaNube({
          costo: p.costo,
          precio: Number(p.precioTN),
          ajustesTN: ajustes.tiendaNube,
          formaId: objetivoTN(p)?.formaId,
        });
      };
      const valorDe = {
        costo: (p) => (Number(p.costo) > 0 ? Number(p.costo) : null),
        gananciaDirecta: (p) =>
          Number(p.costo) > 0 && Number(p.precioPublico) > 0 ? p.precioPublico - p.costo : null,
        precio: (p) => (Number(p.precioTN) > 0 ? Number(p.precioTN) : null),
        margen: (p) => deTN(p)?.margenManda ?? null,
        ganancia: (p) => deTN(p)?.gananciaManda ?? null,
      }[orden.col];
      if (valorDe) return ordenar(filtrados, valorDe, orden.dir);
    }

    const porId = new Map(filtrados.map((p) => [p.id, p]));
    const clave = filtrados
      .map((p) => p.id)
      .sort()
      .join(",");
    if (alfabetico.current.clave !== clave || alfabetico.current.dir !== orden.dir) {
      alfabetico.current = {
        clave,
        dir: orden.dir,
        ids: ordenar(filtrados, (p) => p.nombre, orden.dir).map((p) => p.id),
      };
    }
    return alfabetico.current.ids.map((id) => porId.get(id)).filter(Boolean);
  }, [perfumes, consulta, orden, ajustes.tiendaNube]);

  /* Los que alcanzan el monto del envío gratis VENDIDOS SOLOS: ahí el envío lo
     paga el negocio. Sale del catálogo entero, no de los visibles, para que el
     contador diga cuántos hay y no cuántos quedaron después de buscar. */
  const conEnvioGratis = useMemo(() => {
    const tnAjustes = ajustes.tiendaNube ?? {};
    const m = new Map();
    for (const p of perfumes) {
      const z = zonaEnvioTN(p, tnAjustes);
      if (z) m.set(p.id, z);
    }
    return m;
  }, [perfumes, ajustes.tiendaNube]);
  // Los que están en oferta en la app (se manden o no a la tienda), del catálogo entero.
  const enOferta = useMemo(
    () => new Set(perfumes.filter((p) => ofertaDeTN(p, ajustes.tiendaNube ?? {}) != null).map((p) => p.id)),
    [perfumes, ajustes.tiendaNube]
  );
  const alaVista = visibles.filter((p) => (!soloEnvioGratis || conEnvioGratis.has(p.id)) && (!soloOferta || enOferta.has(p.id)));
  const categoriaOfertas = ajustes.tiendaNube?.categoriaOfertas ?? null;
  const nombreCategoriaOfertas =
    categoriaOfertas == null ? null : categorias?.find((c) => String(c.id) === String(categoriaOfertas))?.nombre ?? "la categoría de ofertas";

  return (
    <section className="mx-auto max-w-[1480px] px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="k-rotulo mb-1">Tiendanube</h2>
          <p className="text-[12.5px]" style={{ color: "var(--humo)" }}>
            {enDecants
              ? "Los decants, cada uno con su precio. Van como variante del producto del frasco. El tipo, el costo y la venta directa se arman en la pestaña Decants."
              : "Un solo precio que deja la ganancia pague como pague el cliente. El nombre, la foto y el costo se cargan en el catálogo."}
          </p>
        </div>
        {/* Molde del Precios | Ventas de ML. Nunca se mezclan en la tabla. */}
        <div className="flex overflow-hidden rounded-[3px] border" style={{ borderColor: "var(--linea)" }} role="tablist">
          {[
            ["frascos", `Frascos (${frascos.length})`],
            ["decants", `Decants (${decants.length})`],
          ].map(([id, texto]) => (
            <button
              key={id}
              role="tab"
              aria-selected={modo === id}
              onClick={() => setModo(id)}
              className="k-col px-3 py-[7px] transition"
              style={{ background: modo === id ? "var(--tinta)" : "var(--papel)", color: modo === id ? "#fff" : "var(--humo)" }}
            >
              {texto}
            </button>
          ))}
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
        {enDecants && tipos.length > 1 && (
          <select
            value={tipoFiltro}
            onChange={(e) => setTipoFiltro(e.target.value)}
            className="k-col rounded-[3px] border px-2 py-[7px]"
            style={{ background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" }}
            aria-label="Filtrar por tipo de decant"
          >
            <option value="">Todos los tamaños</option>
            {tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {nombreDeTipo(t)}
              </option>
            ))}
          </select>
        )}
        {/* Los que alcanzan el monto vendidos solos: ahí el envío lo pagás vos.
            Mismo molde que "N sin foto" y "N fuera de banda" del catálogo, con
            su misma regla: no desaparece mientras el filtro esté puesto aunque
            el contador llegue a cero, porque si no el filtro queda activo sin
            forma de apagarlo. Óxido y no ámbar: es un "esto te está costando",
            el ámbar sigue siendo sólo la ganancia. */}
        {Number(ajustes.tiendaNube?.envioGratisDesde) > 0 && (conEnvioGratis.size > 0 || soloEnvioGratis) && (
          <button
            onClick={() => setSoloEnvioGratis((v) => !v)}
            aria-pressed={soloEnvioGratis}
            title={`Vendidos solos llegan a ${pesos(
              Number(ajustes.tiendaNube.envioGratisDesde)
            )}, así que el envío gratis lo pagás vos: son los que conviene revisar de precio.`}
            className="k-col rounded-[3px] border px-3 py-[7px] transition"
            style={{
              borderColor: soloEnvioGratis ? "var(--oxido)" : "var(--linea)",
              color: soloEnvioGratis ? "var(--oxido)" : "var(--humo)",
              background: soloEnvioGratis ? "#FDF6F4" : "transparent",
            }}
          >
            {soloEnvioGratis && conEnvioGratis.size === 0 ? "Ver todos" : `${conEnvioGratis.size} con envío gratis`}
          </button>
        )}
        {/* Los que están en oferta. Misma regla que los otros filtros: no
            desaparece con el filtro puesto. Humo: no es un problema, es un estado. */}
        {(enOferta.size > 0 || soloOferta) && (
          <button
            onClick={() => setSoloOferta((v) => !v)}
            aria-pressed={soloOferta}
            title="Los que tienen una oferta puesta en la app. Se mandan a la tienda con Actualizar precios en Tiendanube."
            className="k-col rounded-[3px] border px-3 py-[7px] transition"
            style={{
              borderColor: soloOferta ? "var(--tinta)" : "var(--linea)",
              color: soloOferta ? "var(--tinta)" : "var(--humo)",
              background: soloOferta ? "var(--zona-tn)" : "transparent",
            }}
          >
            {soloOferta && enOferta.size === 0 ? "Ver todos" : `${enOferta.size} en oferta`}
          </button>
        )}
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
        <PanelActualizarTN
          {...panel}
          ajustesTN={ajustes.tiendaNube}
          nombreCategoria={nombreCategoriaOfertas}
          onCerrar={() => setPanel(null)}
          onTerminado={traerProductos}
        />
      )}

      {cuenta?.conectado && (
        <CuponesTN
          cupones={cupones}
          error={errorCupones}
          cargando={leyendoCupones}
          perfumes={todos}
          ajustesTN={ajustesTodos.tiendaNube}
          productos={productos ?? []}
          onRecargar={traerCupones}
          onConfirmar={onConfirmar}
          onReconectar={conectar}
        />
      )}

      <div className="mb-5">
        <AjustesTiendaNube
          tn={ajustes.tiendaNube}
          onCambiar={cambiarAjustesTN}
          onConfirmar={onConfirmar}
          categorias={cuenta?.conectado ? categorias : null}
        />
      </div>

      {/* El catálogo entero, no `visibles`: el envío lo paga todo lo que se
          vende, no los resultados de la búsqueda. */}
      <EnvioGratisTN
        perfumes={todos}
        tn={ajustesTodos.tiendaNube}
        maxUnidades={decants.length ? 3 : 4}
        onCambiar={(envioGratisDesde) => onAjustes({ tiendaNube: { ...ajustesTodos.tiendaNube, envioGratisDesde } })}
      />

      {/* También la tienda entera: un carrito mezcla frascos y decants. */}
      <SimuladorCarrito perfumes={todos} tn={ajustesTodos.tiendaNube} cuponesTienda={cupones ?? []} productosTN={productos ?? []} />

      <AplicarATodos
        perfumes={alaVista}
        filtrado={!!consulta.trim() || soloEnvioGratis || soloOferta}
        formas={ajustes.tiendaNube?.formas ?? []}
        onFijar={onFijarObjetivoTN}
        onConfirmar={onConfirmar}
        esAMano={(p) => objetivoTN(p) === null}
        zona="var(--zona-tn)"
        avisoFinal={'No se manda nada a Tiendanube: después usá "Actualizar precios en Tiendanube".'}
      />

      {alaVista.length === 0 ? (
        <p className="py-12 text-center text-[13px]" style={{ color: "var(--humo-claro)" }}>
          {perfumes.length === 0
            ? enDecants
              ? "No hay decants asignados. Se arman en la pestaña Decants."
              : "El catálogo está vacío. Los perfumes se agregan en la pestaña Catálogo."
            : soloOferta && enOferta.size === 0
              ? "No queda ninguno en oferta."
              : soloEnvioGratis
                ? "Ninguno de los que se ven llega al monto del envío gratis vendido solo."
                : "Ningún perfume coincide con la búsqueda."}
        </p>
      ) : (
        <div className="overflow-auto pb-2" style={{ maxHeight: ALTO_TABLA }}>
          <div style={{ minWidth: anchoDeColumnas(COLUMNAS_TN) }}>
            <Encabezado orden={orden} onOrdenar={onOrdenar} />
            <ul className="grid gap-1.5">
              {alaVista.map((p) => (
                <FilaTN
                  key={p.id}
                  perfume={p}
                  ajustes={ajustes}
                  onCambiar={onCambiar}
                  onSoltarMargenTN={onSoltarMargenTN}
                  onFijarObjetivoTN={onFijarObjetivoTN}
                  conexion={{ conectado: !!cuenta?.conectado, productos, porVariante, usadas, onVincular: vincular, onStock: cambiarStock, onPublicarVariante: publicarVariante, ajustesTN: ajustes.tiendaNube ?? {} }}
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
function Encabezado({ orden, onOrdenar }) {
  const col = (texto, fondo, clave, alineado = "text-right") => (
    <ColumnaOrdenable
      texto={texto}
      clave={clave}
      orden={orden}
      onOrdenar={onOrdenar}
      fondo={fondo}
      alineado={alineado}
    />
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
        {col("Perfume", "transparent", "nombre", "text-left")}
        {col("Costo", "var(--zona-directa)", "costo")}
        {col("Gan. directa", "var(--zona-directa)", "gananciaDirecta")}
        {col("Precio", "var(--zona-tn)", "precio")}
        {col("Margen", "var(--zona-tn)", "margen")}
        {col("Ganancia", "var(--zona-tn)", "ganancia")}
        {/* "En Tiendanube" no ordena: es la celda del vínculo con la variante,
            no una cifra del negocio. */}
        {col("En Tiendanube", "var(--zona-tn)")}
      </div>
    </div>
  );
}

const colorGanancia = (g) => (g === null ? "var(--humo-claro)" : g >= 0 ? "var(--verde)" : "var(--oxido)");

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
  const tn = analisisTiendaNube({
    costo: perfume.costo,
    precio: precioTN,
    ajustesTN: ajustes.tiendaNube,
    formaId: objetivo?.formaId,
  });
  /* La oferta real, si hay: el cliente paga `precioOferta` y el tachado es
     `precioTN`. Se mide con la misma forma que manda, para comparar de igual a
     igual con la celda Ganancia (que sigue siendo la del precio normal). */
  const precioOferta = ofertaDeTN(perfume, ajustes.tiendaNube ?? {});
  const tnOferta =
    precioOferta == null
      ? null
      : analisisTiendaNube({ costo: perfume.costo, precio: precioOferta, ajustesTN: ajustes.tiendaNube, formaId: objetivo?.formaId });
  /* Lo que se le descontó a ESTE precio: con monto mínimo, un perfume que no
     llega al monto no paga envío porque lo paga el cliente. */
  const envioTN = tn.envioAplicado;
  /* Si vendido solo llega al monto del envío gratis, y si en esa posición está
     bien parado o le conviene bajar. `null` en la mayoría: no se marca. */
  const zonaEnvio = zonaEnvioTN(perfume, ajustes.tiendaNube ?? {});
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
      <div
        className="flex flex-col justify-center px-1.5"
        style={{ background: "var(--zona-tn)" }}
        title={
          zonaEnvio
            ? `Vendido solo llega a ${pesos(Number(ajustes.tiendaNube.envioGratisDesde))}, así que el envío gratis lo pagás vos y te quedan ${pesos(
                zonaEnvio.ganancia
              )}. A ${pesos(zonaEnvio.bajarA)} no llega y lo paga el cliente: te quedarían ${pesos(zonaEnvio.gananciaAbajo)}.${
                zonaEnvio.subirA
                  ? ` Para que el precio absorba el envío tendría que salir ${pesos(zonaEnvio.subirA)}.`
                  : " A este precio ya lo absorbe."
              }`
            : undefined
        }
      >
        <div className="flex items-center gap-1">
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
        {/* La marca. Óxido cuando cruzó el monto por poco: ahí paga el envío
            entero sin haber cobrado casi nada más por eso, y conviene BAJARLO
            justo debajo del monto —el envío pasa al cliente y queda más
            ganancia con el producto más barato—. Humo cuando el precio ya lo
            absorbe: no hay nada que hacer, es informativo. El número va escrito
            y no sólo en el `title`: es la acción. */}
        {precioOferta != null && (
          <button
            type="button"
            onClick={() => setDetalleTN(true)}
            title={`En oferta: en la tienda se ve ${pesos(precioTN)} tachado y paga ${pesos(precioOferta)}. Clic para cambiarla o sacarla.`}
            className="block w-full pb-0.5 text-right text-[10.5px] leading-tight"
            style={{ color: "var(--tinta)" }}
          >
            oferta −{Math.round(perfume.ofertaTN.descuento * 1000) / 10}% · <span className="k-num">{pesos(precioOferta)}</span>
          </button>
        )}
        {zonaEnvio && (
          <small
            className="block pb-0.5 text-right text-[10.5px] leading-tight"
            style={{ color: zonaEnvio.zona === "floja" ? "var(--oxido)" : "var(--humo)" }}
          >
            {zonaEnvio.zona === "floja" ? (
              <>
                envío gratis · bajá a <span className="k-num">{pesos(zonaEnvio.bajarA)}</span>
              </>
            ) : (
              "envío gratis"
            )}
          </small>
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
                    )}, ya descontado el costo${envioTN > 0 ? " y el envío gratis" : ""}. Con las demás, igual o más.${
                      tn.umbralEnvio > 0 && !tn.envioCalifica
                        ? ` A este precio el envío lo paga el cliente: es gratis desde ${pesos(tn.umbralEnvio)}.`
                        : ""
                    }`) +
                /* El retiro en mano no paga envío, así que deja esos pesos de
                   más. El número de la celda sigue siendo el conservador. */
                (() => {
                  // Retirando no hay envío: ni el que pagás vos ni la comisión sobre el del cliente.
                  const comEnvio = tn.manda >= 0 ? tn.formas[tn.manda].comisionEnvio || 0 : 0;
                  const sinEnvio = envioTN + comEnvio;
                  return (
                    (comEnvio > 0 ? ` Ya descuenta ${pesos(comEnvio)} de comisión sobre el envío que paga el cliente.` : "") +
                    (sinEnvio > 0 ? ` Si el cliente retira en Rosario no hay envío: te quedan ${pesos(tn.gananciaManda + sinEnvio)}.` : "")
                  );
                })()
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
        {/* Con oferta: lo que deja de verdad hoy, con la misma forma que manda. */}
        {tnOferta && tnOferta.gananciaManda !== null && (
          <small
            className="block px-1.5 pb-0.5 text-right text-[10.5px] leading-tight"
            style={{ color: colorGanancia(tnOferta.gananciaManda) }}
            title={`Con la oferta (paga ${pesos(precioOferta)}) te quedan ${pesos(tnOferta.gananciaManda)}${
              tn.gananciaManda !== null ? `, ${pesos(tn.gananciaManda - tnOferta.gananciaManda)} menos que a precio normal` : ""
            }.`}
          >
            en oferta <span className="k-num">{pesos(tnOferta.gananciaManda)}</span>
          </small>
        )}
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
          onOferta={(ofertaTN) => onCambiar(perfume.id, { ofertaTN })}
          cuponesTienda={cuponesTienda}
          productosTN={productosTN}
        />
      )}
    </li>
  );
}
