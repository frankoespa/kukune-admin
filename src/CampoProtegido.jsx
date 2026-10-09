import { useEffect, useRef, useState } from "react";
import { Lock } from "lucide-react";
import { NumberCell } from "./NumberCell";

/* ============================================================
   Un campo detrás de un doble clic.

   Para los números de los que cuelga todo lo demás: el costo de un perfume (de
   él salen márgenes, ganancias y los precios clavados) y los ajustes de
   Tiendanube (mueven el precio de todos los perfumes clavados). Pisarlos de un
   tecleo no rompe una celda: reprecia publicaciones en silencio.

   Trabado se ve como valor suelto, igual que lo calculado. El problema del doble
   clic es que no se ve, así que el campo se anuncia: candado al pasar el mouse,
   borde que aparece, `title` que lo explica, y es un `<button>` de verdad —se
   llega con Tab y se abre con Enter o Espacio—, no un div con un handler.

   Se traba solo al salir del campo o con Enter. Escape deshace: `NumberCell`
   escribe en cada tecla, así que sin esto un error ya quedó guardado antes de
   darte cuenta.

   `texto` lo vuelve un campo de texto (el nombre de una forma de pago).
   `abiertoAlInicio` es para lo recién creado: hacerle doble clic a algo que
   acabás de agregar sería un paso de más.
   ============================================================ */
export function CampoProtegido({
  valor,
  onCambiar,
  mostrar = (v) => String(v ?? ""),
  etiqueta = "este campo",
  suffix,
  texto = false,
  abiertoAlInicio = false,
}) {
  const valorAlAbrir = useRef(abiertoAlInicio ? valor : null);
  const [editando, setEditando] = useState(abiertoAlInicio);
  const caja = useRef(null);

  const abrir = () => {
    valorAlAbrir.current = valor ?? (texto ? "" : 0);
    setEditando(true);
  };

  // Al abrir, el foco va al campo con el valor seleccionado: escribir lo
  // reemplaza sin tener que borrarlo a mano.
  useEffect(() => {
    if (!editando) return;
    const input = caja.current?.querySelector("input");
    input?.focus();
    input?.select();
  }, [editando]);

  if (!editando) {
    return (
      <button
        type="button"
        onDoubleClick={abrir}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            abrir();
          }
        }}
        title={`Doble clic para editar ${etiqueta}`}
        aria-label={`${etiqueta}: ${mostrar(valor)} — doble clic para editarlo`}
        className={`group/protegido flex w-full min-w-0 items-center gap-1 rounded-[3px] border border-transparent px-1.5 py-1.5 transition hover:border-[var(--linea)] hover:bg-[var(--vidrio)] ${
          texto ? "justify-between text-left" : "justify-end"
        }`}
      >
        {texto ? (
          <>
            <span className="truncate text-[12.5px]" style={{ color: "var(--tinta)" }}>
              {mostrar(valor)}
            </span>
            <Lock
              size={11}
              className="shrink-0 opacity-0 transition group-hover/protegido:opacity-100"
              style={{ color: "var(--humo-claro)" }}
            />
          </>
        ) : (
          <>
            <Lock
              size={11}
              className="shrink-0 opacity-0 transition group-hover/protegido:opacity-100"
              style={{ color: "var(--humo-claro)" }}
            />
            <span className="k-num text-[13px]" style={{ color: "var(--tinta)" }}>
              {mostrar(valor)}
            </span>
          </>
        )}
      </button>
    );
  }

  return (
    <div
      ref={caja}
      onBlur={() => setEditando(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter") setEditando(false);
        if (e.key === "Escape") {
          onCambiar(valorAlAbrir.current); // deshace lo tipeado
          setEditando(false);
        }
      }}
    >
      {texto ? (
        <input
          value={valor ?? ""}
          onChange={(e) => onCambiar(e.target.value)}
          aria-label={etiqueta}
          className="w-full rounded-[3px] border px-2 py-1.5 text-[12.5px]"
          style={{ background: "var(--papel)", borderColor: "var(--linea)", color: "var(--tinta)" }}
        />
      ) : (
        <NumberCell value={valor ?? 0} onChange={onCambiar} suffix={suffix} />
      )}
    </div>
  );
}
