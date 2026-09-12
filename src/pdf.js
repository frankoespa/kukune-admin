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
  dibujarFotoEn(doc, foto, x, y, ANCHO_COL, ALTO_FOTO);
}

/* Dibuja la foto centrada y sin deformar dentro de la caja que se le pase.
   Si no hay foto, o no se puede leer, escribe "SIN FOTO" en su lugar. */
function dibujarFotoEn(doc, foto, x, y, w, h) {
  if (foto) {
    try {
      const props = doc.getImageProperties(foto);
      const escala = Math.min((w - 4) / props.width, (h - 4) / props.height);
      const iw = props.width * escala;
      const ih = props.height * escala;
      doc.addImage(foto, props.fileType || "JPEG", x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
      return;
    } catch (e) {
      /* foto ilegible: cae al placeholder */
    }
  }
  // El cartel se dibuja solo si entra. Con fotos chicas "SIN FOTO" desborda la
  // caja y se derrama sobre el nombre; ahí alcanza con el recuadro vacío, que
  // ya se lee como "falta la foto".
  doc.setFont("helvetica", "normal");
  doc.setFontSize(h > 30 ? 8 : 6);
  doc.setTextColor(...GRIS_SUAVE);
  const espaciado = h > 30 ? 0.8 : 0.2;
  const anchoTexto = doc.getTextWidth("SIN FOTO") + 7 * espaciado * 0.3528;
  if (anchoTexto <= w - 1) {
    doc.text("SIN FOTO", x + w / 2, y + h / 2 + 1, { align: "center", charSpace: espaciado });
  }
}

/* ============================================================
   Lista de precios para clientes.

   En filas, no en cuadrícula: una línea por perfume con la foto chica, el
   nombre y el precio alineado a la derecha. Entran 12 por página en vez de 6 y
   se recorre con el dedo como una lista de precios de verdad.

   Es una pieza de venta, así que acá sí va la marca — al contrario del PDF del
   proveedor, donde el nombre del negocio no tiene por qué viajar.

   El precio que se imprime es el de venta directa, nunca el de Mercado Libre:
   ese incluye la comisión de la plataforma y no es lo que le cobrás a alguien
   que te compra por WhatsApp o en persona.
   ============================================================ */

const AMBAR = [184, 134, 47];
const X_FIN = PAGINA_ANCHO - MARGEN_X;

/* Acá se fija UNA cosa: cuántos perfumes por hoja. El alto de fila y el tamaño
   de la foto salen de eso, repartiendo el espacio disponible de la página.
   Está al revés a propósito — "quiero ver 7 por hoja" es la decisión real, y el
   tamaño de la foto es la consecuencia. Subir este número achica la foto. */
const FILAS_POR_PAGINA = 7;
const MARGEN_INFERIOR = 16;
const AIRE_ENTRE_FILAS = 4;
const ALTO_FILA = Math.floor((PAGINA_ALTO - Y_CONTENIDO - MARGEN_INFERIOR) / FILAS_POR_PAGINA);
const FOTO_LADO = ALTO_FILA - AIRE_ENTRE_FILAS;

export function nombreArchivoPrecios(fecha = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `KUKUNE-precios-${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}.pdf`;
}

export function construirPDFPrecios(perfumes, { fecha = new Date() } = {}) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const paginas = Math.max(1, Math.ceil(perfumes.length / FILAS_POR_PAGINA));

  for (let pagina = 0; pagina < paginas; pagina++) {
    if (pagina > 0) doc.addPage();
    encabezadoPrecios(doc, { fecha, cuantos: perfumes.length, pagina, paginas });
    perfumes
      .slice(pagina * FILAS_POR_PAGINA, (pagina + 1) * FILAS_POR_PAGINA)
      .forEach((p, i) => filaPrecio(doc, p, Y_CONTENIDO + i * ALTO_FILA));
  }

  if (!perfumes.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(...GRIS_SUAVE);
    doc.text("Todavía no hay perfumes con precio.", PAGINA_ANCHO / 2, 60, { align: "center" });
  }
  return doc;
}

function encabezadoPrecios(doc, { fecha, cuantos, pagina, paginas }) {
  doc.setFillColor(...CARBON);
  doc.rect(0, 0, PAGINA_ANCHO, 20, "F");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text("KUKUNE", MARGEN_X, 12.5, { charSpace: 1.4 });

  doc.setFontSize(7.5);
  doc.setTextColor(...AMBAR);
  doc.text("LISTA DE PRECIOS", MARGEN_X + 34, 12.5, { charSpace: 0.6 });

  doc.setTextColor(200, 196, 187);
  doc.setFontSize(8);
  doc.text(
    `${fechaCorta(fecha)}   ·   ${cuantos} ${cuantos === 1 ? "perfume" : "perfumes"}`,
    X_FIN,
    12.5,
    { align: "right" }
  );

  doc.setFontSize(8);
  doc.setTextColor(...GRIS_SUAVE);
  doc.text(`${pagina + 1} / ${paginas}`, PAGINA_ANCHO / 2, PAGINA_ALTO - 10, { align: "center" });
}

function filaPrecio(doc, p, y) {
  const centro = y + FOTO_LADO / 2;

  doc.setDrawColor(...BORDE);
  doc.setFillColor(...FONDO_FOTO);
  doc.roundedRect(MARGEN_X, y, FOTO_LADO, FOTO_LADO, 1.5, 1.5, "FD");
  dibujarFotoEn(doc, p.foto, MARGEN_X, y, FOTO_LADO, FOTO_LADO);

  // El precio se mide primero: el nombre no puede invadirlo.
  const precio = new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(Number(p.precioPublico) || 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  const anchoPrecio = doc.getTextWidth(precio);

  const xNombre = MARGEN_X + FOTO_LADO + 6;
  const anchoNombre = X_FIN - anchoPrecio - 8 - xNombre;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...TINTA);
  const lineas = doc.splitTextToSize((p.nombre || "").trim() || "(sin nombre)", anchoNombre).slice(0, 2);
  // Centrado vertical respecto de la foto, con una o dos líneas.
  const alto = lineas.length * 4.4;
  doc.text(lineas, xNombre, centro - alto / 2 + 3.6);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...AMBAR);
  doc.text(precio, X_FIN, centro + 1.6, { align: "right" });

  // Hairline que separa una fila de la siguiente.
  doc.setDrawColor(...BORDE);
  doc.setLineWidth(0.2);
  doc.line(MARGEN_X, y + ALTO_FILA - 2, X_FIN, y + ALTO_FILA - 2);
}
