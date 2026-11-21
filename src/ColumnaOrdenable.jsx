import { etiquetaDeOrden } from "./orden";

/* ============================================================
   El encabezado de una columna que se puede ordenar.

   Compartido por las cuatro tablas (catálogo, Mercado Libre, Tiendanube y
   decants) para que el gesto sea el mismo en todas: un clic ordena de menor a
   mayor, otro invierte.

   Es un `<button>` de verdad —se llega con Tab y se activa con Enter—, no un
   `span` con un handler. La flecha ocupa su lugar siempre (apagada, al 40% al
   pasar el mouse, entera en la columna que manda): así el encabezado no se
   mueve al tocarlo y se ve que las columnas se pueden tocar sin tener que
   descubrirlo de casualidad.

   Sin `clave` o sin `onOrdenar` devuelve el rótulo de siempre, para las
   columnas que no son un número (la casilla de un decant, una foto).
   ============================================================ */
export function ColumnaOrdenable({
  texto,
  clave,
  orden,
  onOrdenar,
  fondo = "transparent",
  alineado = "text-right",
  // Para las columnas que se repiten: en Mercado Libre hay un "Precio" por
  // plan de cuotas, y en pantalla se distinguen por la banda de arriba. Un
  // lector de pantalla no la lee, así que el plan va en el nombre del botón.
  contexto,
}) {
  if (!clave || !onOrdenar) {
    return (
      <span
        className={`k-col px-2 py-1.5 ${alineado}`}
        style={{ background: fondo, color: "var(--humo)" }}
      >
        {texto}
      </span>
    );
  }

  const activa = orden?.col === clave;
  const derecha = alineado === "text-right";
  return (
    <button
      type="button"
      onClick={() => onOrdenar(clave)}
      aria-label={etiquetaDeOrden(orden, clave, contexto ? `${texto} de ${contexto}` : texto)}
      className={`k-col group/orden flex w-full items-center gap-1 px-2 py-1.5 transition ${
        derecha ? "justify-end" : ""
      }`}
      style={{ background: fondo, color: activa ? "var(--tinta)" : "var(--humo)" }}
    >
      <span className={`truncate ${derecha ? "order-2" : ""}`}>{texto}</span>
      <span
        aria-hidden="true"
        className={`text-[8px] leading-none transition ${derecha ? "order-1" : ""} ${
          activa ? "opacity-100" : "opacity-0 group-hover/orden:opacity-40"
        }`}
      >
        {activa && orden.dir === "desc" ? "▼" : "▲"}
      </span>
    </button>
  );
}
