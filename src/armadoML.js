/* ============================================================
   Publicar un perfume en Mercado Libre: las cuentas puras.

   Sin imports a propósito: lo usan el server (ml-publicar.js, en Node) y el
   panel (PublicarML.jsx). Y se prueba desde Node. Se llama armadoML y no
   publicarML porque en Windows dos archivos que solo difieren en
   mayúsculas chocan (ver CLAUDE.md, clienteML.js y gananciasML.js).

   Lo que pide ML (categoría de perfumes MLA1271, cuenta en el modelo User
   Products):
   · `family_name` y NO `title`: ML arma el título.
   · Obligatorios: BRAND, PERFUME_NAME, UNIT_VOLUME y GTIN o EMPTY_GTIN_REASON.
   · Plan → tipo: 1 pago = gold_special; 6 cuotas = gold_pro sin tag;
     3/9/12 = gold_pro con 3x_/9x_/12x_campaign.
   ============================================================ */

export const CATEGORIA_PERFUMES = "MLA1271";

/* La ficha técnica que se carga a mano. `tipo`:
   texto · numero (con `unidad`) · lista (valores de ML) · multi (varios
   valores de la lista) · siono · notas (texto separado por comas, varios). */
export const CAMPOS_FICHA = [
  { id: "BRAND", nombre: "Marca", tipo: "texto", obligatorio: true },
  { id: "PERFUME_NAME", nombre: "Nombre del perfume", tipo: "texto", obligatorio: true },
  { id: "LINE", nombre: "Línea", tipo: "texto" },
  { id: "VERSION", nombre: "Versión", tipo: "texto" },
  { id: "UNIT_VOLUME", nombre: "Volumen", tipo: "numero", unidad: "mL", obligatorio: true },
  { id: "PERFUME_TYPE", nombre: "Tipo de perfume", tipo: "lista" },
  { id: "GENDER", nombre: "Género", tipo: "lista" },
  { id: "GTIN", nombre: "Código de barras (GTIN)", tipo: "texto" },
  { id: "EMPTY_GTIN_REASON", nombre: "Si no tiene código, por qué", tipo: "lista" },
  { id: "OLFACTORY_FAMILIES", nombre: "Familias olfativas", tipo: "multi" },
  { id: "OLFACTORY_NOTES", nombre: "Notas olfativas", tipo: "notas" },
  { id: "ORIGIN_COUNTRY", nombre: "País de origen", tipo: "texto" },
  { id: "APPROXIMATE_DURATION", nombre: "Duración aproximada", tipo: "numero", unidad: "h" },
  { id: "RELEASE_YEAR", nombre: "Año de lanzamiento", tipo: "numero" },
  { id: "INCLUDES_CASE", nombre: "Incluye estuche", tipo: "siono" },
  { id: "IS_REFILLABLE", nombre: "Es recargable", tipo: "siono" },
  { id: "IS_SET", nombre: "Es set", tipo: "siono" },
  { id: "IS_ALCOHOL_FREE", nombre: "Es libre de alcohol", tipo: "siono" },
];

const vacio = (v) =>
  v == null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);

/* Qué falta para que ML acepte la ficha. -> lista de nombres legibles. */
export function faltantes(ficha) {
  const f = ficha ?? {};
  const falta = CAMPOS_FICHA.filter((c) => c.obligatorio && vacio(f[c.id])).map((c) => c.nombre);
  if (vacio(f.GTIN) && vacio(f.EMPTY_GTIN_REASON)) falta.push("Código de barras o el motivo por el que no tiene");
  if (!vacio(f.UNIT_VOLUME) && !(Number(f.UNIT_VOLUME) > 0)) falta.push("Volumen (un número)");
  return falta;
}

/* La ficha como la espera ML: `value_name` para un valor, `values` para los
   multivaluados, "Sí"/"No" para los de sí o no, "100 mL" para los que llevan
   unidad. Lo vacío no se manda. */
export function atributosDeFicha(ficha) {
  const f = ficha ?? {};
  const salida = [];
  for (const c of CAMPOS_FICHA) {
    const v = f[c.id];
    if (vacio(v)) continue;
    if (c.tipo === "multi") salida.push({ id: c.id, values: v.map((name) => ({ name })) });
    else if (c.tipo === "notas") {
      const notas = String(v)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (notas.length) salida.push({ id: c.id, values: notas.map((name) => ({ name })) });
    } else if (c.tipo === "siono") salida.push({ id: c.id, value_name: v ? "Sí" : "No" });
    else if (c.tipo === "numero")
      salida.push({ id: c.id, value_name: c.unidad ? `${Number(v)} ${c.unidad}` : String(Number(v)) });
    else salida.push({ id: c.id, value_name: String(v).trim() });
  }
  return salida;
}

/* Plan de la app → tipo de publicación y tags de ML (doc "Campañas con cuotas
   para Marketplace"). El inverso de `cuotasDePublicacion` en clienteML.js. */
export function tipoDePlan(plan) {
  const n = Number(plan);
  if (n === 1) return { listing_type_id: "gold_special", tags: [] };
  if (n === 6) return { listing_type_id: "gold_pro", tags: [] };
  if ([3, 9, 12].includes(n)) return { listing_type_id: "gold_pro", tags: [`${n}x_campaign`] };
  throw new Error(`No sé publicar el plan ${plan}`);
}

/* Condiciones comunes a todas las publicaciones (`ajustes.publicacionML`).
   El arranque es lo que tiene la publicación real del Musamam. */
export const CONDICIONES_POR_DEFECTO = {
  garantiaTipo: "Garantía del vendedor",
  garantiaTiempo: "30 días",
  factura: "No factura",
  maxPorCompra: 2,
  paquete: { alto: 14, ancho: 19, largo: 14, peso: 700 }, // cm y g
};

export const condicionesDe = (ajustes) => ({
  ...CONDICIONES_POR_DEFECTO,
  ...(ajustes?.publicacionML ?? {}),
  paquete: { ...CONDICIONES_POR_DEFECTO.paquete, ...(ajustes?.publicacionML?.paquete ?? {}) },
});

/* El JSON de POST /items (y de /items/validate) para UN plan. `fotos` son los
   ids que devolvió /pictures/items/upload, en orden: la primera es la principal. */
export function cuerpoDeItem({ ficha, plan, precio, stock, familyName, fotos, condiciones }) {
  const c = condiciones ?? CONDICIONES_POR_DEFECTO;
  const { listing_type_id, tags } = tipoDePlan(plan);
  const saleTerms = [
    c.garantiaTipo && { id: "WARRANTY_TYPE", value_name: c.garantiaTipo },
    c.garantiaTiempo && { id: "WARRANTY_TIME", value_name: c.garantiaTiempo },
    c.factura && { id: "INVOICE", value_name: c.factura },
    Number(c.maxPorCompra) > 0 && { id: "PURCHASE_MAX_QUANTITY", value_name: String(Number(c.maxPorCompra)) },
  ].filter(Boolean);
  const p = c.paquete ?? {};
  const paquete = [
    ["SELLER_PACKAGE_HEIGHT", p.alto, "cm"],
    ["SELLER_PACKAGE_WIDTH", p.ancho, "cm"],
    ["SELLER_PACKAGE_LENGTH", p.largo, "cm"],
    ["SELLER_PACKAGE_WEIGHT", p.peso, "g"],
  ]
    .filter(([, v]) => Number(v) > 0)
    .map(([id, v, u]) => ({ id, value_name: `${Number(v)} ${u}` }));
  return {
    family_name: String(familyName ?? "").trim(),
    category_id: CATEGORIA_PERFUMES,
    price: Number(precio),
    currency_id: "ARS",
    available_quantity: Math.max(0, Math.round(Number(stock) || 0)),
    buying_mode: "buy_it_now",
    listing_type_id,
    condition: "new",
    ...(tags.length ? { tags } : {}),
    pictures: (fotos ?? []).map((id) => ({ id })),
    sale_terms: saleTerms,
    attributes: [...atributosDeFicha(ficha), ...paquete],
  };
}

/* ---------- publicacion.txt ----------
   Secciones en MAYÚSCULAS solas en su renglón ("DESCRIPCIÓN", "FICHA"…). Lo
   que va entre paréntesis después no cuenta: "SEO (Tiendanube > producto)"
   también es un título. */
function secciones(txt) {
  const salida = [];
  let actual = { titulo: "", lineas: [] };
  for (const linea of String(txt ?? "").replace(/\r/g, "").split("\n")) {
    const t = linea.trim();
    const cabeza = t.split("(")[0].trim();
    const esTitulo =
      cabeza.length > 2 && cabeza === cabeza.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{3}/.test(cabeza) && !/^[•\-*]/.test(t);
    if (esTitulo) {
      salida.push(actual);
      actual = { titulo: t, lineas: [] };
    } else actual.lineas.push(linea);
  }
  salida.push(actual);
  return salida.map((s) => ({ titulo: s.titulo, texto: s.lineas.join("\n").trim() }));
}

const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const esTitulo = (s) => /^TITULO/.test(sinTildes(s.titulo));
const esSEO = (s) => /^SEO/.test(sinTildes(s.titulo));
// "FICHA TÉCNICA DE ML (para completar los campos…)": datos para Franco, no
// para el comprador. La arma el skill fotos-mercadolibre en publicacion_ml.txt.
const esFichaML = (s) => /^FICHA TECNICA/.test(sinTildes(s.titulo));

/* La descripción para ML: el .txt sin el título del producto, lo de SEO ni la
   ficha técnica para cargar. Las secciones quedan con su nombre, en texto plano
   (ML no acepta HTML). */
export function descripcionDesdeTxt(txt) {
  return secciones(txt)
    .filter((s) => !esTitulo(s) && !esSEO(s) && !esFichaML(s))
    .map((s) => (s.titulo ? `${s.titulo}\n${s.texto}` : s.texto))
    .filter((s) => s.trim())
    .join("\n\n")
    .trim();
}

/* El título que trae el .txt (sección TÍTULO, primer renglón), o "". Sirve de
   nombre sugerido para la publicación (`family_name`): ML arma el título final. */
export function tituloDesdeTxt(txt) {
  return (secciones(txt).find(esTitulo)?.texto ?? "").split(/\n/)[0].trim();
}

/* La sección FICHA del .txt, para mostrarla al lado del formulario. Solo de
   referencia: la ficha se carga a mano (decisión de Franco). */
export function fichaDesdeTxt(txt) {
  const todas = secciones(txt);
  // La de ML, pensada para completar estos campos, gana sobre la del comprador.
  return (todas.find(esFichaML) ?? todas.find((s) => /^FICHA/.test(sinTildes(s.titulo))))?.texto ?? "";
}

/* Cómo se llama el texto en la carpeta: publicacion_ml.txt es el que arma el
   skill fotos-mercadolibre; publicacion.txt se acepta también. */
export const NOMBRES_TXT = ["publicacion_ml.txt", "publicacion.txt"];

/* ---------- Carpeta del perfume ----------
   Propone, no elige: devuelve las carpetas con su puntaje (cuántas palabras de
   la carpeta están en el nombre del perfume), de mayor a menor. */
const palabras = (s) =>
  sinTildes(String(s ?? "").toLowerCase())
    .replace(/\b\d+\s*ml\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1);

export function proponerCarpeta(nombre, carpetas) {
  const delPerfume = new Set(palabras(nombre));
  return (carpetas ?? [])
    .map((c) => {
      const deCarpeta = palabras(c);
      const coinciden = deCarpeta.filter((w) => delPerfume.has(w)).length;
      const puntaje = deCarpeta.length ? coinciden / Math.max(deCarpeta.length, delPerfume.size) : 0;
      return { carpeta: c, puntaje };
    })
    .sort((a, b) => b.puntaje - a.puntaje || a.carpeta.localeCompare(b.carpeta, "es"));
}

/* ---------- Actualizar una publicación que ya existe ---------- */

/* La ficha como la tiene ML hoy (`item.attributes`), en el formato de
   CAMPOS_FICHA: el inverso de `atributosDeFicha`. Lo que no es de la ficha
   (medidas del paquete, condición, etc.) no se lee: no se toca al actualizar. */
export function fichaDesdeAtributos(attributes) {
  const porId = new Map((attributes ?? []).map((a) => [a.id, a]));
  const ficha = {};
  for (const c of CAMPOS_FICHA) {
    const a = porId.get(c.id);
    if (!a || (a.value_name == null && !a.values?.length)) continue;
    const nombres = (a.values ?? []).map((v) => v.name).filter((n) => n != null);
    if (c.tipo === "multi") ficha[c.id] = nombres.length ? nombres : String(a.value_name).split(",");
    else if (c.tipo === "notas") ficha[c.id] = (nombres.length ? nombres : String(a.value_name).split(",")).join(", ");
    else if (c.tipo === "siono") ficha[c.id] = a.value_name === "Sí";
    else if (c.tipo === "numero") {
      const n = a.values?.[0]?.struct?.number ?? parseFloat(String(a.value_name).replace(",", "."));
      if (Number.isFinite(n)) ficha[c.id] = n;
    } else ficha[c.id] = String(a.value_name);
  }
  return ficha;
}

/* Cómo se compara un campo: dos fichas que dicen lo mismo con otra forma
   ("Lavanda, Cedro" y "Lavanda,Cedro") no son un cambio. */
const comparable = (c, v) => {
  if (vacio(v)) return "";
  if (c.tipo === "multi") return [...v].map((x) => String(x).trim()).sort().join("|");
  if (c.tipo === "notas")
    return String(v)
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .join("|");
  if (c.tipo === "siono") return v ? "Sí" : "No";
  if (c.tipo === "numero") return String(Number(v));
  return String(v).trim();
};

const legibleDe = (c, v) => {
  if (vacio(v)) return "—";
  if (c.tipo === "multi") return v.join(", ");
  if (c.tipo === "siono") return v ? "Sí" : "No";
  if (c.tipo === "numero" && c.unidad) return `${Number(v)} ${c.unidad}`;
  return String(v);
};

/* Qué cambia entre lo que hay en ML y lo que quedó en el panel.
   actual = { ficha, familyName, descripcion, fotos (cantidad) }
   nuevo  = { ficha, familyName, descripcion, fotos (ids o archivos) | null }
   `fotos: null` en `nuevo` = no tocar las fotos.
   -> { renglones: [{ campo, antes, despues }], atributos (formato de ML, solo
        los que cambian), familyName | null, descripcion | null, fotos | null }
   Un campo que se vació no cuenta como cambio: borrar un atributo en ML es
   otra operación, y vaciar sin querer no tiene que borrar nada. */
export function cambiosDeActualizacion(actual, nuevo) {
  const renglones = [];
  const cambiados = {};
  for (const c of CAMPOS_FICHA) {
    const antes = actual.ficha?.[c.id];
    const despues = nuevo.ficha?.[c.id];
    if (vacio(despues) || comparable(c, antes) === comparable(c, despues)) continue;
    cambiados[c.id] = despues;
    renglones.push({ campo: c.nombre, antes: legibleDe(c, antes), despues: legibleDe(c, despues) });
  }
  const familyName =
    String(nuevo.familyName ?? "").trim() && String(nuevo.familyName).trim() !== String(actual.familyName ?? "").trim()
      ? String(nuevo.familyName).trim()
      : null;
  if (familyName) renglones.push({ campo: "Nombre", antes: actual.familyName || "—", despues: familyName });
  const descripcion =
    String(nuevo.descripcion ?? "").trim() && String(nuevo.descripcion).trim() !== String(actual.descripcion ?? "").trim()
      ? String(nuevo.descripcion).trim()
      : null;
  if (descripcion) renglones.push({ campo: "Descripción", antes: `${String(actual.descripcion ?? "").length} letras`, despues: `${descripcion.length} letras` });
  // Fotos: `actual.fotos` son los ids de hoy y `nuevo.fotos` la tira final
  // (`{tipo: "ml", id}` | `{tipo: "carpeta", archivo}`), o null si no se tocó.
  const resumen = Array.isArray(nuevo.fotos) ? resumenDeFotos(actual.fotos ?? [], nuevo.fotos) : null;
  const fotos = resumen?.cambia ? nuevo.fotos : null;
  if (fotos) renglones.push({ campo: "Fotos", antes: resumen.antes, despues: resumen.despues });
  return { renglones, atributos: atributosDeFicha(cambiados), quitadas: resumen?.quitadas ?? 0, familyName, descripcion, fotos };
}

/* Qué pasa con las fotos de una publicación si se manda `tira`: ML deja
   exactamente esa lista, en ese orden (doc "Imágenes", Reemplazar imágenes): las
   de hoy que no están se borran. `antes` son los ids de hoy, en orden.
   -> { cambia, quitadas, nuevas, reordena, antes, despues } */
export function resumenDeFotos(antes, tira) {
  const hoy = antes.map(String);
  const quedan = tira.filter((f) => f.tipo === "ml").map((f) => String(f.id));
  const nuevas = tira.filter((f) => f.tipo === "carpeta").length;
  const quitadas = hoy.filter((id) => !quedan.includes(id)).length;
  const mismaSecuencia = !nuevas && quedan.length === hoy.length && quedan.every((id, i) => id === hoy[i]);
  // ¿Las que quedan siguen en su orden, y las nuevas van todas al final?
  const enOrden = quedan.join() === hoy.filter((id) => quedan.includes(id)).join();
  const primeraNueva = tira.findIndex((f) => f.tipo === "carpeta");
  const nuevasAlFinal = primeraNueva < 0 || tira.slice(primeraNueva).every((f) => f.tipo === "carpeta");
  const reordena = !mismaSecuencia && (!enOrden || !nuevasAlFinal);
  const partes = [`${tira.length} foto${tira.length === 1 ? "" : "s"}`];
  if (quitadas) partes.push(`${quitadas} se quita${quitadas === 1 ? "" : "n"}`);
  if (nuevas) partes.push(`${nuevas} nueva${nuevas === 1 ? "" : "s"} de la carpeta`);
  if (reordena) partes.push("cambia el orden");
  return {
    cambia: tira.length > 0 && !mismaSecuencia,
    quitadas,
    nuevas,
    reordena,
    antes: `${hoy.length} foto${hoy.length === 1 ? "" : "s"}`,
    despues: partes.join(" · "),
  };
}
