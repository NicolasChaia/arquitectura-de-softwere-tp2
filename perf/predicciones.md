# Predicciones antes de medir


## Datos de entrada

Las filas marcadas con *ejecución previa* se midieron con la imagen real de `arca.tf`. El método está en `perf/ejecucion-previa/README.md`.

| Dato                           | Valor                                                                                       | Fuente                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| L                              | **144 ms**                                                                                  | `perf/results/baseline/root.json`                           |
| Resultados de ARCA (n = 5.000) | **49 % aprobados, 25 % rechazados, 26 % error 500**                                         | ejecución previa: `resultados/arca-distribucion-5000.txt`   |
| Latencia de ARCA               | aprobado o rechazado: 200–520 ms (p50 358); error: p50 6 ms                                 | ejecución previa: `resultados/arca-distribucion-5000.txt`   |
| Costo de un `POST /exchange`   | **1,70 ms de hilo principal**, **3,35 ms de CPU** del proceso                               | ejecución previa: `resultados/app-saturacion-proceso.jsonl` |
| Capacidad de ARCA (0,5 vCPU)   | sin cambios hasta 800 req/s (0,375 ms de CPU por validación)                                | ejecución previa: `resultados/arca-capacidad*.{json,txt}`   |
| Procesos de Node por nodo      | **1** (`pm2 start app.js`)                                                                  | `ansible/vmss_deploy.yml`, l. 17                            |

## Modelo de latencia (sin carga)

Según el resultado de ARCA (`node/services/exchange.js`):

- **200** = ARCA (200–520) + Redis (~5) + 2 transferencias en paralelo, máx. de dos U(200, 400) (p50 341) → servidor **p50 701 / p95 867 ms**
- **403** = ARCA + log → **364 / 507 ms**
- **503** = falla de ARCA + log → **10 / 51 ms**
- **Mezcla 49/25/26** → servidor **501 / 840 ms** → Artillery (+ L) **645 / 984 ms**

El modelo se validó contra la app corriendo localmente: midió **493 / 829 ms** (`resultados/app-escalones.json`).

## Capacidad de 1 nodo (C₁)

**C₁ ≈ 240 req/s.** El costo por request medido en la ejecución previa (3,35 ms de CPU) se ajusta a la CPU de la VM de Azure, que es más lenta que la PC local y tiene sus 2 vCPU en un mismo core. Queda en ~4,2 ms por request, y 1 / 4,2 ms ≈ 240 req/s.

---

## P1. 1 nodo, carga normal (`exchange`, 5 req/s)

| Métrica                 | Predicción                                  | Por qué                          | Dónde se mide        |
| ----------------------- | ------------------------------------------- | -------------------------------- | -------------------- |
| Códigos                 | 200: **49 %**, 403: **25 %**, 503: **26 %** | distribución de ARCA             | reporte de Artillery |
| 409, 429, 500, timeouts | **0**                                       | saldo ARS en 10¹²; 5 ≪ 240 req/s | reporte de Artillery |
| Latencia Artillery p95  | **985 ms**                                  | modelo de latencia               | reporte de Artillery |

## P2. 1 nodo, estrés (`exchange-stress`: escalones de 50, 100, 200, 400, 800 y 1600 req/s)

| Escalón    | Predicción                                                    | Por qué                                                                                                               |
| ---------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| ≤ 200      | latencias **± 5 % de P1**, sin timeouts; ELU de 0,8–0,9 a 200 | 200 < C₁: es ~80 % de la capacidad                                                                                    |
| **400**    | **colapso**: ELU = 1, timeouts, throughput **≤ 120 resp/s**   | 400 > C₁. En la ejecución previa, al pasar la capacidad el throughput cayó al 42 % (`resultados/app-saturacion.json`) |
| 800 y 1600 | sigue colapsado                                               | rate limit                                                                                                            |


## P2.b. 1 nodo, capacidad (`exchange-capacity`: escalones de 50 req/s, de 150 a 650)

- **Último escalón estable: 200 req/s; colapso en el de 250.**
- **Por qué:** 200 < C₁ ≈ 240 < 250.

## P2.c. 1 nodo, consistencia (`exchange-concurrency-overdraft`: 600 requests de 1.750.000 ARS → USD)

- **50 respuestas 200 y saldo final de 1.095 USD**, nunca negativo. Del resto: 503 ≈ 150, 403 ≈ 152 y 409 ≈ 244.
- **Por qué:** cada exchange pide ~1.155 USD (1.750.000 ARS × 0,00066) y la cuenta arranca con 60.000 USD: alcanzan para ~50. El resto se reparte según los porcentajes de ARCA: 26 % de 503, y de los demás, un tercio de 403 y dos tercios aprobados, que sin fondos dan 409.

---

# P3. Caso escalado: 2 nodos

Escrito el 10/11, después de medir 1 nodo (commit `92e84eb`) y **antes** de levantar los 2 nodos.

## Datos medidos con 1 nodo que se usan acá

| Dato | Valor | Fuente |
| --- | --- | --- |
| Techo de 1 nodo | **~500 resp/s no-429** con 800 y 1600 req/s de entrada; el resto son 429 | `results/1-nodo/exchange-stress.json`, `exchange-capacity.json` |
| Causa del techo | rate limit de **500 req/s por proceso** (`exchangeMax`), en memoria (`express-rate-limit`, store por defecto) | `node/createApp.js`, l. 22; `node/middleware/rateLimit.js` |
| Hilo principal en Azure | ELU ≈ 0,27 con 200 req/s, ≈ 0,47 con 400 y ≈ 0,6 con 500 aceptadas → **≈ 1,2 ms por request** (local: 1,70) | `results/1-nodo/exchange-stress-4.png`, `exchange-capacity-4.png` (leídos del gráfico) |
| Costo de un 429 | ≈ 0,2 ms de hilo principal (ELU 0,62 → 0,78 al pasar de ~300 a ~1100 429/s) | `results/1-nodo/exchange-stress-4.png` |
| ARCA con ~500 validaciones/s | **105–115 milicores** (~22 % de 0,5 vCPU) → ≈ 0,23 ms de CPU por validación | `results/1-nodo/exchange-stress-azure.txt`, `exchange-capacity-azure.txt` |
| Managed Redis con ~500 req/s | ~4.700 ops/s (≈ 9,4 por request); CPU 28–30 % contra 17 % en reposo | `results/1-nodo/exchange-capacity-azure.txt` |
| Generador | sostuvo 1.600 req/s de entrada sin errores propios | `results/1-nodo/exchange-stress.json` |
| Latencia con 5 req/s (P1 medido) | Artillery p50 **659 ms**, p95 **983 ms** | `results/1-nodo/exchange.json` |

**Reparto del LB.** El Load Balancer Standard de Azure reparte por hash de la 5-tupla, o sea **por conexión TCP**, no por request. Artillery reusa conexiones (`pool: 1000` en estrés y capacidad, `pool: 50` en los demás). Con cientos de conexiones el reparto debería quedar en **50 % ± 3 %** por nodo. Con pocas conexiones (escenarios de `pool: 50` y carga baja) puede ser bastante más desparejo.

## Capacidad con 2 nodos (C₂)

| Componente | ¿Se replica al escalar? | Límite estimado | Uso con 1.000 req/s aceptadas |
| --- | --- | --- | --- |
| Rate limit | sí, uno por nodo | 2 × 500 = **1.000 req/s** | 100 % → **limita** |
| Hilo principal de Node | sí | 2 × (1 / 1,2 ms) ≈ 1.660 req/s | ELU ≈ 0,6 por nodo |
| ARCA (ACI, 0,5 vCPU) | **no**, compartido | ≈ 2.100 req/s por CPU (0,5 / 0,23 ms); en la ejecución previa local la latencia ya se degradó con 1.600 | ≈ 230 milicores (~46 %) |
| Managed Redis B0 | **no**, compartido | sin dato de techo | ~9.400 ops/s, CPU ≈ 40 % |
| Generador (PC) | — | ≥ 1.600 req/s probado | — |

**C₂ ≈ 1.000 req/s.**

## Hipótesis central: ¿escala ×2 el throughput?

**Sí: ×2, de ~500 a ~1.000 resp/s no-429, con un margen de −3 %.** El componente que limita con 1 nodo (el rate limit) se replica con cada nodo, y los dos componentes compartidos (ARCA y Redis) quedan por debajo del 50 % con el doble de carga.

Esto es escalar un **límite de política, no un recurso**: el rate limit no es global, así que el límite total del sistema crece con N sin que nadie lo decida. Si no existiera, el próximo límite de 2 nodos estaría cerca de **1.600–1.700 req/s**, donde se juntan el hilo principal de los dos nodos (~1.660) y la degradación de ARCA observada en la ejecución previa (1.600). Con **3 o más nodos el throughput ya no escalaría proporcionalmente: lo impediría ARCA**, que es un único contenedor de 0,5 vCPU que el VMSS no replica (3 × 830 ≈ 2.500 > ~2.100).

El −3 % sale del reparto por conexión: el nodo que recibe más del 50 % llega a 500 req/s antes, así que los primeros 429 aparecen un poco por debajo de 1.000 req/s de entrada.

## P3.a. 2 nodos, carga normal (`exchange`, 5 req/s)

| Métrica | Predicción | Por qué |
| --- | --- | --- |
| Códigos | 200 ≈ 49 %, 403 ≈ 25 %, 503 ≈ 26 % | igual que P1: lo define ARCA |
| 409, 429, 500, timeouts | **0** | 5 req/s ≪ C₂ |
| Latencia Artillery | p50 **660 ms ± 5 %**, p95 **985 ms ± 5 %** (igual que P1 medido) | con 5 req/s no hay cola: el nodo extra no cambia el costo de cada request |
| Reparto entre nodos | los 2 nodos reciben tráfico, cada uno entre 30 % y 70 % | pocas conexiones (`pool: 50`, ~4 concurrentes) → hash muy desparejo |

## P3.b. 2 nodos, estrés (`exchange-stress`: 50, 100, 200, 400, 800 y 1.600 req/s)

| Escalón | Predicción | 1 nodo (medido) |
| --- | --- | --- |
| ≤ 400 | latencias iguales a P3.a (± 5 %), 0 429; ELU por nodo ≈ la mitad que con 1 nodo (≈ 0,25 con 400) | ELU ≈ 0,47 con 400 |
| **800** | **0 429**, ~800 resp/s no-429; ELU ≈ 0,5 por nodo | ~500 no-429 + ~300 429 por segundo |
| **1.600** | **~1.000 resp/s no-429** y ~600 429/s; ELU ≈ 0,65 por nodo (500 × 1,2 ms + 300 × 0,2 ms); ARCA ≈ 45–50 % de su CPU; Redis ≈ 40 % | ~500 no-429 + ~1.100 429 por segundo |

En ningún escalón hay timeouts. La mediana total de Artillery baja en los escalones con 429, porque los 429 responden en ~L. La latencia de los 200 no cambia.

## P3.c. 2 nodos, capacidad (`exchange-capacity`: 150 a 650 req/s) y `exchange-capacity-2n` (600 a 1.400 req/s)

- **`exchange-capacity`: 0 429 en todos los escalones** (con 1 nodo aparecieron desde 550) y latencia plana: p50 ≈ 630 ms, p95 ≈ 965 ms, como con 1 nodo.
- **`exchange-capacity-2n`** (escenario nuevo, mismo flujo y `pool`, escalones de 100 req/s): **estable hasta 900**, los **primeros 429 en el escalón de 1.000** (≤ 5 %) y **desde 1.100 el throughput no-429 queda plano en 970–1.000 resp/s**. La latencia de los 200 no cambia; no hay timeouts ni errores fuera de los 503 de ARCA (~26 %). Con 1.400 de entrada, la concurrencia es ~1.000 × 0,63 s + 400 × 0,15 s ≈ 690 conexiones, así que el `pool: 1000` no limita.

## P3.d. 2 nodos, consistencia (`exchange-concurrency-overdraft`)

- **Exactamente 51 respuestas 200** y saldo final de **≈ 1.011 USD**, nunca negativo. Del resto: 503 ≈ 26 %, 403 ≈ 25 % y 409 para los aprobados sin fondos.
- **Por qué:** cada exchange pide 1.750.000 / 1.513 = 1.156,6 USD y la cuenta arranca en 60.000: alcanzan para 51 (60.000 − 51 × 1.156,6 = 1.011,4). La reserva es un script Lua atómico en Redis, que es compartido. Que los requests lleguen a 2 procesos distintos no cambia nada. (P2.c predijo 50 con una tasa redondeada a 0,00066; con 1 nodo se midieron 51.)

