import { useEffect, useRef, useState } from "react";
import { aNumero } from "./numeros";

/* ============================================================
   Entrada de números, compartida por la tabla de pedidos y el catálogo.

   Vive acá y no en App.jsx porque el catálogo también la necesita y App importa
   al catálogo (al revés sería circular). Antes el catálogo tenía sus propios
   `<input>` a mano y por eso perdía las dos cosas que este componente resuelve:
   el string local mientras se escribe, y leer números al modo argentino.
   ============================================================ */

export function NumberCell({ value, onChange, align = "right", suffix, className = "", style }) {
  const [s, setS] = useState(String(value ?? ""));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setS(value === 0 || value ? String(value) : "");
  }, [value]);

  return (
    <div className="relative">
      <input
        inputMode="decimal"
        value={s}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setS(value === 0 || value ? String(value) : "");
        }}
        onChange={(e) => {
          setS(e.target.value);
          onChange(aNumero(e.target.value) ?? 0);
        }}
        className={`k-num w-full rounded-[3px] border py-1.5 pl-2 ${
          suffix ? "pr-8" : "pr-2"
        } text-[12.5px] transition focus:outline-none ${
          align === "right" ? "text-right" : "text-left"
        } ${className}`}
        style={{
          background: "var(--papel)",
          borderColor: "var(--linea)",
          color: "var(--tinta)",
          ...style,
        }}
      />
      {suffix && (
        <span
          className="k-col pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[9px]"
          style={{ color: "var(--humo-claro)" }}
        >
          {suffix}
        </span>
      )}
    </div>
  );
}
