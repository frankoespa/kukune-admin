import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Plus, Search, Trash2, X } from "lucide-react";
import { urlFoto } from "./almacenamiento";
import { analisisTiendaNube, objetivoDirecto, objetivoTN } from "./precios";
import { NumberCell } from "./NumberCell";
import { CampoProtegido } from "./CampoProtegido";
import { buscarPerfumes, ConVistaPrevia, pesos } from "./Catalogo";
import { ajustesTNDeDecants, nombreDeTipo, tiposDeDecant } from "./cuentasDecant";
import { cajasDe, costoDeCaja, descripcionDeCaja, idCaja, motivoFalta, nuevaCaja, vendibleDeCaja } from "./cuentasCaja";
import { crearProductoTN, estadoTN, leerCategoriasTN, leerProductosTN, vinculoTN } from "./clienteTN";

/* ============================================================
   Cajas de descubrimiento: N decants del mismo tamaño, de perfumes que elige
   Franco, en una caja que se vende directo y en Tiendanube como un producto
   propio. Las cuentas están en `cuentasCaja.js`; las cajas viven en
   `ajustes.cajas`.

   Acá se arma cada caja (tamaño, perfumes, lista de costos), se fija su precio
   de venta directa y de Tiendanube, y se crea el producto en la tienda. Todo lo
   demás de Tiendanube (detalle por forma de pago, cupones, oferta, Actualizar
   precios) está en la pestaña Tiendanube, modo Cajas.
   ============================================================ */

const colorGanancia = (g) => (g === null ? "var(--humo-claro)" : g >= 0 ? "var(--verde)" : "var(--oxido)");
const selectorEstilo = { background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" };
const nuevoId = () => crypto.randomUUID().slice(0, 8);

export default function PestanaCajas({ perfumes, ajustes, onCajas, onCambiar, onFijarObjetivo, onSoltarMargen, onFijarObjetivoTN, onSoltarMargenTN, onConfirmar }) {
  const cajas = cajasDe(ajustes);
  const tipos = tiposDeDecant(ajustes);
  const perfumePorId = useMemo(() => new Map(perfumes.map((p) => [p.id, p])), [perfumes]);
  const tiposPorId = useMemo(() => new Map(tipos.map((t) => [t.id, t])), [tipos]);
  const ajustesTN = ajustesTNDeDecants(ajustes);

  /* La conexión con Tiendanube se pregunta al entrar, solo lectura: para saber
     si se puede crear el producto y para ver el precio publicado. */
  const [cuenta, setCuenta] = useState(null);
  const [productos, setProductos] = useState(null);
  const [categorias, setCategorias] = useState(null);
  useEffect(() => {
    let vigente = true;
    estadoTN()
      .then((c) => {
        if (!vigente) return;
        setCuenta(c);
        if (c.conectado) {
          leerProductosTN().then((l) => vigente && setProductos(l)).catch(() => {});
          leerCategoriasTN().then((l) => vigente && setCategorias(l)).catch(() => {});
        }
      })
      .catch(() => vigente && setCuenta({ conectado: false }));
    return () => {
      vigente = false;
    };
  }, []);
  const porVariante = useMemo(() => {
    const m = new Map();
    for (const p of productos ?? []) for (const v of p.variantes) m.set(String(v.id), v);
    return m;
  }, [productos]);

  const cambiarCaja = (id, campos) => onCajas((cs) => cs.map((c) => (c.id === id ? { ...c, ...campos } : c)));
  const agregar = () => onCajas((cs) => [...cs, nuevaCaja({ tipo: tipos[0]?.id ?? null })]);
  const duplicar = (caja) => onCajas((cs) => [...cs, nuevaCaja({ base: caja })]);
  const borrar = (caja) =>
    onConfirmar({
      titulo: `¿Borrar "${caja.nombre || "la caja sin nombre"}"?`,
      texto: vinculoTN(caja)
        ? "Se borra de la app con sus perfumes, costos y precios. El producto de Tiendanube NO se borra: queda en la tienda y hay que sacarlo a mano en el panel."
        : "Se borra de la app con sus perfumes, costos y precios.",
      etiquetaOk: "Borrar",
      peligro: true,
      onAceptar: () => onCajas((cs) => cs.filter((c) => c.id !== caja.id)),
    });

  /* Crear el producto en la tienda real. El cuerpo del diálogo es un
     componente (`CuerpoCrear`) que avisa lo elegido por un ref, molde de
     `atarAlPasar` en App. */
  const [aviso, setAviso] = useState({});
  const elegido = useRef(null);
  const crearEnTN = (caja, vendible) => {
    const tipo = tiposPorId.get(caja.tipo);
    const precio = Number(vendible.precioTN) || 0;
    elegido.current = {
      nombre: caja.nombre,
      descripcion: descripcionDeCaja(caja, perfumePorId, tipo),
      stock: "",
      categoria: "",
      publicado: false,
    };
    onConfirmar({
      titulo: "Crear la caja en Tiendanube",
      ancho: "max-w-lg",
      texto: (
        <CuerpoCrear inicial={elegido.current} precio={precio} categorias={categorias ?? []} onCambio={(v) => (elegido.current = v)} />
      ),
      etiquetaOk: "Crear producto",
      onAceptar: async () => {
        const e = elegido.current;
        setAviso((a) => ({ ...a, [caja.id]: { texto: "Creando…" } }));
        try {
          const { producto } = await crearProductoTN({
            nombre: e.nombre,
            descripcion: e.descripcion,
            precio,
            stock: e.stock === "" ? null : Number(e.stock),
            categoria: e.categoria || null,
            publicado: e.publicado,
          });
          onCambiar(idCaja(caja.id), { publicacionTN: { productId: producto.id, variantId: producto.variantes[0].id } });
          setProductos((l) => [...(l ?? []), producto]);
          setAviso((a) => ({
            ...a,
            [caja.id]: { texto: `Creado en Tiendanube${e.publicado ? "" : " (oculto)"}. Las fotos se agregan en el panel.`, ok: true },
          }));
        } catch (err) {
          setAviso((a) => ({ ...a, [caja.id]: { texto: `No se pudo crear (${err.message}).` } }));
        }
      },
    });
  };

  return (
    <section className="mx-auto max-w-[1180px] px-6 py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="k-rotulo mb-1">Cajas de descubrimiento</h2>
          <p className="max-w-[760px] text-[12.5px]" style={{ color: "var(--humo)" }}>
            Una caja con varios decants del mismo tamaño, de los perfumes que elijas. Adentro va el frasquito solo, sin su
            cajita individual. El costo es la suma de los decants más la lista de costos de la caja. Se vende directo y en
            Tiendanube como un producto aparte; el detalle por forma de pago, los cupones y Actualizar precios están en la
            pestaña Tiendanube, modo Cajas.
          </p>
        </div>
        <button
          onClick={agregar}
          disabled={!tipos.length}
          className="k-col flex items-center gap-1.5 rounded-[3px] border px-3 py-[7px] disabled:opacity-50"
          style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}
        >
          <Plus size={13} /> Nueva caja
        </button>
      </div>

      {!tipos.length && (
        <p className="mb-6 text-[12.5px]" style={{ color: "var(--oxido)" }}>
          Primero creá un tamaño de decant en la pestaña Decants: cada caja lleva decants de un tamaño.
        </p>
      )}

      {cajas.length === 0 ? (
        <p className="py-12 text-center text-[13px]" style={{ color: "var(--humo-claro)" }}>
          Todavía no hay cajas. Tocá "Nueva caja" para armar la primera.
        </p>
      ) : (
        <div className="grid gap-5">
          {cajas.map((caja) => (
            <TarjetaCaja
              key={caja.id}
              caja={caja}
              perfumes={perfumes}
              perfumePorId={perfumePorId}
              tipos={tipos}
              tiposPorId={tiposPorId}
              ajustesTN={ajustesTN}
              conectado={!!cuenta?.conectado}
              variante={vinculoTN(caja) ? porVariante.get(String(vinculoTN(caja).variantId)) ?? null : null}
              productosLeidos={productos != null}
              aviso={aviso[caja.id]}
              onCambiarCaja={(campos) => cambiarCaja(caja.id, campos)}
              onDuplicar={() => duplicar(caja)}
              onBorrar={() => borrar(caja)}
              onCrearEnTN={(v) => crearEnTN(caja, v)}
              onDesvincular={() => onCambiar(idCaja(caja.id), { publicacionTN: undefined })}
              onCambiar={onCambiar}
              onFijarObjetivo={onFijarObjetivo}
              onSoltarMargen={onSoltarMargen}
              onFijarObjetivoTN={onFijarObjetivoTN}
              onSoltarMargenTN={onSoltarMargenTN}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------- Una caja ---------- */

function TarjetaCaja({
  caja,
  perfumes,
  perfumePorId,
  tipos,
  tiposPorId,
  ajustesTN,
  conectado,
  variante,
  productosLeidos,
  aviso,
  onCambiarCaja,
  onDuplicar,
  onBorrar,
  onCrearEnTN,
  onDesvincular,
  onCambiar,
  onFijarObjetivo,
  onSoltarMargen,
  onFijarObjetivoTN,
  onSoltarMargenTN,
}) {
  const tipo = tiposPorId.get(caja.tipo) ?? null;
  const costo = costoDeCaja(caja, perfumePorId, tipo);
  const v = vendibleDeCaja(caja, perfumePorId, tiposPorId);
  const n = caja.perfumes?.length ?? 0;

  const quitarPerfume = (i) => onCambiarCaja({ perfumes: caja.perfumes.filter((_, j) => j !== i) });
  const agregarPerfume = (id) => onCambiarCaja({ perfumes: [...(caja.perfumes ?? []), id] });
  const costos = caja.costos ?? [];
  const cambiarCosto = (id, campos) => onCambiarCaja({ costos: costos.map((c) => (c.id === id ? { ...c, ...campos } : c)) });
  const [recienAgregado, setRecienAgregado] = useState(null);
  const agregarCosto = () => {
    const id = nuevoId();
    setRecienAgregado(id);
    onCambiarCaja({ costos: [...costos, { id, nombre: "", costo: 0 }] });
  };

  return (
    <article className="rounded-[5px] border" style={{ borderColor: "var(--linea)", background: "var(--papel)" }}>
      {/* Cabecera: nombre, tamaño, cantidad y acciones */}
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3" style={{ borderColor: "var(--linea)", background: "var(--zona-decant)" }}>
        <input
          value={caja.nombre ?? ""}
          onChange={(e) => onCambiarCaja({ nombre: e.target.value })}
          placeholder="Nombre de la caja (ej. Árabes dulces x5)"
          aria-label="Nombre de la caja"
          className="min-w-[260px] flex-1 rounded-[3px] border px-2 py-1.5 text-[14px] font-medium"
          style={selectorEstilo}
        />
        <label className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--humo)" }}>
          Decants de
          <select value={caja.tipo ?? ""} onChange={(e) => onCambiarCaja({ tipo: e.target.value || null })} className="rounded-[3px] border px-1.5 py-[5px] text-[12.5px]" style={selectorEstilo}>
            {!tipo && <option value="">elegí un tamaño</option>}
            {tipos.map((t) => (
              <option key={t.id} value={t.id}>
                {nombreDeTipo(t)}
              </option>
            ))}
          </select>
        </label>
        <span className="k-num text-[12.5px]" style={{ color: "var(--tinta)" }}>
          {n} decant{n === 1 ? "" : "s"}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={onDuplicar} title="Duplicar la caja (perfumes, costos y precios; sin el producto de Tiendanube)" className="k-col flex items-center gap-1 rounded-[3px] px-2 py-1.5" style={{ color: "var(--humo)" }}>
            <Copy size={13} /> Duplicar
          </button>
          <button onClick={onBorrar} title="Borrar la caja" className="k-col flex items-center gap-1 rounded-[3px] px-2 py-1.5" style={{ color: "var(--humo)" }}>
            <Trash2 size={13} /> Borrar
          </button>
        </div>
      </header>

      <div className="grid gap-5 p-4 md:grid-cols-2">
        {/* Perfumes */}
        <div>
          <h3 className="k-col mb-1" style={{ color: "var(--tinta)" }}>
            Perfumes de la caja
          </h3>
          <p className="mb-2 text-[11.5px]" style={{ color: "var(--humo)" }}>
            Cada renglón es un decant{tipo ? ` de ${nombreDeTipo(tipo)}` : ""}: el perfume a su costo por ml más el frasquito
            {tipo ? ` (${pesos(Number(tipo.costoFrasco) || 0)})` : ""}, sin la cajita individual.
          </p>
          <ul className="mb-2 grid gap-1">
            {costo.decants.map((d, i) => (
              <li key={`${d.perfumeId}-${i}`} className="flex items-center gap-2 rounded-[3px] border px-1.5 py-1" style={{ borderColor: d.falta ? "var(--oxido)" : "var(--linea)" }}>
                <Miniatura perfume={d.perfume} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px]" style={{ color: d.perfume ? "var(--tinta)" : "var(--oxido)" }}>
                    {d.perfume?.nombre ?? "Perfume borrado"}
                  </span>
                  {d.falta && (
                    <span className="block text-[11px]" style={{ color: "var(--oxido)" }}>
                      Sin costo: {motivoFalta(d.falta)}
                    </span>
                  )}
                </span>
                <span className="k-num text-[12.5px]" style={{ color: d.costo == null ? "var(--humo-claro)" : "var(--tinta)" }}>
                  {d.costo == null ? "—" : pesos(d.costo)}
                </span>
                <button onClick={() => quitarPerfume(i)} title="Sacar de la caja" aria-label={`Sacar ${d.perfume?.nombre ?? "el perfume"} de la caja`} className="rounded-[3px] p-1" style={{ color: "var(--humo)" }}>
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
          <AgregarPerfume perfumes={perfumes} enLaCaja={caja.perfumes ?? []} onAgregar={agregarPerfume} />
        </div>

        {/* Costos de la caja */}
        <div>
          <h3 className="k-col mb-1" style={{ color: "var(--tinta)" }}>
            Costos de la caja
          </h3>
          <p className="mb-2 text-[11.5px]" style={{ color: "var(--humo)" }}>
            Todo lo que lleva la caja además de los decants: la caja, la espuma de fondo, una tarjeta… El importe se abre con
            doble clic (o Tab y Enter), porque mueve los precios clavados.
          </p>
          <ul className="mb-2 grid gap-1">
            {costos.map((c) => (
              <li key={c.id} className="grid items-center gap-2" style={{ gridTemplateColumns: "1fr 120px 28px" }}>
                <input
                  value={c.nombre}
                  onChange={(e) => cambiarCosto(c.id, { nombre: e.target.value })}
                  placeholder="Qué es (ej. Espuma de fondo)"
                  aria-label="Nombre del costo"
                  autoFocus={c.id === recienAgregado}
                  className="rounded-[3px] border px-2 py-1 text-[12.5px]"
                  style={selectorEstilo}
                />
                <CampoProtegido
                  valor={c.costo}
                  onCambiar={(x) => cambiarCosto(c.id, { costo: x })}
                  mostrar={(x) => pesos(x || 0)}
                  etiqueta={`el costo de ${c.nombre || "este renglón"}`}
                />
                <button onClick={() => onCambiarCaja({ costos: costos.filter((x) => x.id !== c.id) })} title="Quitar este costo" aria-label={`Quitar ${c.nombre || "este costo"}`} className="rounded-[3px] p-1" style={{ color: "var(--humo)" }}>
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
          <button onClick={agregarCosto} className="k-col flex items-center gap-1 rounded-[3px] border px-2 py-1" style={{ borderColor: "var(--linea)", color: "var(--tinta)" }}>
            <Plus size={12} /> Agregar costo
          </button>

          {/* El desglose, escrito: de dónde sale el costo de la caja. */}
          <div className="mt-4 rounded-[4px] border px-3 py-2" style={{ borderColor: "var(--linea)", background: "var(--vidrio)" }}>
            <div className="flex justify-between text-[12.5px]" style={{ color: "var(--humo)" }}>
              <span>Decants ({n})</span>
              <span className="k-num">{pesos(costo.deDecants)}</span>
            </div>
            <div className="flex justify-between text-[12.5px]" style={{ color: "var(--humo)" }}>
              <span>Costos de la caja</span>
              <span className="k-num">{pesos(costo.extras)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t pt-1 text-[13px] font-semibold" style={{ borderColor: "var(--linea)", color: "var(--tinta)" }}>
              <span>Costo de la caja</span>
              <span className="k-num">{costo.total == null ? "—" : pesos(costo.total)}</span>
            </div>
            {costo.total == null && (
              <p className="mt-1 text-[11px]" style={{ color: "var(--oxido)" }}>
                {n === 0 ? "Agregá perfumes para que la caja tenga costo." : "Hay decants sin costo: hasta que se resuelvan, la caja no tiene costo ni precio calculado."}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Precios */}
      <div className="grid gap-4 border-t p-4 md:grid-cols-2" style={{ borderColor: "var(--linea)" }}>
        <PrecioDirecto v={v} onCambiar={onCambiar} onFijarObjetivo={onFijarObjetivo} onSoltarMargen={onSoltarMargen} />
        <PrecioTN
          v={v}
          caja={caja}
          ajustesTN={ajustesTN}
          onCambiar={onCambiar}
          onCambiarCaja={onCambiarCaja}
          onFijarObjetivoTN={onFijarObjetivoTN}
          onSoltarMargenTN={onSoltarMargenTN}
          conectado={conectado}
          variante={variante}
          productosLeidos={productosLeidos}
          aviso={aviso}
          onCrearEnTN={() => onCrearEnTN(v)}
          onDesvincular={onDesvincular}
        />
      </div>
    </article>
  );
}

function Miniatura({ perfume }) {
  return (
    <ConVistaPrevia archivo={perfume?.foto} nombre={perfume?.nombre ?? ""}>
      <div
        className="h-[30px] w-[30px] shrink-0 overflow-hidden rounded-[3px] border"
        style={{ borderColor: "var(--linea)", borderStyle: perfume?.foto ? "solid" : "dashed", background: perfume?.foto ? "var(--papel)" : "#F4F6F2" }}
      >
        {perfume?.foto && <img src={urlFoto(perfume.foto)} alt="" className="h-full w-full object-cover" />}
      </div>
    </ConVistaPrevia>
  );
}

/* Buscar un perfume del catálogo y sumarlo. La lista se despliega debajo del
   campo, en el flujo (la tarjeta no recorta): no hace falta portal. Los que ya
   están en la caja se marcan pero se pueden repetir a propósito. */
function AgregarPerfume({ perfumes, enLaCaja, onAgregar }) {
  const [consulta, setConsulta] = useState("");
  const yaEstan = new Set(enLaCaja);
  const opciones = consulta.trim() ? buscarPerfumes(perfumes, consulta).slice(0, 8) : [];
  return (
    <div>
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2" style={{ color: "var(--humo-claro)" }} />
        <input
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          placeholder="Agregar un perfume del catálogo…"
          aria-label="Buscar un perfume para agregar a la caja"
          className="w-full rounded-[3px] border py-1.5 pl-7 pr-2 text-[12.5px]"
          style={selectorEstilo}
        />
      </div>
      {consulta.trim() && (
        <ul className="mt-1 grid gap-0.5 rounded-[3px] border p-1" style={{ borderColor: "var(--linea)" }}>
          {opciones.length === 0 && (
            <li className="px-2 py-1 text-[12px]" style={{ color: "var(--humo)" }}>
              Ningún perfume del catálogo coincide.
            </li>
          )}
          {opciones.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => {
                  onAgregar(p.id);
                  setConsulta("");
                }}
                className="flex w-full items-center gap-2 rounded-[3px] px-2 py-1 text-left text-[12.5px] hover:bg-[var(--vidrio)]"
                style={{ color: "var(--tinta)" }}
              >
                <span className="flex-1 truncate">{p.nombre}</span>
                {yaEstan.has(p.id) && (
                  <span className="text-[11px]" style={{ color: "var(--humo)" }}>
                    ya en la caja
                  </span>
                )}
                {!(Number(p.costo) > 0 && Number(p.ml) > 0) && (
                  <span className="text-[11px]" style={{ color: "var(--oxido)" }}>
                    {!(Number(p.costo) > 0) ? "sin costo" : "sin ml"}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Precios ---------- */

/* Una cifra editable que, escrita, fija un objetivo; con la X se suelta. */
function CeldaObjetivo({ etiqueta, fijado, valor, onChange, onSoltar, suffix, color, sinCosto }) {
  return (
    <div>
      <span className="k-col mb-0.5 block" style={{ color: "var(--humo)" }}>
        {etiqueta}
        {fijado ? " · fijado" : ""}
      </span>
      <div className="relative">
        {sinCosto ? (
          <span className="k-num block px-2 py-1 text-right text-[13px]" style={{ color: "var(--humo-claro)" }}>
            —
          </span>
        ) : (
          <NumberCell
            value={valor}
            onChange={onChange}
            suffix={suffix}
            className={fijado ? "font-semibold" : ""}
            style={{ ...(color ? { color } : null), ...(fijado ? { borderLeft: "3px solid var(--ambar)", background: "#FFFDF7" } : null) }}
          />
        )}
        {fijado && (
          <button
            type="button"
            onClick={onSoltar}
            title="Soltar: el precio queda a mano donde está"
            aria-label={`Soltar ${etiqueta.toLowerCase()}`}
            className="absolute -right-1 -top-1.5 rounded-full bg-white p-0.5"
            style={{ color: "var(--humo)", boxShadow: "0 0 0 1px var(--linea)" }}
          >
            <X size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

function PrecioDirecto({ v, onCambiar, onFijarObjetivo, onSoltarMargen }) {
  const objetivo = objetivoDirecto(v);
  const sinCosto = v.costo == null;
  const precio = Number(v.precioPublico) || 0;
  const ganancia = !sinCosto && precio > 0 ? precio - v.costo : null;
  const margen = ganancia != null ? ganancia / v.costo : null;
  const soltar = () => onSoltarMargen(v.id, precio);
  return (
    <div className="rounded-[4px] px-3 py-2" style={{ background: "var(--zona-directa)" }}>
      <h3 className="k-col mb-1" style={{ color: "var(--tinta)" }}>
        Venta directa
      </h3>
      <p className="mb-2 text-[11.5px]" style={{ color: "var(--humo)" }}>
        Escribí el precio, o fijá un margen o una ganancia y el precio sale solo (y sigue al costo).
      </p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <span className="k-col mb-0.5 block" style={{ color: "var(--humo)" }}>
            Precio{objetivo ? " · calculado" : ""}
          </span>
          {objetivo ? (
            <span className="k-num block px-2 py-1 text-right text-[13px] font-semibold" style={{ color: "var(--tinta)" }}>
              {precio > 0 ? pesos(precio) : "—"}
            </span>
          ) : (
            <NumberCell value={precio || 0} onChange={(x) => onCambiar(v.id, { precioPublico: x })} />
          )}
        </div>
        <CeldaObjetivo
          etiqueta="Margen"
          fijado={objetivo?.margen != null}
          valor={+(((objetivo?.margen ?? margen) || 0) * 100).toFixed(1)}
          onChange={(x) => onFijarObjetivo([v.id], { margen: x / 100 })}
          onSoltar={soltar}
          suffix="%"
          sinCosto={sinCosto}
        />
        <CeldaObjetivo
          etiqueta="Ganancia"
          fijado={objetivo?.ganancia != null}
          valor={Math.round(objetivo?.ganancia ?? ganancia ?? 0)}
          onChange={(x) => onFijarObjetivo([v.id], { ganancia: x })}
          onSoltar={soltar}
          color={colorGanancia(ganancia)}
          sinCosto={sinCosto}
        />
      </div>
    </div>
  );
}

function PrecioTN({ v, caja, ajustesTN, onCambiar, onCambiarCaja, onFijarObjetivoTN, onSoltarMargenTN, conectado, variante, productosLeidos, aviso, onCrearEnTN, onDesvincular }) {
  const objetivo = objetivoTN(v);
  const sinCosto = v.costo == null;
  const precio = Number(v.precioTN) || 0;
  const formas = ajustesTN?.formas ?? [];
  const tn = !sinCosto && precio > 0 ? analisisTiendaNube({ costo: v.costo, precio, ajustesTN, formaId: objetivo?.formaId }) : null;
  const manda = tn && tn.manda >= 0 ? tn.formas[tn.manda] : null;
  const ganancia = manda?.ganancia ?? null;
  const margen = manda?.margen ?? null;
  const formaId = caja.formaTN ?? "";
  const igualando = objetivo?.igualarDirecto === true;
  const soltar = () => onSoltarMargenTN(v.id, precio);
  const vinculo = vinculoTN(caja);
  const publicado = variante ? variante.promocional ?? variante.precio : null;

  return (
    <div className="rounded-[4px] px-3 py-2" style={{ background: "var(--zona-tn)" }}>
      <h3 className="k-col mb-1" style={{ color: "var(--tinta)" }}>
        Tiendanube
      </h3>
      <p className="mb-2 text-[11.5px]" style={{ color: "var(--humo)" }}>
        Margen y ganancia de la forma de pago {formaId ? "elegida" : "que menos deja"}
        {manda ? ` (${manda.forma.nombre})` : ""}. Redondea con el redondeo de los decants.
      </p>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <span className="k-col mb-0.5 block" style={{ color: "var(--humo)" }}>
            Precio{objetivo ? " · calculado" : ""}
          </span>
          {objetivo ? (
            <span className="k-num block px-2 py-1 text-right text-[13px] font-semibold" style={{ color: "var(--tinta)" }}>
              {precio > 0 ? pesos(precio) : "—"}
            </span>
          ) : (
            <NumberCell value={precio || 0} onChange={(x) => onCambiar(v.id, { precioTN: x })} />
          )}
        </div>
        <CeldaObjetivo
          etiqueta="Margen"
          fijado={objetivo?.margen != null}
          valor={+(((objetivo?.margen ?? margen) || 0) * 100).toFixed(1)}
          onChange={(x) => onFijarObjetivoTN([v.id], { margen: x / 100 })}
          onSoltar={soltar}
          suffix="%"
          sinCosto={sinCosto}
        />
        <CeldaObjetivo
          etiqueta="Ganancia"
          fijado={objetivo?.ganancia != null}
          valor={Math.round(objetivo?.ganancia ?? ganancia ?? 0)}
          onChange={(x) => onFijarObjetivoTN([v.id], { ganancia: x })}
          onSoltar={soltar}
          color={colorGanancia(ganancia)}
          sinCosto={sinCosto}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]" style={{ color: "var(--humo)" }}>
        <label className="flex items-center gap-1.5">
          Medido contra
          <select
            value={formaId}
            onChange={(e) => onCambiarCaja({ formaTN: e.target.value || undefined })}
            className="max-w-[200px] rounded-[3px] border px-1.5 py-[4px] text-[12px]"
            style={selectorEstilo}
          >
            {!igualando && <option value="">la que menos deja</option>}
            {formas.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre}
              </option>
            ))}
          </select>
        </label>
        {igualando ? (
          <span className="flex items-center gap-1" style={{ color: "var(--tinta)" }}>
            esa forma paga lo mismo que la venta directa
            <button onClick={soltar} title="Dejar de igualar: el precio queda a mano" className="rounded-full bg-white p-0.5" style={{ boxShadow: "0 0 0 1px var(--linea)" }}>
              <X size={10} />
            </button>
          </span>
        ) : (
          formas.length > 0 &&
          Number(v.precioPublico) > 0 && (
            <button
              onClick={() => onFijarObjetivoTN([v.id], { igualarDirecto: true, formaId: formaId || formas[0].id })}
              className="k-col rounded-[3px] border px-2 py-[3px]"
              style={{ borderColor: "var(--linea)", color: "var(--tinta)" }}
            >
              Igualar a venta directa
            </button>
          )
        )}
      </div>

      {/* El producto en la tienda */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-2 text-[12px]" style={{ borderColor: "var(--zona-tn-honda)" }}>
        {vinculo ? (
          <>
            <span style={{ color: "var(--humo)" }}>En Tiendanube:</span>
            {!productosLeidos ? (
              <span style={{ color: "var(--humo)" }}>vinculado</span>
            ) : variante ? (
              <span className="k-num" style={{ color: publicado === precio ? "var(--verde)" : "var(--oxido)" }}>
                {pesos(publicado)}
                {publicado !== precio ? ` · la app dice ${pesos(precio)}: mandalo con Actualizar precios (pestaña Tiendanube, modo Cajas)` : " · coincide"}
              </span>
            ) : (
              <span style={{ color: "var(--oxido)" }}>el producto ya no aparece en la tienda</span>
            )}
            <button onClick={onDesvincular} className="k-col ml-auto rounded-[3px] px-2 py-[3px]" style={{ color: "var(--humo)" }}>
              Desvincular
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onCrearEnTN}
              disabled={!conectado || !(precio > 0)}
              className="k-col rounded-[3px] border px-2 py-[4px] disabled:opacity-50"
              style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}
            >
              Crear en Tiendanube
            </button>
            <span style={{ color: "var(--humo)" }}>
              {!conectado
                ? "Conectá Tiendanube (pestaña Tiendanube) para crear el producto."
                : !(precio > 0)
                  ? "Ponele precio de Tiendanube primero."
                  : "Crea un producto nuevo en la tienda real, con este precio. Si ya lo creaste a mano, vinculalo desde la pestaña Tiendanube, modo Cajas."}
            </span>
          </>
        )}
      </div>
      {aviso && (
        <p className="mt-1 text-[12px]" style={{ color: aviso.ok ? "var(--verde)" : aviso.texto === "Creando…" ? "var(--humo)" : "var(--oxido)" }}>
          {aviso.texto}
        </p>
      )}
    </div>
  );
}

/* El cuerpo del diálogo de crear: nombre, stock, categoría, si se publica
   visible, y la descripción precargada con la lista de perfumes. Avisa cada
   cambio por `onCambio` (App lee lo último al aceptar). */
function CuerpoCrear({ inicial, precio, categorias, onCambio }) {
  const [v, setV] = useState(inicial);
  const cambiar = (campos) => {
    const nuevo = { ...v, ...campos };
    setV(nuevo);
    onCambio(nuevo);
  };
  const campo = "w-full rounded-[3px] border px-2 py-1.5 text-[12.5px]";
  return (
    <div className="grid gap-2.5">
      <p>
        Se crea un producto nuevo en la <strong>tienda real</strong>, a <span className="k-num">{pesos(precio)}</span>. Las fotos se
        agregan después en el panel de Tiendanube.
      </p>
      <label className="grid gap-1">
        <span className="k-col">Nombre del producto</span>
        <input value={v.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} className={campo} style={selectorEstilo} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1">
          <span className="k-col">Stock</span>
          <input
            value={v.stock}
            onChange={(e) => cambiar({ stock: e.target.value.replace(/\D/g, "") })}
            placeholder="sin límite"
            inputMode="numeric"
            className={`${campo} k-num`}
            style={selectorEstilo}
          />
          <span className="text-[11px]">Vacío = sin llevar la cuenta.</span>
        </label>
        <label className="grid gap-1">
          <span className="k-col">Categoría</span>
          <select value={v.categoria} onChange={(e) => cambiar({ categoria: e.target.value })} className={campo} style={selectorEstilo}>
            <option value="">sin categoría</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="grid gap-1">
        <span className="k-col">Descripción</span>
        <textarea value={v.descripcion} onChange={(e) => cambiar({ descripcion: e.target.value })} rows={7} className={campo} style={selectorEstilo} />
        <span className="text-[11px]">Los renglones que empiezan con "-" van como lista.</span>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={v.publicado} onChange={(e) => cambiar({ publicado: e.target.checked })} />
        Publicarlo visible ya (si no, nace oculto hasta que le agregues fotos)
      </label>
    </div>
  );
}
