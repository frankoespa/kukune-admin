import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { urlFoto } from "./almacenamiento";
import { analisisDePrecio, margenesDePlanes, planesPublicables, preciosDePlanes } from "./precios";
import { SelectorRedondeo } from "./TiendaNube";
import { NumberCell } from "./NumberCell";
import { pctSinMiles as pctCorto } from "./numeros";
import { buscarPerfumes, ConVistaPrevia, margenReal, pesos } from "./Catalogo";
import { ordenar, siguienteOrden } from "./orden";
import { ColumnaOrdenable } from "./ColumnaOrdenable";
import { ALTO_TABLA, anchoDeColumnas } from "./tabla";
import {
  actualizarPublicacionML,
  cambiosParaML,
  enviarCodigoML,
  estadoML,
  leerPromocionesML,
  leerPublicacionesML,
  nombreDePlan,
  nombreDeTipoPromo,
  pedirAutorizacionML,
  ponerPromoML,
  promosPorPlan,
  quitarPromoML,
  CAMPO_DE_VINCULO,
  vinculosCatalogoDe,
  vinculosDe,
} from "./clienteML";
import { BandaConexion, CeldaPublicacion, PanelActualizar } from "./MLConexion";
import VentasML from "./VentasML";
import PromocionesML from "./PromocionesML";
import { CuerpoDescuento } from "./DescuentoML";
import PublicarML from "./PublicarML";
import ActualizarML from "./ActualizarML";

/* ============================================================
   Mercado Libre.

   Salió del catálogo porque ahí ya no entraba: una publicación por plan de pago
   son tres columnas por plan. Los datos NO se mudaron: `preciosML`,
   `margenesML` y `ajustes.cuotasML` siguen en `perfumes.json`, y esta pantalla
   recibe la misma lista resuelta que el catálogo. Nombre, foto y costo se
   editan en el catálogo; acá se ven como referencia.
   ============================================================ */

const PLANES_DE_CUOTAS = [3, 6, 9, 12];
const RELEER_TRAS_ACTUALIZAR = 10000;

/* Misma regla que el catálogo: una sola fuente para encabezado y filas, en línea
   porque la cantidad depende de los planes, y sin `gap` para que la franja de
   color del canal sea continua.

   Columnas: foto · nombre · costo · ganancia directa ‖
             (precio · margen · ganancia · en ML) por cada plan */
const columnasDeML = (planes) =>
  [
    "52px minmax(200px,1fr) 100px 100px",
    planes.map(() => "112px 88px 100px 104px").join(" "),
  ].join(" ");


export default function MercadoLibre({
  perfumes,
  ajustes,
  onAjustes,
  onCambiar,
  onSoltarMargenML,
  onStockBase,
  onConfirmar,
}) {
  const [consulta, setConsulta] = useState("");
  // Precios (lo de siempre) o Ventas (solo lectura). Es de pantalla: no se guarda.
  const [seccion, setSeccion] = useState("precios");
  const [cuenta, setCuenta] = useState(null); // null = preguntando
  const [publicaciones, setPublicaciones] = useState(null);
  /* Las promos que ML tiene puestas hoy, por publicación. `null` = sin leer.
     No se guardan en el catálogo: viven en ML y se leen en vivo, igual que el
     stock de los canales. */
  const [promos, setPromos] = useState(null);
  const [avisoPromos, setAvisoPromos] = useState("");
  const [soloPromo, setSoloPromo] = useState(false);
  // Se sube de a uno para volver a preguntarle las promos a ML después de tocar una.
  const [recargaPromos, setRecargaPromos] = useState(0);
  // Lo que salió bien, para avisarlo: una escritura sin respuesta parece que no pasó.
  const [exito, setExito] = useState("");
  const [errorML, setErrorML] = useState("");
  const [trayendo, setTrayendo] = useState(false);
  const [panel, setPanel] = useState(null); // { cambios, perdidos }
  // El perfume que se está publicando (id): el panel lee siempre la versión
  // resuelta y al día, así ve los vínculos que va agregando.
  const [publicandoId, setPublicandoId] = useState(null);
  const publicando = perfumes.find((p) => p.id === publicandoId) ?? null;
  const [actualizandoId, setActualizandoId] = useState(null);
  const actualizando = perfumes.find((p) => p.id === actualizandoId) ?? null;
  /* Un pago siempre, más los planes con comisión cargada: cada uno es una
     publicación distinta en ML y tiene su propio precio. */
  const planes = useMemo(() => planesPublicables(ajustes.cuotasML), [ajustes.cuotasML]);
  const columnas = columnasDeML(planes);

  /* Solo lectura: al entrar se pregunta si hay conexión y se traen las
     publicaciones. Nada de esto escribe ni en ML ni en el catálogo. */
  const traerPublicaciones = useCallback(async () => {
    setTrayendo(true);
    setErrorML("");
    try {
      const pubs = await leerPublicacionesML();
      setPublicaciones(pubs);
      return pubs;
    } catch (e) {
      setErrorML(`No se pudieron traer las publicaciones (${e.message}).`);
      return null;
    } finally {
      setTrayendo(false);
    }
  }, []);

  useEffect(() => {
    let vigente = true;
    estadoML()
      .then((c) => {
        if (!vigente) return;
        setCuenta(c);
        if (c.conectado) traerPublicaciones();
      })
      .catch((e) => vigente && setCuenta({ conectado: false, error: e.message }));
    return () => {
      vigente = false;
    };
  }, [traerPublicaciones]);

  /* Después de mandar precios se relee enseguida (la normal ya cambió) y otra vez
     a los RELEER_TRAS_ACTUALIZAR ms: ML pasa el precio a la de catálogo unos
     segundos después, y sin la segunda lectura quedaba "sincronizando" hasta
     tocar Releer. */
  const segundaLectura = useRef(null);
  useEffect(() => () => clearTimeout(segundaLectura.current), []);
  const releerTrasActualizar = () => {
    traerPublicaciones();
    clearTimeout(segundaLectura.current);
    segundaLectura.current = setTimeout(traerPublicaciones, RELEER_TRAS_ACTUALIZAR);
  };

  /* ML no acepta localhost como redirect: vuelve a kukune.com.ar con el código
     en la dirección, y Franco la pega acá. Es el mismo camino que el script de
     preguntas. */
  const conectar = async () => {
    setErrorML("");
    // La pestaña se abre YA, en el clic, y después se le pone la dirección: si
    // se abriera después del `await`, el navegador lo toma como popup y lo bloquea.
    const ventana = window.open("", "_blank");
    try {
      const { url } = await pedirAutorizacionML();
      if (ventana) {
        ventana.opener = null;
        ventana.location.href = url;
      } else {
        setErrorML(`El navegador no abrió la pestaña. Abrí esta dirección a mano: ${url}`);
      }
      onConfirmar({
        titulo: "Conectar Mercado Libre",
        texto:
          "Se abrió Mercado Libre en otra pestaña. Entrá con la cuenta de KUKUNE y autorizá la app. Te va a mandar a kukune.com.ar: copiá la dirección completa de la barra (la que tiene ?code=TG-…) y pegala acá.",
        conCampo: true,
        marcador: "https://kukune.com.ar/?code=TG-…",
        etiquetaOk: "Conectar",
        onAceptar: async (pegado) => {
          try {
            const c = await enviarCodigoML(pegado);
            setCuenta(c);
            traerPublicaciones();
          } catch (e) {
            setErrorML(`No se pudo conectar (${e.message}).`);
          }
        },
      });
    } catch (e) {
      ventana?.close();
      setErrorML(e.message);
    }
  };

  const pubPorId = useMemo(
    () => new Map((publicaciones ?? []).map((x) => [x.id, x])),
    [publicaciones]
  );

  /* Las promociones de las publicaciones vinculadas. La clave son los ids
     ordenados y no `perfumes`: así tipear un precio no vuelve a preguntarle a
     ML, y vincular o desvincular sí. En desarrollo se pide dos veces al entrar:
     es StrictMode, como en Ventas. */
  const idsVinculados = useMemo(
    () => [...new Set(perfumes.flatMap((p) => Object.values(vinculosDe(p))))].sort().join(","),
    [perfumes]
  );
  useEffect(() => {
    if (!cuenta?.conectado || !idsVinculados) return undefined;
    let vigente = true;
    leerPromocionesML(idsVinculados.split(","))
      .then((r) => {
        if (!vigente) return;
        setPromos(r.promos ?? {});
        setAvisoPromos(
          r.sinPermiso
            ? "La app no puede ver tus promociones: a la aplicación de Mercado Libre le falta el permiso. Tocá Volver a conectar para pedirlo. El resto de la pestaña funciona igual."
            : ""
        );
      })
      .catch((e) => vigente && setAvisoPromos(`No se pudieron traer las promociones (${e.message}).`));
    return () => {
      vigente = false;
    };
  }, [cuenta?.conectado, idsVinculados, recargaPromos]);

  /* La promo vigente de cada plan, por perfume. Sale del vínculo guardado. */
  const promosDePerfume = useMemo(() => {
    const m = new Map();
    for (const p of perfumes) m.set(p.id, promosPorPlan(p, promos));
    return m;
  }, [perfumes, promos]);

  const tienePromo = (p) => Object.keys(promosDePerfume.get(p.id) ?? {}).length > 0;
  const enPromo = useMemo(() => perfumes.filter(tienePromo).length, [perfumes, promosDePerfume]);

  /* A qué perfume y plan está vinculada cada publicación: el buscador lo marca
     para no vincular la misma dos veces sin darse cuenta. */
  const usadas = useMemo(() => {
    const m = new Map();
    for (const p of perfumes) {
      for (const [plan, id] of Object.entries(vinculosDe(p)))
        m.set(id, `${p.nombre} · ${nombreDePlan(plan)}`);
      for (const [plan, id] of Object.entries(vinculosCatalogoDe(p)))
        m.set(id, `${p.nombre} · ${nombreDePlan(plan)} · catálogo`);
    }
    return m;
  }, [perfumes]);

  // Solo las normales: son las que reciben precio.
  const vinculados = useMemo(
    () => perfumes.reduce((n, p) => n + Object.keys(vinculosDe(p)).length, 0),
    [perfumes]
  );

  /* Lo único que esta pantalla agrega a perfumes.json, y solo cuando se elige.
     `tipo`: "normal" (recibe precios) o "catalogo" (ML la sincroniza sola). */
  const vincular = (perfume, plan, itemId, tipo = "normal") => {
    const campo = CAMPO_DE_VINCULO[tipo];
    const resto = { ...(perfume[campo] ?? {}) };
    if (itemId) resto[plan] = itemId;
    else delete resto[plan];
    onCambiar(perfume.id, { [campo]: Object.keys(resto).length ? resto : undefined });
  };

  /* ML no aplica la promo en el mismo momento: la escritura vuelve con 200 y la
     publicación tarda unos segundos en mostrarla. Por eso se relee enseguida y
     otra vez a los RELEER_TRAS_ACTUALIZAR, igual que con el precio de la de
     catálogo. Sin la segunda lectura había que recargar la página para verla. */
  const segundaDePromos = useRef(null);
  useEffect(() => () => clearTimeout(segundaDePromos.current), []);
  const releerPromos = useCallback(() => {
    setRecargaPromos((n) => n + 1);
    clearTimeout(segundaDePromos.current);
    segundaDePromos.current = setTimeout(() => setRecargaPromos((n) => n + 1), RELEER_TRAS_ACTUALIZAR);
  }, []);

  /* Lo que salió bien se dice y se borra solo: el diálogo se cierra al aceptar y
     sin esto no queda ninguna señal de que la escritura funcionó. */
  const avisarExito = useCallback((texto) => {
    setExito(texto);
    setTimeout(() => setExito(""), 8000);
  }, []);

  /* El descuento propio: se arma en el cuerpo del `Dialogo` y se manda al
     aceptar. El ref es porque `onAceptar` solo devuelve un campo de texto, el
     mismo gesto que `atarAlPasar` en "pasar costos al catálogo". */
  const estadoDescuento = useRef(null);
  const abrirDescuento = (perfume) => {
    estadoDescuento.current = null;
    const puestas = promosDePerfume.get(perfume.id) ?? {};
    // Si algún plan ya tiene uno propio se ofrece quitarlo: ML no deja cambiarlo.
    const propia = Object.entries(puestas).find(([, p]) => p.tipo === "PRICE_DISCOUNT");
    onConfirmar({
      titulo: `Descuento propio de ${perfume.nombre}`,
      ancho: "max-w-2xl",
      texto: (
        <CuerpoDescuento
          perfume={perfume}
          planes={planes}
          pubPorId={pubPorId}
          promos={promos}
          ajustes={ajustes}
          estado={estadoDescuento}
        />
      ),
      etiquetaOk: "Poner el descuento",
      ...(propia
        ? {
            segunda: {
              etiqueta: `Quitar el de ${nombreDePlan(propia[0])}`,
              onAceptar: async () => {
                try {
                  await quitarPromoML(vinculosDe(perfume)[propia[0]], { tipo: "PRICE_DISCOUNT" });
                  releerPromos();
                  releerTrasActualizar();
                  avisarExito(
                    `Se quitó el descuento de ${perfume.nombre} · ${nombreDePlan(propia[0])}. ML lo saca de la publicación en unos segundos.`
                  );
                } catch (e) {
                  setErrorML(`No se pudo quitar el descuento (${e.message}).`);
                }
              },
            },
          }
        : {}),
      onAceptar: async () => {
        const d = estadoDescuento.current;
        if (!d) {
          setErrorML("El descuento no se mandó: revisá el precio y las fechas.");
          return;
        }
        try {
          const r = await ponerPromoML(d.itemId, d);
          releerPromos();
          releerTrasActualizar();
          avisarExito(
            `${r?.reemplazado ? "Descuento reemplazado" : "Descuento puesto"} en ${perfume.nombre} · ${nombreDePlan(
              d.plan
            )}: el comprador paga ${pesos(d.precio)}. ML lo muestra en la publicación en unos segundos.`
          );
        } catch (e) {
          setErrorML(`No se pudo poner el descuento (${e.message}).`);
          // Quitar el viejo puede haber salido bien: hay que releer igual.
          releerPromos();
        }
      },
    });
  };

  const abrirActualizar = async () => {
    // Se releen antes de comparar: el precio en ML pudo cambiar desde que
    // entraste a la pestaña.
    const pubs = await traerPublicaciones();
    if (!pubs) return;
    setPanel(cambiosParaML(perfumes, pubs, planes));
  };

  /* El stock que le asignás a ML sale del stock base del catálogo (lo que tenías
     sin publicar). `pub.stock` es lo que ML tiene ahora mismo —se releyó al abrir
     la pestaña o al tocar stock—, así que el delta es correcto aunque ML haya
     vendido en el medio. La base se mueve DESPUÉS de que ML acepta: si el PUT
     falla, no se toca nada. */
  const cambiarStock = (perfume, pub, stock) =>
    onConfirmar({
      titulo: "Cambiar el stock en Mercado Libre",
      texto:
        `"${pub.titulo}" (${pub.id}): de ${pub.stock} a ${stock} unidades. Se cambia en la publicación real.` +
        (stock !== pub.stock
          ? ` En el catálogo, el stock sin publicar de "${perfume.nombre}" ${
              stock > pub.stock ? "baja" : "sube"
            } ${Math.abs(stock - pub.stock)}.`
          : ""),
      etiquetaOk: "Cambiar stock",
      onAceptar: async () => {
        try {
          const r = await actualizarPublicacionML(pub.id, { available_quantity: stock });
          setPublicaciones((ps) => ps.map((x) => (x.id === pub.id ? r.publicacion : x)));
          onStockBase?.(perfume.id, pub.stock, stock);
        } catch (e) {
          setErrorML(`No se pudo cambiar el stock de ${pub.id} (${e.message}).`);
        }
      },
    });

  /* Orden alfabético congelado por conjunto, como en el catálogo. Acá no se
     escriben nombres, pero sí precios, y la lista no debe moverse por eso.
     Las demás columnas miran números y se recalculan en vivo; las de cada plan
     llevan el plan en la clave (`precio:6`), porque una publicación por plan
     es una columna por plan. */
  const [orden, setOrden] = useState({ col: "nombre", dir: "asc" });
  const onOrdenar = useCallback((col) => setOrden((o) => siguienteOrden(o, col)), []);
  const alfabetico = useRef({ clave: null, dir: null, ids: [] });
  const visibles = useMemo(() => {
    const filtrados = buscarPerfumes(perfumes, consulta).filter((p) => !soloPromo || tienePromo(p));

    if (orden.col !== "nombre") {
      const [campo, plan] = orden.col.split(":");
      // La misma cuenta que hace cada fila: una sola puerta, imposible de desfasar.
      const analisis = (p) =>
        analisisDePrecio({
          costo: p.costo,
          precioPublico: p.precioPublico,
          perfume: p,
          comisionML: ajustes.comisionML,
          envioML: ajustes.envioML,
          envioLocal: ajustes.envioLocal,
          cuotasML: ajustes.cuotasML,
          planes,
          redondeoML: ajustes.redondeoML,
          promosPorPlan: promosDePerfume.get(p.id) ?? {},
        });
      const delPlan = (p, campo) => {
        const e = analisis(p).ml.find((x) => String(x.plan) === plan);
        return e ? (e[campo] ?? null) : null;
      };
      const valorDe = {
        costo: (p) => (Number(p.costo) > 0 ? Number(p.costo) : null),
        gananciaDirecta: (p) => analisis(p).directo.ganancia,
        precio: (p) => delPlan(p, "precio"),
        margen: (p) => delPlan(p, "margen"),
        ganancia: (p) => delPlan(p, "ganancia"),
      }[campo];
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
  }, [perfumes, consulta, soloPromo, promosDePerfume, orden, ajustes, planes]);

  return (
    <section className="mx-auto max-w-[1480px] px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="k-rotulo mb-1">Mercado Libre</h2>
          <p className="text-[12.5px]" style={{ color: "var(--humo)" }}>
            {seccion === "precios"
              ? "Un precio por plan de pago: cada plan es una publicación aparte. El nombre, la foto y el costo se cargan en el catálogo."
              : seccion === "ventas"
              ? "Lo vendido en Mercado Libre y lo que dejó, con la comisión y el envío que cobró ML y el costo de cada perfume cuando se vendió. Solo lectura."
              : "Las campañas a las que ML te invita y qué te deja cada perfume si entra, antes de aceptar nada. Solo lectura."}
          </p>
        </div>
        <div className="flex overflow-hidden rounded-[3px] border" style={{ borderColor: "var(--linea)" }}>
          {[
            ["precios", "Precios"],
            ["ventas", "Ventas"],
            ["promociones", "Promociones"],
          ].map(([id, texto]) => (
            <button
              key={id}
              onClick={() => setSeccion(id)}
              aria-pressed={seccion === id}
              className="k-col px-3 py-[7px] transition"
              style={
                seccion === id
                  ? { background: "var(--tinta)", color: "var(--papel)" }
                  : { background: "var(--papel)", color: "var(--humo)" }
              }
            >
              {texto}
            </button>
          ))}
        </div>
      </div>

      {seccion === "precios" && (
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
          {/* Los que ML tiene en promoción ahora mismo. Misma regla que los
              filtros del catálogo: no desaparece mientras el filtro esté puesto,
              porque si no quedaría activo sin forma de apagarlo. En humo y no en
              óxido: tener una promo no es un error. */}
          {(enPromo > 0 || soloPromo) && (
            <button
              onClick={() => setSoloPromo((v) => !v)}
              aria-pressed={soloPromo}
              title="Publicaciones con una promoción corriendo en Mercado Libre. La ganancia que deja la promo se ve debajo de la ganancia de cada plan."
              className="k-col rounded-[3px] border px-3 py-[7px] transition"
              style={{
                borderColor: soloPromo ? "var(--tinta)" : "var(--linea)",
                color: soloPromo ? "var(--tinta)" : "var(--humo)",
                background: soloPromo ? "var(--vidrio-hondo)" : "transparent",
              }}
            >
              {soloPromo && enPromo === 0 ? "Ver todos" : `${enPromo} en promo`}
            </button>
          )}
        </div>
      )}

      <BandaConexion
        cuenta={cuenta}
        publicaciones={publicaciones}
        vinculados={vinculados}
        trayendo={trayendo}
        onConectar={conectar}
        onRefrescar={traerPublicaciones}
        onActualizar={abrirActualizar}
      />
      {errorML && (
        <p className="mb-4 text-[12.5px]" style={{ color: "var(--oxido)" }}>
          {errorML}
        </p>
      )}
      {exito && (
        <p className="mb-4 text-[12.5px]" style={{ color: "var(--verde)" }}>
          {exito}
        </p>
      )}
      {seccion === "precios" && avisoPromos && (
        <p className="mb-4 text-[12.5px]" style={{ color: "var(--humo)" }}>
          {avisoPromos}
        </p>
      )}
      {/* Escrito y no en un `title`: con una campaña co-fondeada lo que paga el
          comprador y lo que te llega son dos números distintos, y si no se dice
          la columna parece mal calculada. */}
      {seccion === "precios" && enPromo > 0 && (
        <p className="mb-4 text-[12.5px]" style={{ color: "var(--humo)" }}>
          Hay {enPromo === 1 ? "un perfume" : `${enPromo} perfumes`} con promoción en Mercado Libre. En las
          campañas co-fondeadas ML paga parte del descuento, así que te llega más de lo que paga el
          comprador: la ganancia de abajo ya lo tiene en cuenta.
        </p>
      )}

      {seccion === "ventas" ? (
        <VentasML perfumes={perfumes} cuenta={cuenta} />
      ) : seccion === "promociones" ? (
        <PromocionesML perfumes={perfumes} ajustes={ajustes} cuenta={cuenta} onConfirmar={onConfirmar} />
      ) : (
        <>
          <AjustesML ajustes={ajustes} onAjustes={onAjustes} />

          {panel && (
            <PanelActualizar {...panel} onCerrar={() => setPanel(null)} onTerminado={releerTrasActualizar} />
          )}

          {publicando && (
            <PublicarML
              perfume={publicando}
              ajustes={ajustes}
              planes={planes}
              onAjustes={onAjustes}
              onCambiar={onCambiar}
              onConfirmar={onConfirmar}
              onCerrar={() => setPublicandoId(null)}
              onPublicado={releerTrasActualizar}
            />
          )}

          {actualizando && (
            <ActualizarML
              perfume={actualizando}
              planes={planes}
              onCambiar={onCambiar}
              onConfirmar={onConfirmar}
              onCerrar={() => setActualizandoId(null)}
              onActualizado={releerTrasActualizar}
            />
          )}

          {visibles.length === 0 ? (
            <p className="py-12 text-center text-[13px]" style={{ color: "var(--humo-claro)" }}>
              {perfumes.length === 0
                ? "El catálogo está vacío. Los perfumes se agregan en la pestaña Catálogo."
                : "Ningún perfume coincide con la búsqueda."}
            </p>
          ) : (
            <div className="overflow-auto pb-2" style={{ maxHeight: ALTO_TABLA }}>
              <div style={{ minWidth: anchoDeColumnas(columnas) }}>
                <EncabezadoML
                  planes={planes}
                  columnas={columnas}
                  orden={orden}
                  onOrdenar={onOrdenar}
                />
                <ul className="grid gap-1.5">
                  {visibles.map((p) => (
                    <FilaML
                      key={p.id}
                      perfume={p}
                      ajustes={ajustes}
                      planes={planes}
                      columnas={columnas}
                      promosPorPlan={promosDePerfume.get(p.id)}
                      onCambiar={onCambiar}
                      onSoltarMargenML={onSoltarMargenML}
                      conectado={!!cuenta?.conectado}
                      publicaciones={publicaciones}
                      pubPorId={pubPorId}
                      usadas={usadas}
                      onVincular={vincular}
                      onStock={(pub, stock) => cambiarStock(p, pub, stock)}
                      onPublicar={() => setPublicandoId(p.id)}
                      onActualizar={() => setActualizandoId(p.id)}
                      onDescuento={() => abrirDescuento(p)}
                    />
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
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
function EncabezadoML({ planes, columnas, orden, onOrdenar }) {
  const col = (texto, fondo, clave, alineado = "text-right", contexto) => (
    <ColumnaOrdenable
      texto={texto}
      clave={clave}
      orden={orden}
      onOrdenar={onOrdenar}
      fondo={fondo}
      alineado={alineado}
      contexto={contexto}
    />
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
            style={{ background: "var(--zona-ml-honda)", color: "var(--tinta)", gridColumn: "span 4" }}
          >
            Mercado Libre · {nombreDePlan(plan)}
          </span>
        ))}
      </div>
      <div className="grid items-center border border-transparent" style={{ gridTemplateColumns: columnas }}>
        <span />
        {col("Perfume", "transparent", "nombre", "text-left")}
        {col("Costo", "var(--zona-directa)", "costo")}
        {col("Gan. directa", "var(--zona-directa)", "gananciaDirecta")}
        {planes.map((plan) => (
          <Fragment key={plan}>
            {col("Precio", "var(--zona-ml)", `precio:${plan}`, "text-right", nombreDePlan(plan))}
            {col("Margen", "var(--zona-ml)", `margen:${plan}`, "text-right", nombreDePlan(plan))}
            {col("Ganancia", "var(--zona-ml)", `ganancia:${plan}`, "text-right", nombreDePlan(plan))}
            {/* "En ML" no ordena: es la celda del vínculo con la publicación,
                no una cifra del negocio. */}
            {col("En ML", "var(--zona-ml)")}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

const colorGanancia = (g) =>
  g === null ? "var(--humo-claro)" : g >= 0 ? "var(--verde)" : "var(--oxido)";

/* Qué dice el `title` de la ganancia cuando hay una promo puesta. Lo importante
   es que en una co-fondeada lo que paga el comprador NO es lo que te llega. */
function explicarPromo(promo) {
  const partes = [
    `Ahora tiene una promoción (${nombreDeTipoPromo(promo.tipo)}${
      promo.nombre ? `: "${promo.nombre}"` : ""
    }): el comprador paga ${pesos(promo.paga)}`,
  ];
  if (promo.coFondeada && promo.poneML > 0)
    partes.push(`de los cuales ML pone ${pesos(promo.poneML)}, así que a vos te llegan ${pesos(promo.recibe)}`);
  else partes.push("y el descuento lo pagás vos entero");
  if (promo.ganancia != null) partes.push(`con lo que te quedan ${pesos(promo.ganancia)}`);
  if (promo.topPaga)
    partes.push(`Los compradores con Mercado Puntos nivel 3 a 6 pagan ${pesos(promo.topPaga)}`);
  return `${partes.join(", ").replace(", Los compradores", ". Los compradores")}.`;
}

function FilaML({
  perfume,
  ajustes,
  planes,
  columnas,
  promosPorPlan: promosDePlanes,
  onCambiar,
  onSoltarMargenML,
  conectado,
  publicaciones,
  pubPorId,
  usadas,
  onVincular,
  onStock,
  onPublicar,
  onActualizar,
  onDescuento,
}) {
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
    promosPorPlan: promosDePlanes,
  });
  const sinCosto = !(Number(perfume.costo) > 0);

  const cifra = (contenido, { fondo, color, titulo, fuerte, debajo }) => (
    <div className="px-2 text-right" style={{ background: fondo }} title={titulo}>
      <span
        className={`k-num text-[13px] ${fuerte ? "font-semibold" : ""}`}
        style={{ color: color ?? "var(--humo)" }}
      >
        {contenido}
      </span>
      {debajo}
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

      <div className="flex min-w-0 items-center gap-1.5 px-2">
        <span className="truncate text-[13px]" style={{ color: "var(--tinta)" }} title={perfume.nombre}>
          {perfume.nombre}
        </span>
        {/* Publicar aparece al pasar el mouse, como el "=": solo si algún plan
            todavía no tiene publicación vinculada. */}
        {conectado && planes.some((plan) => !vinculosDe(perfume)[plan]) && (
          <button
            type="button"
            onClick={onPublicar}
            title={`Publicar ${perfume.nombre} en Mercado Libre (los planes sin publicación)`}
            className="k-col shrink-0 rounded-[3px] border px-1.5 py-0.5 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
            style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
          >
            Publicar
          </button>
        )}
        {/* Fotos, ficha, nombre y descripción de lo ya publicado (solo las normales). */}
        {conectado && planes.some((plan) => vinculosDe(perfume)[plan]) && (
          <button
            type="button"
            onClick={onActualizar}
            title={`Actualizar fotos, ficha, nombre o descripción de ${perfume.nombre} en Mercado Libre`}
            className="k-col shrink-0 rounded-[3px] border px-1.5 py-0.5 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
            style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
          >
            Actualizar
          </button>
        )}
        {/* Poner o quitar un descuento propio (el que no es de ninguna campaña
            de ML). Las campañas se manejan en la sección Promociones. */}
        {conectado && planes.some((plan) => vinculosDe(perfume)[plan]) && (
          <button
            type="button"
            onClick={onDescuento}
            title={`Poner o quitar un descuento propio de ${perfume.nombre} en Mercado Libre`}
            className="k-col shrink-0 rounded-[3px] border px-1.5 py-0.5 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
            style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
          >
            Descuento
          </button>
        )}
      </div>

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
            /* El número grande es siempre el del precio de lista: es el que
               compara planes y el que usan el `=` y el margen clavado. La promo
               va de renglón chico abajo, porque es lo que está pasando hoy. */
            debajo:
              x.promo?.ganancia == null ? null : (
                <div
                  className="k-num text-[10px] leading-tight"
                  style={{ color: x.promo.ganancia > 0 ? "var(--verde)" : "var(--oxido)" }}
                >
                  en promo {pesos(x.promo.ganancia)}
                </div>
              ),
            titulo:
              (x.ganancia === null
                ? `Poné costo y precio para ver qué te deja en ${nombreDePlan(x.plan)}`
                : `En ${nombreDePlan(x.plan)}, después de la comisión (${pctCorto(
                    x.comision
                  )}) y el envío de ML: ${pesos(x.ganancia)}.` +
                  (x.sugerido === null
                    ? ""
                    : ` Para igualar la venta directa habría que publicar ${pesos(x.sugerido)}.`)) +
              (x.promo ? ` ${explicarPromo(x.promo)}` : ""),
          })}
          <CeldaPublicacion
            perfume={perfume}
            plan={x.plan}
            promo={x.promo}
            precioCatalogo={x.precio}
            itemId={vinculosDe(perfume)[x.plan]}
            itemCatalogo={vinculosCatalogoDe(perfume)[x.plan]}
            conectado={conectado}
            publicaciones={publicaciones}
            pubPorId={pubPorId}
            usadas={usadas}
            onVincular={onVincular}
            onStock={onStock}
          />
        </Fragment>
      ))}
    </li>
  );
}
