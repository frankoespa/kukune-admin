import { jsPDF } from "jspdf";

/* ============================================================
   Catálogo para el proveedor.
   Una ficha por perfume: foto, nombre y cantidad. Nada de precios
   ni márgenes — esto se le manda al proveedor.
   Recibe ya filtradas las filas con "Incluir" en SÍ.
   ============================================================ */

/* Medidas en mm sobre A4 (210 × 297) */
const PAGINA_ANCHO = 210;
const PAGINA_ALTO = 297;
const MARGEN_X = 14;
const COLS = 2;
const FILAS = 3;
const POR_PAGINA = COLS * FILAS;
const ANCHO_COL = 86;
const GUTTER = 10;
const ALTO_FOTO = 56;
const ALTO_CELDA = 76;
const GAP_FILA = 5;
const Y_CONTENIDO = 32; // arranca debajo de la banda del encabezado

/* Colores de marca (los mismos que la UI) */
const CARBON = [55, 55, 55];
const TINTA = [42, 42, 42];
const GRIS_TEXTO = [107, 102, 93];
const GRIS_SUAVE = [154, 149, 138];
const BORDE = [228, 225, 218];
const FONDO_FOTO = [246, 244, 239];

const fechaCorta = (fecha) =>
  new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(fecha);

/* Sin la marca: este archivo se le manda al proveedor y el nombre del negocio
   no tiene por qué viajar ahí, ni siquiera en el nombre del archivo. */
export function nombreArchivoPDF(fecha = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `pedido-${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}.pdf`;
}

export function construirPDF(productos, { fecha = new Date() } = {}) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const unidades = productos.reduce((s, p) => s + (Number(p.cantidad) || 0), 0);
  const paginas = Math.max(1, Math.ceil(productos.length / POR_PAGINA));

  for (let pagina = 0; pagina < paginas; pagina++) {
    if (pagina > 0) doc.addPage();
    encabezado(doc, { fecha, productos: productos.length, unidades, pagina, paginas });

    const enPagina = productos.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
    enPagina.forEach((p, i) => {
      const x = MARGEN_X + (i % COLS) * (ANCHO_COL + GUTTER);
      const y = Y_CONTENIDO + Math.floor(i / COLS) * (ALTO_CELDA + GAP_FILA);
      ficha(doc, p, x, y);
    });
  }

  if (!productos.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...GRIS_SUAVE);
    doc.text("No hay perfumes marcados para incluir.", PAGINA_ANCHO / 2, 60, { align: "center" });
  }

  return doc;
}

function encabezado(doc, { fecha, productos, unidades, pagina, paginas }) {
  doc.setFillColor(...CARBON);
  doc.rect(0, 0, PAGINA_ANCHO, 20, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text("PEDIDO A PROVEEDOR", MARGEN_X, 12.5, { charSpace: 1.2 });

  doc.setTextColor(200, 196, 187);
  doc.setFontSize(8);
  doc.text(
    `${fechaCorta(fecha)}   ·   ${productos} ${productos === 1 ? "producto" : "productos"}   ·   ${unidades} ${unidades === 1 ? "unidad" : "unidades"}`,
    PAGINA_ANCHO - MARGEN_X,
    12.5,
    { align: "right" }
  );

  doc.setFontSize(8);
  doc.setTextColor(...GRIS_SUAVE);
  doc.text(`${pagina + 1} / ${paginas}`, PAGINA_ANCHO / 2, PAGINA_ALTO - 10, { align: "center" });
}

function ficha(doc, p, x, y) {
  doc.setDrawColor(...BORDE);
  doc.setFillColor(...FONDO_FOTO);
  doc.roundedRect(x, y, ANCHO_COL, ALTO_FOTO, 2, 2, "FD");

  dibujarFoto(doc, p.foto, x, y);

  const nombre = (p.producto || "").trim() || "(sin nombre)";
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...TINTA);
  doc.text(doc.splitTextToSize(nombre, ANCHO_COL).slice(0, 2), x, y + ALTO_FOTO + 6);

  const cantidad = Number(p.cantidad) || 0;
  const etiqueta = "Cantidad: ";
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...GRIS_TEXTO);
  doc.text(etiqueta, x, y + ALTO_FOTO + 17);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...CARBON);
  doc.text(String(cantidad), x + doc.getTextWidth(etiqueta), y + ALTO_FOTO + 17);
}

function dibujarFoto(doc, foto, x, y) {
  if (foto) {
    try {
      const props = doc.getImageProperties(foto);
      const escala = Math.min((ANCHO_COL - 4) / props.width, (ALTO_FOTO - 4) / props.height);
      const w = props.width * escala;
      const h = props.height * escala;
      doc.addImage(
        foto,
        props.fileType || "JPEG",
        x + (ANCHO_COL - w) / 2,
        y + (ALTO_FOTO - h) / 2,
        w,
        h
      );
      return;
    } catch (e) {
      /* foto ilegible: cae al placeholder */
    }
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...GRIS_SUAVE);
  doc.text("SIN FOTO", x + ANCHO_COL / 2, y + ALTO_FOTO / 2 + 1, {
    align: "center",
    charSpace: 0.8,
  });
}
