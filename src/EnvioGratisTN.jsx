import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { NumberCell } from "./NumberCell";
import { pesos } from "./Catalogo";
import { pctSinMiles } from "./numeros";
import { analisisDelUmbral, carritosPosibles, itemsDelCatalogo } from "./umbralEnvioTN";

/* ============================================================
   "¿Desde qué monto doy envío gratis?"

   Elegir el monto en abstracto no se puede, igual que los tres números de la
   banda de ganancia: el panel muestra en vivo qué le haría a los perfumes de
   verdad, y recién ahí el número se puede elegir.

   El monto se tantea con un campo LOCAL, no con el de los ajustes: `NumberCell`
   escribe en cada tecla, y cada tecla sobre el ajuste repreciaría todo el
   catálogo clavado y reiniciaría el temporizador del guardado. Acá se mueve el
   número todas las veces que haga falta sin tocar nada, y "Usar este monto" es
   el único que escribe.

   Lo que más pesa para decidir va primero: cuánto cambia la ganancia, y el peor
   carrito que califica. Ese es el riesgo real del envío gratis con monto
   mínimo: el carrito que cruza el monto sumando frascos baratos que no
   absorbieron el envío en su precio.
   ============================================================ */

const colorDif = (n) => (n > 0 ? "var(--verde)" : n < 0 ? "var(--oxido)" : "var(--humo)");
const conSigno = (n) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${pesos(Math.abs(n))}`;

const Rotulo = ({ children }) => (
  <span className="k-col mb-1 block" style={{ color: "var(--humo)" }}>
    {children}
  </span>
);

/* Un renglón de los dos que deciden: qué compra es, y qué te queda con ella. */
function Renglon({ titulo, detalle, monto, nota }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 py-1">
      <span className="text-[12px]" style={{ color: "var(--humo)" }}>
        {titulo}
      </span>
      <span className="k-num text-[12.5px]" style={{ color: "var(--tinta)" }}>
        {detalle}
      </span>
      <span className="text-[12px]" style={{ color: "var(--humo)" }}>
        · te deja
      </span>
      {/* Ámbar: es plata que te queda, el único uso legítimo del color. */}
      <span className="k-num text-[13px]" style={{ color: monto >= 0 ? "var(--ambar)" : "var(--oxido)" }}>
        {pesos(monto)}
      </span>
      {nota && (
        <span className="text-[11.5px]" style={{ color: "var(--humo-claro)" }}>
          {nota}
        </span>
      )}
    </div>
  );
}

const Sugerencia = ({ texto, monto, onUsar }) =>
  monto > 0 ? (
    <button
      type="button"
      onClick={() => onUsar(monto)}
      className="k-col rounded-[3px] border px-2.5 py-[6px] transition"
      style={{ borderColor: "var(--zona-tn-honda)", background: "var(--papel)", color: "var(--tinta)" }}
    >
      {texto}: <span className="k-num">{pesos(monto)}</span>
    </button>
  ) : null;

export default function EnvioGratisTN({ perfumes, tn, onCambiar }) {
  const guardado = Number(tn?.envioGratisDesde) || 0;
  const envio = Number(tn?.envioGratis) || 0;
  const [abierto, setAbierto] = useState(false);
  const [tanteo, setTanteo] = useState(guardado);
  const [minimo, setMinimo] = useState(10000);

  /* La enumeración de carritos no depende del monto, así que se hace una vez por
     catálogo y cada monto es una búsqueda. Solo con el panel abierto: son
     ~100.000 carritos y no hay por qué pagarlos con el panel cerrado. */
  const posibles = useMemo(
    () => (abierto ? carritosPosibles(itemsDelCatalogo(perfumes), { ajustesTN: tn }) : null),
    [abierto, perfumes, tn]
  );
  const r = useMemo(
    () => (posibles ? analisisDelUmbral(perfumes, tn, tanteo, { gananciaMinima: minimo, posibles }) : null),
    [posibles, perfumes, tn, tanteo, minimo]
  );

  const peor = r?.peorCarrito ?? null;
  const solo = r?.masBaratoQueCalifica ?? null;

  return (
    <div
      className="mb-5 rounded-[4px] border px-4 py-3"
      style={{ borderColor: "var(--zona-tn-honda)", background: "var(--zona-tn)" }}
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          className="k-col flex items-center gap-1 rounded-[3px] border px-2.5 py-[7px] transition"
          style={{ borderColor: "var(--zona-tn-honda)", color: "var(--tinta)", background: "var(--papel)" }}
        >
          Elegir el monto del envio gratis
          <ChevronDown size={13} style={{ transform: abierto ? "rotate(180deg)" : undefined }} />
        </button>
        <span className="text-[12px]" style={{ color: "var(--humo)" }}>
          {guardado > 0 ? (
            <>
              Hoy el envio gratis arranca en <span className="k-num">{pesos(guardado)}</span>: abajo de ese
              monto lo paga el cliente.
            </>
          ) : (
            <>Hoy el envio gratis es siempre, con cualquier compra: lo pagas vos en todas las ventas.</>
          )}
        </span>
      </div>

      {abierto && envio <= 0 && (
        <p className="mt-3 text-[12.5px]" style={{ color: "var(--oxido)" }}>
          Primero carga cuanto te cuesta el envio en "Envio gratis": sin ese numero no hay nada que
          decidir.
        </p>
      )}

      {abierto && envio > 0 && r && (
        <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--zona-tn-honda)" }}>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
            <div>
              <Rotulo>Probar con</Rotulo>
              <div className="w-[116px]">
                <NumberCell value={tanteo} onChange={setTanteo} />
              </div>
            </div>
            <button
              type="button"
              onClick={() => onCambiar(tanteo)}
              disabled={tanteo === guardado}
              className="k-col rounded-[3px] px-3 py-[7px] transition"
              style={
                tanteo === guardado
                  ? { background: "var(--vidrio-hondo)", color: "var(--humo-claro)", cursor: "not-allowed" }
                  : { background: "var(--tinta)", color: "var(--papel)" }
              }
            >
              {tanteo > 0 ? "Usar este monto" : "Volver a envio gratis siempre"}
            </button>
            <div>
              <Rotulo>Que ningun carrito deje menos de</Rotulo>
              <div className="w-[116px]">
                <NumberCell value={minimo} onChange={setMinimo} />
              </div>
            </div>
          </div>

          <p className="mt-3 max-w-[620px] text-[11.5px]" style={{ color: "var(--humo)" }}>
            Tiendanube mira el precio de lista: el numero de la columna Precio por las unidades, antes
            del cupon y antes del descuento del medio de pago. El que paga por transferencia paga
            menos, pero mira el mismo monto.
          </p>

          {/* Lo primero, porque es lo que decide: cuánta plata cambia de lugar. */}
          <p className="mt-3 text-[13px]" style={{ color: "var(--tinta)" }}>
            {tanteo > 0 ? (
              <>
                Con el envio gratis desde <span className="k-num">{pesos(tanteo)}</span> ganas{" "}
                <span className="k-num" style={{ color: colorDif(r.dif) }}>
                  {conSigno(r.dif)}
                </span>{" "}
                que hoy, vendiendo uno de cada uno ({pesos(r.gananciaHoy)} → {pesos(r.gananciaConUmbral)}).
              </>
            ) : (
              <>
                Con envio gratis siempre, vendiendo uno de cada uno te quedan{" "}
                <span className="k-num">{pesos(r.gananciaHoy)}</span>: cada venta se come{" "}
                <span className="k-num">{pesos(envio)}</span> de envio.
              </>
            )}
          </p>

          {tanteo > 0 && (
            <p className="mt-1 text-[12px]" style={{ color: "var(--humo)" }}>
              <strong style={{ color: "var(--tinta)", fontWeight: 500 }}>{r.debajo}</strong> perfumes quedan
              debajo del monto: vendidos solos, el envio lo paga el cliente.
              {r.arriba > 0 && (
                <>
                  {" "}
                  Los otros <strong style={{ color: "var(--tinta)", fontWeight: 500 }}>{r.arriba}</strong> ya
                  llegan al monto solos, asi que ahi lo seguis pagando vos.
                </>
              )}
            </p>
          )}

          <div className="mt-3">
            {peor ? (
              <Renglon
                titulo="El peor carrito que califica:"
                detalle={`${peor.unidades.length} ${peor.unidades.length === 1 ? "frasco" : "frascos"} · ${pesos(peor.subtotal)}`}
                monto={peor.ganancia}
                nota={`${peor.unidades.map((u) => u.nombre).join(" + ")} · con "${peor.forma}"`}
              />
            ) : (
              <p className="py-1 text-[12px]" style={{ color: "var(--humo)" }}>
                Con ese monto no califica ningun carrito de hasta {r.maxUnidades} frascos: nadie llega
                al envio gratis.
              </p>
            )}
            {solo ? (
              <Renglon
                titulo="El mas barato que califica solo:"
                detalle={pesos(solo.precio)}
                monto={solo.ganancia}
                nota={`${solo.nombre} · margen ${pctSinMiles(solo.ganancia / solo.costo, 0)}`}
              />
            ) : tanteo > 0 ? (
              <p className="py-1 text-[12px]" style={{ color: "var(--humo)" }}>
                Ningun perfume llega al monto vendido solo: el envio gratis pasa a ser el empujon para
                el segundo frasco.
              </p>
            ) : null}
            <p className="mt-1 text-[11.5px]" style={{ color: "var(--humo-claro)" }}>
              El peor carrito se busca entre todas las combinaciones de hasta {r.maxUnidades} frascos, con
              el envio ya pagado. Si ese deja bien, ninguno deja mal.
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="k-col" style={{ color: "var(--humo)" }}>
              Probar
            </span>
            <Sugerencia
              texto="Que nadie califique solo"
              monto={r.sugerencias.nadieCalificaSolo}
              onUsar={setTanteo}
            />
            <Sugerencia
              texto={`Para no dejar menos de ${pesos(minimo)}`}
              monto={r.sugerencias.paraGananciaMinima?.umbral ?? 0}
              onUsar={setTanteo}
            />
            {minimo > 0 && !r.sugerencias.paraGananciaMinima && (
              <span className="text-[12px]" style={{ color: "var(--oxido)" }}>
                Ningun monto deja siempre {pesos(minimo)}.
              </span>
            )}
          </div>

          <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--zona-tn-honda)" }}>
            {r.seMueven.length === 0 ? (
              <p className="text-[11.5px]" style={{ color: "var(--humo)" }}>
                Ningun precio se mueve: los que igualan a la venta directa cuelgan del precio directo y
                los de precio a mano no se tocan nunca. Lo que cambia es cuanto te queda.
              </p>
            ) : (
              <>
                <p className="mb-1 text-[11.5px]" style={{ color: "var(--humo)" }}>
                  {r.seMueven.length} precio{r.seMueven.length === 1 ? "" : "s"} se mueve
                  {r.seMueven.length === 1 ? "" : "n"}: los de margen o ganancia clavada que quedan debajo
                  del monto dejan de absorber el envio, asi que bajan con la misma ganancia.
                </p>
                {r.seMueven.map((m) => (
                  <div key={m.id} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                    <span style={{ color: "var(--tinta)" }}>{m.nombre}</span>
                    <span className="k-num" style={{ color: "var(--humo)" }}>
                      {pesos(m.hoy)} → {pesos(m.queda)}
                    </span>
                    {/* Gris, no verde ni óxido: el precio baja pero la ganancia
                        queda igual, así que no es plata que entre ni que salga. */}
                    <span className="k-num" style={{ color: "var(--humo-claro)" }}>
                      {conSigno(m.dif)}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
