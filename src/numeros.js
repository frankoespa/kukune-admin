/* ============================================================
   Números al modo argentino. Puro, sin React: se puede probar desde Node.
   ============================================================ */

/* Lee lo que se tipeó en un campo de número.

   La coma es el decimal, como en cualquier campo de esta app. El punto se deja
   tal cual: "38.155" es treinta y ocho con ciento cincuenta y cinco, no treinta
   y ocho mil. Se intentó interpretarlo como separador de miles y se volvió atrás
   a propósito: la regla necesaria para distinguir "38.155" (miles) de "15.32"
   (decimal) es sutil y nadie la tiene en la cabeza cuando algo sale raro.

   Si alguien carga un costo con punto de miles, el margen sale enorme — y por
   eso los porcentajes se muestran sin agrupar, para que ese error se vea. */
export function aNumero(texto) {
  const n = parseFloat(String(texto ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/* Porcentaje sin separador de miles: un margen de 117840% escrito "117.840%"
   se lee como 117,8% y engaña. Sin agrupar no hay confusión posible. */
export function pctSinMiles(n, decimales = 0) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("es-AR", {
    style: "percent",
    useGrouping: false,
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  }).format(n);
}
