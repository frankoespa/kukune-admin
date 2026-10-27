import { useState } from "react";
import { NumberCell } from "./NumberCell";

// Local y no importado de `Catalogo.jsx`: el catálogo importa este archivo.
const pesos = (n) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0
  );

/* Fijar el mismo objetivo en todos los perfumes que se ven (los que tienen
   costo): un margen, una ganancia fija en pesos o —solo en Tiendanube— igualar
   lo que paga una forma de pago al precio de venta directa. Pisa también los de
   precio a mano —decisión de Franco— y por eso confirma diciendo cuántos son.

   Lo usan el catálogo (venta directa) y Tiendanube. Solo Tiendanube pasa
   `formas`, y ahí aparecen "Medido contra" e "Igualar a venta directa";
   `onFijar` recibe los ids y `{margen | ganancia | igualarDirecto, formaId}`.
   `esAMano(p)` dice qué perfume tiene hoy el precio puesto a mano, `zona` es el
   color del canal y `avisoFinal` cierra el texto de la confirmación. */
export default function AplicarATodos({
  perfumes,
  filtrado,
  formas,
  onFijar,
  onConfirmar,
  esAMano,
  zona,
  avisoFinal = "",
}) {
  const [tipo, setTipo] = useState("margen");
  const [valor, setValor] = useState(0);
  const [formaId, setFormaId] = useState("");
  if (!onFijar) return null;

  const igualar = tipo === "igualar";
  const conCosto = perfumes.filter((p) => Number(p.costo) > 0);
  /* Igualar necesita el precio de venta directa: sin él no hay nada que igualar,
     así que esos quedan afuera en vez de guardarles un objetivo que no se puede
     resolver. */
  const alcanzados = igualar ? conCosto.filter((p) => Number(p.precioPublico) > 0) : conCosto;
  const sinDirecto = conCosto.length - alcanzados.length;
  const aMano = alcanzados.filter(esAMano).length;
  const sinCosto = perfumes.length - conCosto.length;
  const forma = formas?.find((f) => f.id === formaId);
  const listo = alcanzados.length > 0 && (igualar ? !!forma : valor > 0);
  const texto = igualar
    ? `el precio que hace que "${forma?.nombre ?? ""}" le cobre al cliente lo mismo que la venta directa`
    : tipo === "margen"
      ? `${String(valor).replace(".", ",")}% de margen`
      : `${pesos(valor)} de ganancia fija`;

  const aplicar = () =>
    onConfirmar({
      titulo: `Aplicar a ${alcanzados.length} perfumes`,
      texto:
        `Todos quedan con ${texto}` +
        (formas && !igualar ? `, medido contra ${forma ? `"${forma.nombre}"` : "la forma de pago que menos deja"}` : "") +
        ". " +
        (igualar ? "La comisión y el envío gratis salen de tu ganancia, así que en Tiendanube vas a ganar menos que vendiendo directo. " : "") +
        (aMano === 1
          ? "1 tenía el precio puesto a mano y pasa a calcularse. "
          : aMano
            ? `${aMano} tenían el precio puesto a mano y pasan a calcularse. `
            : "") +
        (sinDirecto ? `${sinDirecto} sin precio de venta directa no se tocan. ` : "") +
        (sinCosto ? `${sinCosto} sin costo no se tocan. ` : "") +
        (filtrado ? "Solo los que coinciden con la búsqueda. " : "") +
        avisoFinal,
      etiquetaOk: "Aplicar",
      onAceptar: () =>
        onFijar(
          alcanzados.map((p) => p.id),
          igualar
            ? { igualarDirecto: true, formaId }
            : tipo === "margen"
              ? { margen: valor / 100, formaId: formaId || null }
              : { ganancia: valor, formaId: formaId || null }
        ),
    });

  const boton = (t, etiqueta) => (
    <button
      type="button"
      onClick={() => setTipo(t)}
      className="k-col px-2.5 py-[6px] transition"
      style={tipo === t ? { background: "var(--tinta)", color: "var(--papel)" } : { color: "var(--humo)" }}
    >
      {etiqueta}
    </button>
  );

  return (
    <div
      className="mb-5 flex flex-wrap items-end gap-3 rounded-[4px] border px-4 py-3"
      style={{ borderColor: "var(--linea)", background: zona }}
    >
      <div>
        <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
          Aplicar a todos
        </span>
        <div className="flex overflow-hidden rounded-[3px] border" style={{ borderColor: "var(--linea)", background: "var(--papel)" }}>
          {boton("margen", "Margen")}
          {boton("ganancia", "Ganancia fija")}
          {formas && boton("igualar", "Igualar a venta directa")}
        </div>
      </div>
      {/* Igualar no tiene número que escribir: el objetivo es el precio directo. */}
      {!igualar && (
        <label className="block w-[120px]">
          <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
            {tipo === "margen" ? "Margen" : "Ganancia por venta"}
          </span>
          <NumberCell value={valor} onChange={(v) => setValor(Math.max(0, v))} suffix={tipo === "margen" ? "%" : "$"} />
        </label>
      )}
      {formas && (
        <label className="block">
          <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
            {igualar ? "Que pague como directo" : "Medido contra"}
          </span>
          <select
            value={formaId}
            onChange={(e) => setFormaId(e.target.value)}
            className="rounded-[3px] border px-2 py-[6px] text-[12.5px]"
            style={{ borderColor: "var(--linea)", background: "var(--papel)", color: "var(--tinta)" }}
          >
            {/* Igualar "la que menos deja" no significa nada: hay que elegir una. */}
            <option value="">{igualar ? "Elegí la forma de pago" : "La forma de pago que menos deja"}</option>
            {formas.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre}
              </option>
            ))}
          </select>
        </label>
      )}
      <button
        type="button"
        onClick={aplicar}
        disabled={!listo}
        className="rounded-[3px] px-3.5 py-[7px] text-[12.5px] font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-40"
        style={{ background: "var(--tinta)" }}
      >
        Aplicar a {alcanzados.length} perfumes{filtrado ? " (los de la búsqueda)" : ""}
      </button>
      <span className="basis-full text-[11.5px]" style={{ color: "var(--humo)" }}>
        {igualar
          ? "El precio de Tiendanube sale del de venta directa: si ese se mueve, este se mueve solo. Así el que mira la tienda y paga con esa forma no ve un precio más alto que comprándote directo."
          : "La ganancia fija queda en pesos: si cambia el costo, se mueve el precio y la ganancia sigue igual."}{" "}
        Pisa también los precios puestos a mano.
      </span>
    </div>
  );
}
