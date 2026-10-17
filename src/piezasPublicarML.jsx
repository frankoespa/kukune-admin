import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { NumberCell } from "./NumberCell";
import { leerCarpetasML, leerFichaML, leerTxtDeCarpetaML, urlDeCarpetaML } from "./clienteML";
import { proponerCarpeta } from "./armadoML";

/* ============================================================
   Piezas que comparten los paneles de Publicar (PublicarML.jsx) y Actualizar
   (ActualizarML.jsx): la carpeta del perfume con sus fotos y su texto, la
   ficha técnica y los rótulos. Las fotos y el texto salen SOLO de
   `<Perfume>/MercadoLibre/` (ver ml-publicar.js).
   ============================================================ */

export const MINIMO_PX = 500; // lo que acepta ML (doc "Imágenes")
const PUNTAJE_SUGERIDA = 0.6;

export const caja = { background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" };
export const campo = "w-full rounded-[3px] border px-2 py-1.5 text-[12.5px]";

export const usable = (f) => (f.ancho ?? 0) >= MINIMO_PX || (f.alto ?? 0) >= MINIMO_PX;

/* Los valores posibles de los campos de lista de la ficha (de ML). Si no
   llegan, esos campos quedan de texto libre. */
export function useListasFicha() {
  const [listas, setListas] = useState({});
  useEffect(() => {
    leerFichaML()
      .then(setListas)
      .catch(() => setListas({}));
  }, []);
  return listas;
}

/* La carpeta del perfume: el listado, la elegida (se guarda en el perfume como
   `carpetaPublicacion`), sus fotos tildadas y el texto. Propone, no elige. */
export function useCarpetaML(perfume, onCambiar) {
  const [listado, setListado] = useState(null); // respuesta de /carpetas
  const [errorCarga, setErrorCarga] = useState("");
  const [carpeta, setCarpeta] = useState(perfume.carpetaPublicacion ?? "");
  const [fueraDeLaLista, setFueraDeLaLista] = useState(() => new Set()); // fotos destildadas
  const [txt, setTxt] = useState("");

  const leer = useCallback(async () => {
    setErrorCarga("");
    try {
      setListado(await leerCarpetasML());
    } catch (e) {
      setErrorCarga(`No se pudieron leer las carpetas (${e.message}).`);
    }
  }, []);
  useEffect(() => {
    leer();
  }, [leer]);

  const elegida = listado?.carpetas.find((c) => c.nombre === carpeta) ?? null;

  // El nombre del texto lo dice el server (publicacion_ml.txt o publicacion.txt).
  useEffect(() => {
    setTxt("");
    const archivo = elegida?.txt ?? null;
    if (!carpeta || !archivo) return;
    let vigente = true;
    leerTxtDeCarpetaML(carpeta, archivo).then((t) => vigente && setTxt(t));
    return () => {
      vigente = false;
    };
  }, [carpeta, elegida?.txt, listado]);

  const fotos = elegida?.existe ? elegida.fotos : [];
  const fotosElegidas = fotos.filter((f) => usable(f) && !fueraDeLaLista.has(f.archivo)).map((f) => f.archivo);

  const propuestas = useMemo(
    () => proponerCarpeta(perfume.nombre, (listado?.carpetas ?? []).map((c) => c.nombre)),
    [perfume.nombre, listado]
  );
  const sugerida =
    propuestas[0] && propuestas[0].puntaje >= PUNTAJE_SUGERIDA && propuestas[1]?.puntaje !== propuestas[0].puntaje
      ? propuestas[0].carpeta
      : null;

  const elegirCarpeta = (nombre) => {
    setCarpeta(nombre);
    setFueraDeLaLista(new Set());
    // Es una elección explícita: se guarda en el perfume para la próxima.
    onCambiar(perfume.id, { carpetaPublicacion: nombre || undefined });
  };

  return { listado, errorCarga, leer, carpeta, elegirCarpeta, elegida, fotos, fotosElegidas, fueraDeLaLista, setFueraDeLaLista, propuestas, sugerida, txt };
}

/* El selector de carpeta y la grilla de fotos con sus casillas. */
export function SelectorDeFotos({ carpetas }) {
  const { errorCarga, listado, carpeta, elegirCarpeta, propuestas, sugerida, leer, elegida, fotos, fueraDeLaLista, setFueraDeLaLista } = carpetas;
  return (
    <>
      {errorCarga && <Aviso>{errorCarga}</Aviso>}
      {listado && !listado.existe && (
        <Aviso>
          No encuentro la carpeta de publicaciones: <code>{listado.base}</code>
        </Aviso>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          value={carpeta}
          onChange={(e) => elegirCarpeta(e.target.value)}
          aria-label="Carpeta del perfume"
          className="min-w-[320px] rounded-[3px] border px-2 py-1.5 text-[12.5px]"
          style={caja}
        >
          <option value="">Elegí la carpeta del perfume…</option>
          {propuestas.map(({ carpeta: c, puntaje }) => (
            <option key={c} value={c}>
              {c}
              {c === sugerida ? " · sugerida" : puntaje > 0 ? ` · se parece ${Math.round(puntaje * 100)}%` : ""}
            </option>
          ))}
        </select>
        <button onClick={leer} className="k-col flex items-center gap-1.5 rounded-[3px] border px-2.5 py-[6px]" style={{ borderColor: "var(--linea)", color: "var(--humo)" }}>
          <RefreshCw size={13} /> Volver a mirar
        </button>
        {!carpeta && sugerida && (
          <button
            onClick={() => elegirCarpeta(sugerida)}
            className="k-col rounded-[3px] border px-2.5 py-[6px]"
            style={{ borderColor: "var(--tinta)", color: "var(--tinta)" }}
          >
            Usar {sugerida}
          </button>
        )}
      </div>
      {carpeta && elegida && !elegida.existe && (
        <Aviso>
          Esta carpeta todavía no tiene fotos para Mercado Libre. Creá{" "}
          <code>
            {listado.base}\{carpeta}\Mercadolibre
          </code>{" "}
          con las fotos (JPG o PNG, de 500 px o más; la primera por nombre es la principal) y, si querés, su{" "}
          <code>publicacion_ml.txt</code>. Después tocá “Volver a mirar”.
        </Aviso>
      )}
      {fotos.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {fotos.map((f, i) => {
            const ok = usable(f);
            const tildada = ok && !fueraDeLaLista.has(f.archivo);
            return (
              <li key={f.archivo} className="w-[104px]">
                <label className={`block ${ok ? "cursor-pointer" : "cursor-not-allowed"}`} title={ok ? f.archivo : `${f.archivo}: ML pide al menos ${MINIMO_PX} px`}>
                  <div
                    className="relative h-[104px] w-[104px] overflow-hidden rounded-[3px] border"
                    style={{ borderColor: ok ? (tildada ? "var(--tinta)" : "var(--linea)") : "var(--oxido)", opacity: tildada ? 1 : 0.45 }}
                  >
                    <img src={urlDeCarpetaML(carpeta, f.archivo)} alt={f.archivo} className="h-full w-full object-cover" />
                    {i === 0 && (
                      <span className="k-col absolute left-1 top-1 rounded-[2px] px-1" style={{ background: "var(--tinta)", color: "var(--papel)" }}>
                        principal
                      </span>
                    )}
                  </div>
                  <span className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: ok ? "var(--humo)" : "var(--oxido)" }}>
                    <input
                      type="checkbox"
                      disabled={!ok}
                      checked={tildada}
                      onChange={() =>
                        setFueraDeLaLista((s) => {
                          const n = new Set(s);
                          n.has(f.archivo) ? n.delete(f.archivo) : n.add(f.archivo);
                          return n;
                        })
                      }
                    />
                    <span className="k-num">{f.ancho && f.alto ? `${f.ancho}×${f.alto}` : "¿?"}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

export function Paso({ n, titulo, children }) {
  return (
    <section>
      <h4 className="k-rotulo mb-2">
        {n}. {titulo}
      </h4>
      {children}
    </section>
  );
}

export const Aviso = ({ children }) => (
  <p className="mb-2 rounded-[3px] border px-2.5 py-2 text-[12px]" style={{ borderColor: "var(--oxido)", color: "var(--oxido)" }}>
    {children}
  </p>
);

/* Un campo de la ficha según su tipo (ver CAMPOS_FICHA). Los de lista usan
   los valores que da ML; si no llegaron, quedan de texto libre. */
export function CampoFicha({ campo: c, valor, valores, onCambiar }) {
  const rotulo = (
    <span className="k-col mb-1 block" style={{ color: c.obligatorio ? "var(--tinta)" : "var(--humo)" }}>
      {c.nombre}
      {c.obligatorio ? " *" : ""}
      {c.unidad ? ` (${c.unidad})` : ""}
    </span>
  );
  if (c.tipo === "numero")
    return (
      <label className="block">
        {rotulo}
        <NumberCell value={Number(valor) || 0} onChange={(v) => onCambiar(v > 0 ? v : null)} />
      </label>
    );
  if (c.tipo === "siono")
    return (
      <label className="block">
        {rotulo}
        <select value={valor == null ? "" : valor ? "si" : "no"} onChange={(e) => onCambiar(e.target.value === "" ? null : e.target.value === "si")} className={campo} style={caja}>
          <option value="">—</option>
          <option value="si">Sí</option>
          <option value="no">No</option>
        </select>
      </label>
    );
  if (c.tipo === "multi" && valores?.length) {
    const elegidos = new Set(valor ?? []);
    return (
      <div className="col-span-2">
        {rotulo}
        <div className="flex flex-wrap gap-1">
          {valores.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                const n = new Set(elegidos);
                n.has(v) ? n.delete(v) : n.add(v);
                onCambiar([...n]);
              }}
              className="rounded-[3px] border px-2 py-0.5 text-[11.5px]"
              style={elegidos.has(v) ? { background: "var(--tinta)", color: "var(--papel)", borderColor: "var(--tinta)" } : { borderColor: "var(--linea)", color: "var(--humo)" }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (c.tipo === "lista" && valores?.length)
    return (
      <label className="block">
        {rotulo}
        <select value={valor ?? ""} onChange={(e) => onCambiar(e.target.value || null)} className={campo} style={caja}>
          <option value="">—</option>
          {valores.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
    );
  return (
    <label className={`block ${c.tipo === "notas" ? "col-span-2" : ""}`}>
      {rotulo}
      <input
        value={c.tipo === "multi" ? (valor ?? []).join(", ") : valor ?? ""}
        onChange={(e) =>
          onCambiar(
            c.tipo === "multi"
              ? e.target.value.split(",").map((s) => s.trim()).filter(Boolean)
              : e.target.value
          )
        }
        placeholder={c.tipo === "notas" ? "Separadas por coma: Lavanda, Cedro, Vainilla" : ""}
        className={campo}
        style={caja}
      />
    </label>
  );
}

