/* ============================================================
   Las dos medidas de una tabla, derivadas y no escritas a mano.

   **El ancho mínimo sale de la propia grilla.** Estaba escrito a mano en las
   cuatro pantallas y en el catálogo se había quedado corto: la grilla sumaba
   1216px y el `minWidth` decía 1120, así que a menos de 1216px de ventana la
   fila se recortaba (`overflow-hidden`) y el contenedor solo scrolleaba hasta
   donde le daba el encabezado: **la columna Usos quedaba cortada y el tacho no
   se alcanzaba nunca**. No es que estuviera apretado: no había forma de llegar.
   Mismo criterio que `ALTO_GRUPOS` en la mesa del pedido: un solo número, del
   que salen las dos cosas, para que no puedan desalinearse.

   **El alto máximo no es cosmético: es lo que hace que el encabezado se
   pegue.** `position: sticky` se pega al scrollport más cercano, y
   `overflow-x: auto` ya convierte al contenedor en uno (el navegador fuerza
   `overflow-y: auto`). Sin alto máximo ese contenedor nunca scrollea por
   dentro —su `scrollHeight` es igual a su `clientHeight`— así que el
   encabezado se pega a una caja que se va con la página. Medido en el catálogo
   antes de esto: con la página en 1500px de scroll, el encabezado estaba en
   `top: -837` y las 14 columnas no tenían nombre durante el 85% del recorrido.
   ============================================================ */

/* Suma los px de un `grid-template-columns`. `minmax(180px,1fr)` cuenta 180,
   que es el mínimo real de esa pista. */
export function anchoDeColumnas(columnas) {
  return String(columnas ?? "")
    .split(/\s+/)
    .reduce((total, pista) => {
      const m = pista.match(/(\d+(?:\.\d+)?)px/);
      return total + (m ? Number(m[1]) : 0);
    }, 0);
}

/* Lo mismo que usa la mesa del pedido, para que las cinco pantallas scrolleen
   igual. */
export const ALTO_TABLA = "calc(100vh - 5rem)";
