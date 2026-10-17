import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, RefreshCw, Upload, X } from "lucide-react";
import { NumberCell } from "./NumberCell";
import { pesos } from "./Catalogo";
import { preciosDePlanes } from "./precios";
import {
  cuotasDePublicacion,
  nombreDePlan,
  publicarEnML,
  validarPublicacionML,
  vinculosCatalogoDe,
  vinculosDe,
} from "./clienteML";
import {
  CAMPOS_FICHA,
  condicionesDe,
  descripcionDesdeTxt,
  faltantes,
  fichaDesdeTxt,
  tipoDePlan,
  tituloDesdeTxt,
} from "./armadoML";
import { Aviso, CampoFicha, Paso, SelectorDeFotos, caja, campo, useCarpetaML, useListasFicha } from "./piezasPublicarML";

/* ============================================================
   Publicar un perfume en Mercado Libre.

   Cuatro pasos en una pantalla: fotos (de `<Perfume>/Mercadolibre/`, nada de
   Tiendanube), ficha técnica a mano, qué planes, y validar → publicar.
   Validar no publica. Publicar escribe en ML, y solo después de "Publicar N"
   y de la confirmación. Lo creado queda vinculado al plan (normal y de
   catálogo) con el mismo `onCambiar` que usa el buscador de publicaciones.

   Va en un portal al body, debajo del `Dialogo` (z 55 contra 60): la
   confirmación se abre encima del panel.
   ============================================================ */

export default function PublicarML({ perfume, ajustes, planes, onAjustes, onCambiar, onConfirmar, onCerrar, onPublicado }) {
  const [ficha, setFicha] = useState(() => perfume.fichaML ?? {});
  const [descripcion, setDescripcion] = useState("");
  const [familyName, setFamilyName] = useState(perfume.familyNameML ?? `Perfume ${perfume.nombre}`);
  const [stock, setStock] = useState(1);
  const [verCondiciones, setVerCondiciones] = useState(false);
  const [validacion, setValidacion] = useState(null);
  const [publicacion, setPublicacion] = useState(null);
  const [trabajando, setTrabajando] = useState(""); // "", "validando", "publicando"
  const [error, setError] = useState("");

  const condiciones = condicionesDe(ajustes);
  const precios = preciosDePlanes(perfume);
  const vinculos = vinculosDe(perfume);

  // Carpeta, fotos y texto: lo mismo que usa Actualizar (piezasPublicarML.jsx).
  const carpetas = useCarpetaML(perfume, onCambiar);
  const { carpeta, elegida, fotosElegidas, txt } = carpetas;
  const listas = useListasFicha();

  // Del texto salen la descripción y, si no hay uno guardado, el nombre sugerido.
  useEffect(() => {
    if (!txt) return;
    setDescripcion(descripcionDesdeTxt(txt));
    const titulo = tituloDesdeTxt(txt);
    if (titulo && !perfume.familyNameML) setFamilyName(titulo.slice(0, 120));
  }, [txt]);

  /* Los planes: uno por plan publicable. Los ya vinculados y los sin precio no
     se pueden tildar. Arrancan tildados los que se pueden publicar. */
  const filasDePlan = planes.map((plan) => ({
    plan,
    precio: Number(precios[plan]) || 0,
    vinculado: vinculos[plan] ?? null,
  }));
  const [planesElegidos, setPlanesElegidos] = useState(
    () => new Set(filasDePlan.filter((f) => !f.vinculado && f.precio > 0).map((f) => f.plan))
  );
  const elegidos = filasDePlan.filter((f) => planesElegidos.has(f.plan) && !f.vinculado && f.precio > 0);

  const falta = faltantes(ficha);
  const problemas = [
    !carpeta && "Elegí la carpeta del perfume",
    carpeta && elegida && !elegida.existe && "La carpeta todavía no tiene la subcarpeta Mercadolibre",
    carpeta && elegida?.existe && !fotosElegidas.length && "No hay fotos para publicar",
    falta.length && `Falta en la ficha: ${falta.join(", ")}`,
    !elegidos.length && "Elegí al menos un plan",
    !familyName.trim() && "Poné el nombre de la publicación",
    !(stock >= 1) && "El stock tiene que ser 1 o más",
  ].filter(Boolean);

  const pedido = {
    carpeta,
    fotos: fotosElegidas,
    ficha,
    familyName: familyName.trim(),
    stock: Math.round(stock),
    descripcion,
    condiciones,
    planes: elegidos.map((f) => ({ plan: f.plan, precio: f.precio })),
  };
  const clavePedido = JSON.stringify(pedido);
  // Cualquier cambio después de validar obliga a validar de nuevo.
  useEffect(() => setValidacion(null), [clavePedido]);

  const cambiarFicha = (id, v) => setFicha((f) => ({ ...f, [id]: v }));

  const validar = async () => {
    setTrabajando("validando");
    setError("");
    // La ficha y el nombre quedan guardados en el perfume: validar es un paso
    // explícito, y así no se retipea todo al publicar otro plan después.
    onCambiar(perfume.id, { fichaML: ficha, familyNameML: pedido.familyName });
    try {
      setValidacion(await validarPublicacionML(pedido));
    } catch (e) {
      setError(e.message);
    } finally {
      setTrabajando("");
    }
  };

  const todoValida = validacion && validacion.resultados.length && validacion.resultados.every((r) => r.ok);

  const publicar = () =>
    onConfirmar({
      titulo: "Publicar en Mercado Libre",
      ancho: "max-w-lg",
      texto: `Se ${elegidos.length === 1 ? "crea 1 publicación real y visible" : `crean ${elegidos.length} publicaciones reales y visibles`} de "${
        pedido.familyName
      }": ${elegidos
        .map((f) => `${nombreDePlan(f.plan)} a ${pesos(f.precio)}`)
        .join(", ")}. Stock ${pedido.stock}, ${pedido.fotos.length} foto${pedido.fotos.length === 1 ? "" : "s"}. Después se crea la de catálogo de cada una, si ML lo permite.`,
      etiquetaOk: `Publicar ${elegidos.length} en ML`,
      onAceptar: async () => {
        setTrabajando("publicando");
        setError("");
        try {
          const r = await publicarEnML(pedido);
          setPublicacion(r);
          // Lo creado se vincula al plan, aunque otro plan haya fallado.
          const normales = { ...vinculosDe(perfume) };
          const deCatalogo = { ...vinculosCatalogoDe(perfume) };
          for (const x of r.resultados ?? []) {
            if (x.itemId) normales[x.plan] = x.itemId;
            if (x.catalogoId) deCatalogo[x.plan] = x.catalogoId;
          }
          if ((r.resultados ?? []).some((x) => x.itemId))
            onCambiar(perfume.id, {
              publicacionesML: normales,
              publicacionesCatalogoML: Object.keys(deCatalogo).length ? deCatalogo : undefined,
            });
          onPublicado();
        } catch (e) {
          setError(e.message);
        } finally {
          setTrabajando("");
        }
      },
    });

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/40 p-4" onClick={() => !trabajando && onCerrar()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Publicar ${perfume.nombre} en Mercado Libre`}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-[5px] shadow-xl"
        style={{ background: "var(--papel)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b px-5 py-3" style={{ borderColor: "var(--linea)" }}>
          <h3 className="text-[15px] font-semibold" style={{ color: "var(--tinta)" }}>
            Publicar en Mercado Libre · {perfume.nombre}
          </h3>
          <button
            onClick={onCerrar}
            disabled={!!trabajando}
            aria-label="Cerrar"
            className="ml-auto rounded-[3px] p-1 disabled:opacity-40"
            style={{ color: "var(--humo)" }}
          >
            <X size={16} />
          </button>
        </div>

        <div data-scroll className="flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {/* ---- 1. Fotos ---- */}
          <Paso n={1} titulo="Fotos">
            <SelectorDeFotos carpetas={carpetas} />
          </Paso>

          {/* ---- 2. Ficha técnica ---- */}
          <Paso n={2} titulo="Ficha técnica">
            <div className="grid gap-4 md:grid-cols-[1fr_240px]">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                {CAMPOS_FICHA.map((c) => (
                  <CampoFicha key={c.id} campo={c} valor={ficha[c.id]} valores={listas[c.id]} onCambiar={(v) => cambiarFicha(c.id, v)} />
                ))}
              </div>
              <div>
                <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
                  Ficha del texto (referencia)
                </span>
                <pre className="whitespace-pre-wrap rounded-[3px] border p-2 text-[11.5px]" style={{ borderColor: "var(--linea)", color: "var(--humo)", fontFamily: "inherit" }}>
                  {fichaDesdeTxt(txt) || (carpeta ? "La carpeta no tiene publicacion_ml.txt con ficha." : "Elegí la carpeta.")}
                </pre>
              </div>
            </div>
          </Paso>

          {/* ---- 3. Qué se publica ---- */}
          <Paso n={3} titulo="Qué se publica">
            <ul className="mb-3 grid gap-1">
              {filasDePlan.map((f) => {
                const tipo = cuotasDePublicacion({ tipo: tipoDePlan(f.plan).listing_type_id, tags: tipoDePlan(f.plan).tags });
                const motivo = f.vinculado ? `ya está vinculado a ${f.vinculado}` : !(f.precio > 0) ? "no tiene precio en la app" : "";
                return (
                  <li key={f.plan}>
                    <label className={`flex items-center gap-3 rounded-[3px] border px-3 py-1.5 text-[12.5px] ${motivo ? "opacity-50" : "cursor-pointer"}`} style={{ borderColor: "var(--linea)", background: "var(--zona-ml)" }}>
                      <input
                        type="checkbox"
                        disabled={!!motivo}
                        checked={!motivo && planesElegidos.has(f.plan)}
                        onChange={() =>
                          setPlanesElegidos((s) => {
                            const n = new Set(s);
                            n.has(f.plan) ? n.delete(f.plan) : n.add(f.plan);
                            return n;
                          })
                        }
                      />
                      <span className="w-[90px]" style={{ color: "var(--tinta)" }}>
                        {nombreDePlan(f.plan)}
                      </span>
                      <span className="flex-1" style={{ color: "var(--humo)" }}>
                        {tipo.texto}
                        {motivo ? ` · ${motivo}` : ""}
                      </span>
                      <span className="k-num" style={{ color: "var(--tinta)" }}>
                        {f.precio > 0 ? pesos(f.precio) : "—"}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="grid gap-3 md:grid-cols-[1fr_120px]">
              <label className="block">
                <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
                  Nombre de la publicación ({familyName.trim().length}/120) · ML arma el título con esto
                </span>
                <input value={familyName} maxLength={120} onChange={(e) => setFamilyName(e.target.value)} className={campo} style={caja} />
              </label>
              <label className="block" title="Uno solo para todos los planes: ML comparte el stock entre las publicaciones del mismo perfume">
                <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
                  Stock
                </span>
                <NumberCell value={stock} onChange={(v) => setStock(Math.max(0, Math.round(v)))} />
              </label>
            </div>
            <label className="mt-3 block">
              <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
                Descripción {carpeta && !txt && "· la carpeta no tiene publicacion_ml.txt"}
              </span>
              <textarea value={descripcion} onChange={(e) => setDescripcion(e.target.value)} rows={7} className={campo} style={caja} />
            </label>

            <button onClick={() => setVerCondiciones((v) => !v)} className="k-col mt-3 flex items-center gap-1" style={{ color: "var(--humo)" }}>
              {verCondiciones ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Condiciones (valen para todas las publicaciones)
            </button>
            {verCondiciones && <Condiciones condiciones={condiciones} onCambiar={(c) => onAjustes({ publicacionML: c })} />}
          </Paso>

          {/* ---- 4. Validar y publicar ---- */}
          <Paso n={4} titulo="Validar y publicar">
            {/* Después de publicar, los planes ya están vinculados y "elegí un
                plan" sería un falso error. */}
            {problemas.length > 0 && !publicacion && (
              <ul className="mb-3 text-[12px]" style={{ color: "var(--oxido)" }}>
                {problemas.map((p) => (
                  <li key={p}>· {p}</li>
                ))}
              </ul>
            )}
            {error && <Aviso>{error}</Aviso>}
            {validacion && <ResultadosValidacion resultados={validacion.resultados} />}
            {publicacion && <ResultadosPublicacion r={publicacion} />}
          </Paso>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--linea)" }}>
          <span className="mr-auto text-[11.5px]" style={{ color: "var(--humo)" }}>
            Validar no publica: le pregunta a Mercado Libre si aceptaría cada publicación.
          </span>
          <button
            onClick={validar}
            disabled={!!trabajando || problemas.length > 0 || !!publicacion}
            className="k-col flex items-center gap-1.5 rounded-[3px] border px-3 py-[7px] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}
          >
            <RefreshCw size={13} className={trabajando === "validando" ? "animate-spin" : ""} /> {trabajando === "validando" ? "Validando…" : "Validar"}
          </button>
          <button
            onClick={publicar}
            disabled={!!trabajando || !todoValida || !!publicacion}
            title={todoValida ? "" : "Primero validá: se habilita cuando ML acepta todas"}
            className="flex items-center gap-1.5 rounded-[3px] px-3.5 py-[7px] text-[12.5px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: "var(--tinta)" }}
          >
            <Upload size={13} /> {trabajando === "publicando" ? "Publicando…" : `Publicar ${elegidos.length} en ML`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* Garantía, factura, máximo por compra y medidas del paquete: lo mismo para
   todas. Arranca con lo de la publicación real del Musamam. */
function Condiciones({ condiciones: c, onCambiar }) {
  const texto = (clave, nombre) => (
    <label className="block">
      <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
        {nombre}
      </span>
      <input value={c[clave] ?? ""} onChange={(e) => onCambiar({ ...c, [clave]: e.target.value })} className={campo} style={caja} />
    </label>
  );
  const medida = (clave, nombre) => (
    <label className="block">
      <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
        {nombre}
      </span>
      <NumberCell value={c.paquete[clave] ?? 0} onChange={(v) => onCambiar({ ...c, paquete: { ...c.paquete, [clave]: v } })} />
    </label>
  );
  return (
    <div className="mt-2 grid grid-cols-2 gap-3 rounded-[3px] border p-3 md:grid-cols-4" style={{ borderColor: "var(--zona-ml-honda)", background: "var(--zona-ml)" }}>
      {texto("garantiaTipo", "Tipo de garantía")}
      {texto("garantiaTiempo", "Tiempo de garantía")}
      {texto("factura", "Factura")}
      <label className="block">
        <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
          Máximo por compra
        </span>
        <NumberCell value={c.maxPorCompra ?? 0} onChange={(v) => onCambiar({ ...c, maxPorCompra: Math.max(0, Math.round(v)) })} />
      </label>
      {medida("alto", "Paquete: alto (cm)")}
      {medida("ancho", "Ancho (cm)")}
      {medida("largo", "Largo (cm)")}
      {medida("peso", "Peso (g)")}
    </div>
  );
}

function ResultadosValidacion({ resultados }) {
  return (
    <ul className="mb-3 grid gap-1.5">
      {resultados.map((r) => (
        <li key={r.plan} className="rounded-[3px] border px-3 py-2 text-[12px]" style={{ borderColor: r.ok ? "var(--verde)" : "var(--oxido)" }}>
          <span className="flex items-center gap-1.5 font-medium" style={{ color: r.ok ? "var(--verde)" : "var(--oxido)" }}>
            {r.ok ? <Check size={13} /> : <X size={13} />} {nombreDePlan(r.plan)}: {r.ok ? "Mercado Libre la aceptaría" : "Mercado Libre la rechaza"}
          </span>
          {r.errores.map((m) => (
            <span key={m} className="block" style={{ color: "var(--oxido)" }}>
              · {m}
            </span>
          ))}
          {r.advertencias.map((m) => (
            <span key={m} className="block" style={{ color: "var(--humo)" }}>
              · {m}
            </span>
          ))}
        </li>
      ))}
    </ul>
  );
}

/* Lo que pasó al publicar, renglón por renglón, y si ML las dejó sincronizadas
   como el Musamam (mismo User Product, cada normal atada a su de catálogo). */
function ResultadosPublicacion({ r }) {
  if (r.validacion) return <ResultadosValidacion resultados={r.validacion} />;
  const s = r.sincronizacion;
  return (
    <div>
      <ul className="mb-2 grid gap-1.5">
        {r.resultados.map((x) => (
          <li key={x.plan} className="rounded-[3px] border px-3 py-2 text-[12px]" style={{ borderColor: x.itemId ? "var(--verde)" : "var(--oxido)" }}>
            <span className="flex items-center gap-1.5 font-medium" style={{ color: x.itemId ? "var(--verde)" : "var(--oxido)" }}>
              {x.itemId ? <Check size={13} /> : <X size={13} />} {nombreDePlan(x.plan)}:{" "}
              {x.itemId ? (
                <span className="k-num">
                  {x.itemId}
                  {x.catalogoId ? ` · catálogo ${x.catalogoId}` : ""}
                </span>
              ) : (
                "no se publicó"
              )}
            </span>
            {[...x.errores].map((m) => (
              <span key={m} className="block" style={{ color: "var(--oxido)" }}>
                · {m}
              </span>
            ))}
            {[...x.avisos, ...x.advertencias].map((m) => (
              <span key={m} className="block" style={{ color: "var(--humo)" }}>
                · {m}
              </span>
            ))}
          </li>
        ))}
      </ul>
      {s && (
        <p className="text-[12px]" style={{ color: s.mismoProducto && !s.sueltas.length ? "var(--verde)" : "var(--oxido)" }}>
          {s.mismoProducto && !s.sueltas.length
            ? `Quedaron sincronizadas: mismo producto de usuario${s.productos[0] ? ` (${s.productos[0]})` : ""}, comparten el stock.`
            : `Ojo: ${!s.mismoProducto ? `quedaron en ${s.productos.length} productos de usuario distintos (${s.productos.join(", ")}), así que no comparten el stock` : ""}${
                s.sueltas.length ? `${!s.mismoProducto ? "; y " : ""}${s.sueltas.join(", ")} no quedó atada a su de catálogo` : ""
              }. Revisalo en Mercado Libre.`}
        </p>
      )}
    </div>
  );
}
