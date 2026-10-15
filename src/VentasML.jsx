import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { urlFoto } from "./almacenamiento";
import { pctSinMiles as pctCorto } from "./numeros";
import { ConVistaPrevia, pesos } from "./Catalogo";
import { leerVentasML, nombreDePlan } from "./clienteML";
import { gananciasDeVentas, nombreDeImpuesto } from "./gananciasML";

/* ============================================================
   Ventas de Mercado Libre y lo que dejaron. SOLO LECTURA: trae órdenes y
   costos de envío de ML y no escribe nada, ni en ML ni en el catálogo.

   Las cuentas están en `gananciasDeVentas` (gananciasML.js). Recibe la lista
   RESUELTA del catálogo: el vínculo publicación → perfume sale de ahí, y el
   costo de cada venta es el que regía cuando se vendió (`historialCostos`).
   ============================================================ */

const ZONA = "America/Argentina/Buenos_Aires";

// AAAA-MM-DD en hora de Argentina (en-CA formatea justo así).
const diaAR = (d) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const fechaCorta = (iso) =>
  iso
    ? new Intl.DateTimeFormat("es-AR", {
        timeZone: ZONA,
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(new Date(iso))
    : "—";

const fechaLarga = (iso) =>
  new Intl.DateTimeFormat("es-AR", { timeZone: ZONA, dateStyle: "short", timeStyle: "short" }).format(
    new Date(iso)
  );

function rangoDe(atajo) {
  const hoy = diaAR(new Date());
  const [a, m] = hoy.split("-").map(Number);
  const dd = (n) => String(n).padStart(2, "0");
  if (atajo === "mes") return { desde: `${a}-${dd(m)}-01`, hasta: hoy };
  if (atajo === "mesPasado") {
    const am = m === 1 ? a - 1 : a;
    const mm = m === 1 ? 12 : m - 1;
    const ultimo = new Date(Date.UTC(am, mm, 0)).getUTCDate();
    return { desde: `${am}-${dd(mm)}-01`, hasta: `${am}-${dd(mm)}-${dd(ultimo)}` };
  }
  return { desde: diaAR(new Date(Date.now() - 29 * 864e5)), hasta: hoy };
}

const ATAJOS = [
  ["mes", "Este mes"],
  ["mesPasado", "Mes pasado"],
  ["30", "Últimos 30 días"],
];

// fecha · foto · perfume · plan · cant · ingreso · comisión · envío · impuestos · costo · ganancia · margen
const COLUMNAS_VINCULADAS = "104px 52px minmax(180px,1fr) 84px 52px 104px 96px 88px 92px 104px 104px 72px";
// fecha · publicación · MLA · cant · ingreso · comisión · envío · impuestos · te queda
const COLUMNAS_SUELTAS = "104px minmax(240px,1fr) 128px 52px 104px 96px 88px 92px 104px";

const colorGanancia = (g) => (g == null ? "var(--humo-claro)" : g >= 0 ? "var(--ambar)" : "var(--oxido)");

export default function VentasML({ perfumes, cuenta }) {
  const [rango, setRango] = useState(() => rangoDe("mes"));
  const [datos, setDatos] = useState(null); // { ordenes, envios, total, truncado }
  const [trayendo, setTrayendo] = useState(false);
  const [error, setError] = useState("");
  const conectado = !!cuenta?.conectado;

  const traer = useCallback(async ({ desde, hasta }) => {
    setTrayendo(true);
    setError("");
    try {
      setDatos(await leerVentasML(desde, hasta));
    } catch (e) {
      setError(`No se pudieron traer las ventas (${e.message}).`);
    } finally {
      setTrayendo(false);
    }
  }, []);

  // Al entrar (o al conectar) se trae el mes en curso. Después, solo con Traer.
  useEffect(() => {
    if (conectado) traer(rangoDe("mes"));
  }, [conectado, traer]);

  const r = useMemo(
    () => (datos ? gananciasDeVentas(datos.ordenes, datos.envios, perfumes, datos.pagos) : null),
    [datos, perfumes]
  );

  const boton =
    "k-col flex items-center gap-1.5 whitespace-nowrap rounded-[3px] border px-3 py-[7px] transition disabled:cursor-not-allowed disabled:opacity-40";

  if (!conectado)
    return (
      <p className="py-12 text-center text-[13px]" style={{ color: "var(--humo-claro)" }}>
        Conectá Mercado Libre (arriba) para ver las ventas.
      </p>
    );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {[
          ["desde", "Desde"],
          ["hasta", "Hasta"],
        ].map(([campo, rotulo]) => (
          <label key={campo} className="block">
            <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
              {rotulo}
            </span>
            <input
              type="date"
              value={rango[campo]}
              onChange={(e) => setRango((x) => ({ ...x, [campo]: e.target.value }))}
              className="k-num rounded-[3px] border px-2 py-1 text-[12.5px]"
              style={{ background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" }}
            />
          </label>
        ))}
        <div className="flex items-center gap-1.5">
          {ATAJOS.map(([id, texto]) => (
            <button
              key={id}
              onClick={() => {
                const nuevo = rangoDe(id);
                setRango(nuevo);
                traer(nuevo);
              }}
              className={boton}
              style={{ borderColor: "var(--linea)", color: "var(--humo)" }}
            >
              {texto}
            </button>
          ))}
        </div>
        <button
          onClick={() => traer(rango)}
          disabled={trayendo || !rango.desde || !rango.hasta}
          className={boton}
          style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}
        >
          <RefreshCw size={14} className={trayendo ? "animate-spin" : ""} /> Traer
        </button>
      </div>

      {error && (
        <p className="mb-4 text-[12.5px]" style={{ color: "var(--oxido)" }}>
          {error}
        </p>
      )}

      {!r ? (
        <p className="py-12 text-center text-[13px]" style={{ color: "var(--humo-claro)" }}>
          {trayendo ? "Trayendo ventas de Mercado Libre…" : "Elegí un período y tocá Traer."}
        </p>
      ) : (
        <>
          <Totales r={r} truncado={datos.truncado} total={datos.total} />
          <TablaVinculadas filas={r.vinculadas} />
          <TablaSueltas filas={r.sinVincular} />
        </>
      )}
    </div>
  );
}

function Totales({ r, truncado, total }) {
  const t = r.totales;
  const cifra = (rotulo, valor, { color, titulo } = {}) => (
    <div className="px-3 py-2" title={titulo}>
      <span className="k-col mb-0.5 block" style={{ color: "var(--humo)" }}>
        {rotulo}
      </span>
      <span className="k-num text-[15px] font-semibold" style={{ color: color ?? "var(--tinta)" }}>
        {valor}
      </span>
    </div>
  );

  const notas = [
    truncado && `Se muestran las ${t.ventas} más recientes de ${total}: achicá el período para ver todas.`,
    t.sinCosto > 0 &&
      `${t.sinCosto} venta${t.sinCosto === 1 ? "" : "s"} de perfumes sin costo en el catálogo no entra${
        t.sinCosto === 1 ? "" : "n"
      } en la ganancia.`,
    t.sinVincular > 0 &&
      `${t.sinVincular} de publicaciones sin vincular: suman al ingreso, la comisión, el envío y los impuestos, no a la ganancia.`,
    t.costoAproximado > 0 &&
      `${t.costoAproximado} con costo aproximado (~): se vendieron antes de que el perfume tuviera historial de costos.`,
    t.sinEnvio > 0 && `${t.sinEnvio} sin el costo del envío: ML no lo devolvió y se cuentan sin él.`,
    t.comisionNoCierra > 0 &&
      `${t.comisionNoCierra} orden${t.comisionNoCierra === 1 ? "" : "es"} donde la comisión por ítem no coincide con la de los pagos (marcadas en la tabla).`,
    (r.excluidas.canceladas > 0 || r.excluidas.sinPagar > 0) &&
      `No se cuentan ${r.excluidas.canceladas} cancelada${r.excluidas.canceladas === 1 ? "" : "s"} y ${
        r.excluidas.sinPagar
      } sin pagar.`,
    t.sinImpuestos > 0 &&
      `${t.sinImpuestos} sin los impuestos: Mercado Pago no devolvió el pago y se cuentan sin ellos.`,
  ].filter(Boolean);

  return (
    <div className="mb-5 rounded-[4px] border" style={{ borderColor: "var(--zona-ml-honda)", background: "var(--zona-ml)" }}>
      <div className="flex flex-wrap">
        {cifra("Ventas", t.ventas)}
        {cifra("Unidades", t.unidades)}
        {cifra("Ingreso", pesos(t.ingreso))}
        {cifra("Comisión ML", pesos(t.comision))}
        {cifra("Envío", pesos(t.envio))}
        {cifra("Impuestos", pesos(t.impuestos), {
          titulo: "Retenciones e impuestos que Mercado Pago descontó de cada cobro (IIBB y demás)",
        })}
        {cifra("Costo", pesos(t.costo), {
          titulo: `Costo del catálogo de las ${t.conGanancia} ventas con costo, al momento de cada venta`,
        })}
        {cifra("Ganancia", pesos(t.ganancia), {
          color: colorGanancia(t.conGanancia ? t.ganancia : null),
          titulo: `Sobre ${t.conGanancia} venta${t.conGanancia === 1 ? "" : "s"} con perfume vinculado y con costo`,
        })}
        {cifra("Margen", t.margen == null ? "—" : pctCorto(t.margen, 1))}
      </div>
      <ul className="border-t px-3 py-2 text-[11.5px]" style={{ borderColor: "var(--zona-ml-honda)", color: "var(--humo)" }}>
        {notas.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

function Encabezado({ columnas, titulos }) {
  return (
    <div
      className="sticky top-0 z-[5] grid items-center border border-transparent pb-1.5 pt-1"
      style={{ gridTemplateColumns: columnas, background: "var(--vidrio)" }}
    >
      {titulos.map(([texto, alineado], i) => (
        <span key={i} className={`k-col px-2 py-1.5 ${alineado ?? "text-right"}`} style={{ color: "var(--humo)" }}>
          {texto}
        </span>
      ))}
    </div>
  );
}

const Cifra = ({ children, color, titulo, fuerte }) => (
  <div className="px-2 text-right" title={titulo}>
    <span className={`k-num text-[13px] ${fuerte ? "font-semibold" : ""}`} style={{ color: color ?? "var(--humo)" }}>
      {children}
    </span>
  </div>
);

const avisosDeFila = (f) =>
  [
    f.reintegroParcial && "Con reintegro parcial: el ingreso es el de la orden, ML pudo haber devuelto parte.",
    f.comisionNoCierra && "La comisión por ítem no coincide con la que ML descontó en los pagos de esta orden.",
  ].filter(Boolean);

function Fecha({ f }) {
  const avisos = avisosDeFila(f);
  return (
    <span
      className="k-num whitespace-nowrap px-2 text-[12px]"
      style={{ color: avisos.length ? "var(--oxido)" : "var(--humo)" }}
      title={[`Orden ${f.ordenId}`, ...avisos].join("\n")}
    >
      {fechaCorta(f.fecha)}
      {avisos.length ? " ·" : ""}
    </span>
  );
}

/* Lo que Mercado Pago descontó del cobro: retenciones de IIBB y demás. El
   detalle va en el title; si la orden se repartió entre varios ítems, es la
   parte de este. */
const Impuestos = ({ f }) => (
  <Cifra
    color={f.impuestosDesconocidos ? "var(--oxido)" : undefined}
    titulo={
      f.impuestosDesconocidos
        ? "Mercado Pago no devolvió el pago de esta venta: la cuenta va sin impuestos"
        : f.detalleImpuestos.length
        ? f.detalleImpuestos.map((x) => `${nombreDeImpuesto(x.nombre)}: ${pesos(x.monto)}`).join("\n") +
          (f.detalleImpuestos.reduce((s, x) => s + x.monto, 0) !== f.impuestos
            ? "\n(de toda la orden; esta es la parte de este ítem)"
            : "")
        : "Mercado Pago no descontó impuestos en este cobro"
    }
  >
    {f.impuestosDesconocidos ? "?" : pesos(f.impuestos)}
  </Cifra>
);

const Envio = ({ f }) => (
  <Cifra
    color={f.envioDesconocido ? "var(--oxido)" : undefined}
    titulo={
      f.envioDesconocido
        ? "ML no devolvió el costo de este envío: la cuenta va sin él"
        : f.packId
        ? "Envío compartido con otras órdenes del mismo carrito: esta es su parte, por ingreso"
        : "Lo que ML le cobró al vendedor por el envío"
    }
  >
    {f.envioDesconocido ? "?" : pesos(f.envio)}
  </Cifra>
);

function TablaVinculadas({ filas }) {
  if (!filas.length)
    return (
      <p className="mb-6 py-6 text-center text-[13px]" style={{ color: "var(--humo-claro)" }}>
        Ninguna venta de publicaciones vinculadas en este período.
      </p>
    );
  return (
    <div className="mb-8 overflow-x-auto pb-2">
      <div style={{ minWidth: 1200 }}>
        <Encabezado
          columnas={COLUMNAS_VINCULADAS}
          titulos={[
            ["Fecha", "text-left"],
            [""],
            ["Perfume", "text-left"],
            ["Plan", "text-left"],
            ["Cant."],
            ["Ingreso"],
            ["Comisión"],
            ["Envío"],
            ["Impuestos"],
            ["Costo"],
            ["Ganancia"],
            ["Margen"],
          ]}
        />
        <ul className="grid gap-1.5">
          {filas.map((f) => (
            <li
              key={f.clave}
              className="grid items-center overflow-hidden rounded-[4px] border py-1.5"
              style={{ gridTemplateColumns: COLUMNAS_VINCULADAS, borderColor: "var(--linea)", background: "var(--zona-ml)" }}
            >
              <Fecha f={f} />
              <div className="px-1.5">
                <ConVistaPrevia archivo={f.foto} nombre={f.nombre}>
                  <div
                    className="h-[40px] w-[40px] overflow-hidden rounded-[3px] border"
                    style={{
                      borderColor: "var(--linea)",
                      borderStyle: f.foto ? "solid" : "dashed",
                      background: "var(--papel)",
                    }}
                  >
                    {f.foto && (
                      <img src={urlFoto(f.foto)} alt={`Foto de ${f.nombre}`} className="h-full w-full object-cover" />
                    )}
                  </div>
                </ConVistaPrevia>
              </div>
              <span className="truncate px-2 text-[13px]" style={{ color: "var(--tinta)" }} title={`${f.nombre} · ${f.titulo} (${f.itemId})`}>
                {f.nombre}
              </span>
              <span
                className="px-2 text-[12px] leading-tight"
                style={{ color: "var(--humo)" }}
                title={f.catalogo ? "Vendido por la publicación de catálogo de este plan" : undefined}
              >
                {nombreDePlan(f.plan)}
                {f.catalogo && <span className="block text-[10.5px]">catálogo</span>}
              </span>
              <Cifra color="var(--tinta)">{f.cantidad}</Cifra>
              <Cifra color="var(--tinta)">{pesos(f.ingreso)}</Cifra>
              <Cifra>{pesos(f.comision)}</Cifra>
              <Envio f={f} />
              <Impuestos f={f} />
              <Cifra
                color={f.costo == null ? "var(--humo-claro)" : f.costoAproximado ? "var(--humo)" : "var(--tinta)"}
                titulo={
                  f.costo == null
                    ? "El perfume no tenía costo en el catálogo cuando se vendió: cargalo para ver la ganancia"
                    : f.costoAproximado
                    ? `${pesos(f.costoUnitario)} por unidad: es el costo que había antes de empezar el historial de costos. Pudo haber sido otro cuando se vendió.`
                    : `${pesos(f.costoUnitario)} por unidad: el costo del catálogo vigente el ${fechaLarga(f.fecha)}`
                }
              >
                {f.costo == null ? "—" : `${f.costoAproximado ? "~" : ""}${pesos(f.costo)}`}
              </Cifra>
              <Cifra
                color={colorGanancia(f.ganancia)}
                fuerte
                titulo={
                  f.ganancia == null
                    ? "Sin costo no hay ganancia que mostrar"
                    : `${pesos(f.ingreso)} − comisión ${pesos(f.comision)} − envío ${pesos(f.envio)} − impuestos ${pesos(f.impuestos)} − costo ${pesos(f.costo)}`
                }
              >
                {f.ganancia == null ? "—" : pesos(f.ganancia)}
              </Cifra>
              <Cifra>{f.margen == null ? "—" : pctCorto(f.margen, 1)}</Cifra>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* Ventas de publicaciones que ningún perfume tiene vinculadas: lo que ML dice
   (ingreso, comisión, envío) sí, el costo no se inventa. */
function TablaSueltas({ filas }) {
  if (!filas.length) return null;
  return (
    <div className="mb-6">
      <h3 className="k-rotulo mb-1">Ventas de publicaciones sin vincular</h3>
      <p className="mb-3 text-[12px]" style={{ color: "var(--humo)" }}>
        Sin vínculo no hay costo, así que no hay ganancia. Vinculá la publicación en Precios (columna
        En ML; la de catálogo va en el renglón chico de abajo) para verla.
      </p>
      <div className="overflow-x-auto pb-2">
        <div style={{ minWidth: 1080 }}>
          <Encabezado
            columnas={COLUMNAS_SUELTAS}
            titulos={[
              ["Fecha", "text-left"],
              ["Publicación", "text-left"],
              ["Id", "text-left"],
              ["Cant."],
              ["Ingreso"],
              ["Comisión"],
              ["Envío"],
              ["Impuestos"],
              ["Te queda"],
            ]}
          />
          <ul className="grid gap-1.5">
            {filas.map((f) => (
              <li
                key={f.clave}
                className="grid items-center overflow-hidden rounded-[4px] border py-1.5"
                style={{ gridTemplateColumns: COLUMNAS_SUELTAS, borderColor: "var(--linea)", background: "var(--papel)" }}
              >
                <Fecha f={f} />
                <span className="truncate px-2 text-[13px]" style={{ color: "var(--tinta)" }} title={f.titulo}>
                  {f.titulo}
                </span>
                <span className="k-num px-2 text-[12px]" style={{ color: "var(--humo)" }}>
                  {f.itemId}
                </span>
                <Cifra color="var(--tinta)">{f.cantidad}</Cifra>
                <Cifra color="var(--tinta)">{pesos(f.ingreso)}</Cifra>
                <Cifra>{pesos(f.comision)}</Cifra>
                <Envio f={f} />
                <Impuestos f={f} />
                {/* No es ganancia (falta el costo): va en tinta, no en ámbar. */}
                <Cifra color="var(--tinta)" titulo="Ingreso menos comisión, envío e impuestos, antes de restar el costo del perfume">
                  {pesos(f.neto)}
                </Cifra>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
