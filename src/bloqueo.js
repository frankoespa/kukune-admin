import { createContext, useContext } from "react";

/* ============================================================
   El candado de un pedido cerrado.

   Un pedido cerrado es un registro histórico: los costos, las cantidades y los
   precios de ese envío ya pasaron y no se tocan más.

   Va por contexto y no por props a propósito. La tabla tiene 21 columnas y
   varias celdas viven en componentes sueltos; pasar un `bloqueado` por cada una
   es garantía de olvidarse justo la que importa y dejar un agujero por donde se
   escribe igual. Con el contexto, cada celda editable pregunta por su cuenta.

   Arranca en `false`, así que el catálogo —que nunca se cierra— no se entera de
   que esto existe.

   Ojo: esto apaga la UI, no protege el archivo. Lo que de verdad lo protege es
   la guarda del efecto que persiste en `App.jsx`, que con el pedido cerrado no
   programa ninguna escritura. Las dos cosas hacen falta.
   ============================================================ */
export const ContextoBloqueo = createContext(false);

export const useBloqueo = () => useContext(ContextoBloqueo);
