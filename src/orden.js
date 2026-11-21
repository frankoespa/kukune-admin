/* ============================================================
   Orden por columna de una tabla.

   Puro y sin imports, probado desde Node. Lo usan el catálogo y las pestañas
   de canal: todas tienen el mismo problema y conviene que se comporten igual.

   **La regla que importa: lo que no se sabe va SIEMPRE al final**, en los dos
   sentidos. Un perfume sin costo no es un costo de cero, y ordenando "de menor
   a mayor" no puede encabezar la lista como si fuera el más barato — es el
   mismo principio que hace que la celda muestre `—` y no 0. Lo mismo con el
   stock de un canal que todavía no se leyó (`null`) o que no lleva la cuenta
   (`"inf"`): no entran en la comparación.

   `valorDe(x)` devuelve el número o el texto por el que se ordena, o
   `null`/`undefined`/`NaN`/`"inf"` si para esa fila no se sabe.
   ============================================================ */

const SIN_DATO = (v) =>
  v === null ||
  v === undefined ||
  v === "inf" ||
  v === "" ||
  (typeof v === "number" && !Number.isFinite(v));

function comparar(a, b) {
  if (typeof a === "string" || typeof b === "string") {
    return String(a).localeCompare(String(b), "es", { sensitivity: "base", numeric: true });
  }
  return a - b;
}

export function ordenar(lista, valorDe, dir = "asc") {
  const con = [];
  const sin = [];
  for (const x of lista ?? []) (SIN_DATO(valorDe(x)) ? sin : con).push(x);
  const signo = dir === "desc" ? -1 : 1;
  con.sort((a, b) => comparar(valorDe(a), valorDe(b)) * signo);
  return con.concat(sin);
}

/* Un clic en una columna: si ya se está ordenando por ella, da vuelta el
   sentido; si no, la toma de cero en ascendente. Dos estados y no tres
   (asc/desc/apagado) porque "apagado" no significa nada visible: para volver al
   orden de siempre se toca la columna del nombre, que es el orden de siempre. */
export function siguienteOrden(actual, col) {
  if (actual?.col === col) return { col, dir: actual.dir === "asc" ? "desc" : "asc" };
  return { col, dir: "asc" };
}

/* El encabezado no es una `<table>` de verdad (es una grilla de `div`s), así
   que no se puede usar `aria-sort`, que solo vale sobre un `columnheader`.
   En vez de fingir esa semántica, el estado va escrito en el nombre accesible
   del botón, que es lo que de verdad lee un lector de pantalla. */
export function etiquetaDeOrden(actual, col, texto) {
  if (actual?.col !== col) return `${texto}: ordenar de menor a mayor`;
  return actual.dir === "asc"
    ? `${texto}: ordenado de menor a mayor. Tocá para invertirlo`
    : `${texto}: ordenado de mayor a menor. Tocá para invertirlo`;
}
