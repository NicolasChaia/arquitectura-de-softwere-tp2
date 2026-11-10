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


---

# P4 y P5. Nodos de 1 vCPU (`Standard_F1as_v7`)

Escrito el 10/11, **antes** de levantar la infraestructura con el SKU nuevo. P1–P3 quedan como estaban: P1 y P2 se midieron con `Standard_D2as_v4` (`results/1-nodo/`). P3 no se pudo medir porque el `apply` con 2 nodos `D2as_v4` superó la cuota de 4 vCPU de la región (`results/2-nodos/apply-error-cuota.txt`).

## Por qué cambia la máquina

| Hecho | Fuente |
| --- | --- |
| Cuota Free Trial: **4 vCPU por región**. 2 nodos `D2as_v4` + jumpbox `D2as_v4` = 6 | `results/2-nodos/apply-error-cuota.txt` |
| Jumpbox `D2as_v4` (2 vCPU) + 2 nodos de 1 vCPU = **4** | `variables.tf` (`machine_sku`, `node_sku`) |
| En `eastus` la suscripción no ofrece `DS1_v2`, `F1s`, `A1_v2` ni la serie B. Los únicos SKU de 1 vCPU son de la familia F v7 de AMD | `results/2-nodos/sku-1vcpu-eastus.txt` |
| `F1as_v7` se pudo crear como VMSS en `eastus` (prueba descartable, 50 s, disco NVMe elegido por Azure) | `results/2-nodos/sku-1vcpu-eastus.txt` |

Para comparar 1 contra 2 nodos con la misma máquina, se vuelve a medir 1 nodo con `F1as_v7` (`results/1-nodo-f1as/`). El caso escalado va a `results/2-nodos-f1as/`.

## Las dos máquinas

| | `D2as_v4` (medido) | `F1as_v7` (nuevo) |
| --- | --- | --- |
| Procesador | AMD EPYC 7452, Zen 2, hasta 3,35 GHz | AMD EPYC 9005 (Turin), Zen 5, hasta 4,5 GHz |
| vCPU | **2 hilos SMT de un mismo core físico** | **1 core físico entero, sin SMT** |
| Memoria | 8 GiB | 4 GiB |
| Créditos de CPU | no | no |
| Fuente | `results/1-nodo/nodos-lscpu.txt`; Microsoft Learn, serie Dasv4 | Microsoft Learn, serie Fasv7 |

La expectativa inicial del grupo era "un costo mayor y una capacidad menor, posiblemente por debajo del rate limit de 500". Eso supone que 1 vCPU de `F1as_v7` rinde como 1 vCPU de `D2as_v4`, y no es así. Un vCPU de `D2as_v4` es medio core Zen 2 compartido con otro hilo; el de `F1as_v7` es un core Zen 5 entero con más frecuencia. Lo que se pierde es la posibilidad de correr dos cosas a la vez: el hilo principal de Node, los hilos del recolector de basura y de libuv, el agente de Datadog y el kernel (red y TLS) se turnan en un solo core.

## Datos medidos con 1 nodo `D2as_v4` que se usan acá

CPU del host como fracción de **1 vCPU** (el gráfico muestra % de 2 vCPU). Leídos de los screenshots de Datadog.

| Carga | CPU del host | Proceso Node (todos los hilos) | ELU | Fuente |
| --- | --- | --- | --- | --- |
| 400 req/s, 0 429 | 36 % de 2 → **0,72** | ≈ 0,6 | 0,47 | `results/1-nodo/exchange-stress-4.png` |
| 200 req/s, 0 429 | 23 % de 2 → **0,47** | — | — | `results/1-nodo/exchange-stress-4.png` |
| ~500 aceptadas + ~150 429/s | 45 % de 2 → **0,90** | 0,73 | 0,60 | `results/1-nodo/exchange-capacity-4.png` |
| ~500 aceptadas + ~300 429/s | 47 % de 2 → **0,95** | ≈ 0,78 | ≈ 0,62 | `results/1-nodo/exchange-stress-4.png` |
| ~500 aceptadas + ~1.100 429/s | 57 % de 2 → **1,14** | 0,95 | 0,78 | `results/1-nodo/exchange-stress-4.png` |

Entre el proceso Node y el host hay **≈ 0,17–0,19 vCPU** de otros procesos (agente de Datadog, pm2, kernel).

## Factor de conversión entre máquinas (f)

**f ≈ 1,5** (rango **1,2–2,0**): un segundo de CPU de `D2as_v4` equivale a 1 / f segundos de CPU de `F1as_v7`.

- Frecuencia máxima: 4,5 / 3,35 ≈ 1,34.
- Tres generaciones de microarquitectura (Zen 2 → 5) con mejoras de IPC del orden de 15–20 % cada una, según AMD.
- En `D2as_v4`, cuando los dos hilos SMT trabajan a la vez, cada uno rinde menos que un core entero, así que la CPU medida ahí está inflada.

Multiplicados darían más de 2. Usamos **1,5** porque buena parte del trabajo por request (syscalls, red virtualizada, TLS hacia Redis, accesos a memoria) no escala con IPC ni con frecuencia. **f no está medido: es la mayor incertidumbre de estas predicciones.** Se puede despejar después comparando la CPU de `results/1-nodo-f1as/` con la de `results/1-nodo/` a la misma carga.

## Capacidad de 1 nodo `F1as_v7` (C₁')

CPU esperada del host (fracción de 1 vCPU) = CPU medida en `D2as_v4` / f:

| Carga | f = 1,2 | **f = 1,5** | f = 2,0 |
| --- | --- | --- | --- |
| 400 req/s | 0,60 | **0,48** | 0,36 |
| 500 + 150 429/s | 0,75 | **0,60** | 0,45 |
| 500 + 1.100 429/s | 0,95 | **0,76** | 0,57 |

Con 500 aceptadas, cada request cuesta ≈ 0,60 / 500 = **1,2 ms de CPU del nodo**. Saturar el único core daría ≈ 830 req/s; con un margen del 15 % para que la cola de CPU no crezca, **C₁' ≈ 700 req/s** (570 con f = 1,2; 940 con f = 2,0).

**El techo de 1 nodo sigue siendo el rate limit de 500 req/s, no la CPU.** Para que el nodo se sature antes de 500 req/s, f tendría que ser < 1,06 (0,90 / 0,85), o sea, que un core Zen 5 entero no rinda más que un hilo SMT de Zen 2.

**ELU esperado.** Con 1 vCPU el ELU deja de medir solo el trabajo del hilo principal. Si el kernel le saca el core en medio de un callback para correr otro hilo, ese tiempo cuenta como "ocupado". Aproximación: ELU' ≈ (ELU / f) / (1 − otros), donde otros = (CPU del host − ELU) / f es la parte del core que usan los demás hilos y procesos.

- 400 req/s: (0,47 / 1,5) / (1 − 0,17) ≈ **0,38**
- 500 + 150 429/s: (0,60 / 1,5) / (1 − 0,20) ≈ **0,50**
- 500 + 1.100 429/s: (0,78 / 1,5) / (1 − 0,24) ≈ **0,68**

**Latencia.** Con 1,2 ms por request y el core al 60 %, la espera por CPU es del orden de 1,2 × 0,6 / 0,4 ≈ 2 ms, despreciable frente a los ~600 ms de ARCA y la red. Al 76 % (escalón de 1.600) sube a ~4 ms. La latencia no cambia respecto de `D2as_v4` mientras la CPU no se acerque al 100 %.

## P4.a. 1 nodo `F1as_v7`, `root` (GET `/`, 1 req/s)

- **p50 144 ms, p95 ≤ 150 ms**, igual que `results/1-nodo/root.json` (144 / 147). Es pura red: L = 144 ms.

## P4.b. 1 nodo `F1as_v7`, carga normal (`exchange`, 5 req/s)

| Métrica | Predicción | Por qué |
| --- | --- | --- |
| Códigos | 200 ≈ 49 %, 403 ≈ 25 %, 503 ≈ 26 % | lo define ARCA (con `D2as_v4` se midió 52 / 23 / 25) |
| 409, 429, 500, timeouts | **0** | 5 req/s ≪ 500 |
| Latencia Artillery | p50 **659 ms ± 5 %**, p95 **983 ms ± 5 %** | igual que P1 medido: con 5 req/s la CPU del nodo no aparece en la latencia |
| CPU del nodo | **< 5 %** | 5 × 1,2 ms ≈ 0,6 % + el agente de Datadog |

## P4.c. 1 nodo `F1as_v7`, estrés (`exchange-stress`: 50, 100, 200, 400, 800 y 1.600 req/s)

| Escalón | Predicción | `D2as_v4` (medido) |
| --- | --- | --- |
| ≤ 400 | 0 429, sin timeouts, latencias ± 5 % de las medidas. Con 400: **CPU ≈ 48 %** (36–60 %), **ELU ≈ 0,38** | CPU 36 % de 2 vCPU, ELU 0,47 |
| 800 | **~500 resp/s no-429** + ~300 429/s, igual que con `D2as_v4`. **CPU ≈ 63 %** (48–79 %) | ~500 no-429 + ~300 429/s |
| 1.600 | **~500 resp/s no-429** + ~1.100 429/s. **CPU ≈ 76 %** (57–95 %), **ELU ≈ 0,68**. Sin timeouts; p95 de los 200 a ≤ +5 % del medido | ~500 no-429 + ~1.100 429/s, CPU 57 % de 2 vCPU, ELU 0,78 |

La CPU sube al pasar de 2 vCPU a 1 (45 % de 2 → ~60 % de 1 con 500 aceptadas), pero el throughput no-429 es el mismo. **Señal de que la predicción falla:** con f ≤ 1,2, en el escalón de 1.600 la CPU llega a ~95 %. Ahí aparecerían cola de CPU, timeouts y menos de 500 resp/s no-429, y el cuello de botella pasaría a ser el nodo.

## P4.d. 1 nodo `F1as_v7`, capacidad (`exchange-capacity`: 150 a 650 req/s)

- **Igual que con `D2as_v4`:** estable hasta 500; los primeros 429 en el escalón de 550 (con `D2as_v4`: 1 en el de 500 y 51/s en el de 550); desde ahí, **no-429 plano en ~500 resp/s**. Latencia plana: p50 ≈ 630 ms, p95 ≈ 965 ms.
- CPU al final (650 de entrada) ≈ **60 %** (45–75 %).

## P4.e. 1 nodo `F1as_v7`, consistencia (`exchange-concurrency-overdraft`)

- **Exactamente 51 respuestas 200** y saldo final de **1.011,4 USD**, como se midió con `D2as_v4`. La cantidad la definen el saldo y la tasa, no la máquina.

---

# P5. Caso escalado: 2 nodos `F1as_v7`

## Capacidad con 2 nodos (C₂')

| Componente | ¿Se replica al escalar? | Límite estimado | Uso con 1.000 req/s aceptadas |
| --- | --- | --- | --- |
| Rate limit | sí, uno por nodo | 2 × 500 = **1.000 req/s** | 100 % → **limita** |
| CPU del nodo (1 vCPU) | sí | 2 × ~700 ≈ **1.400 req/s** (1.140–1.880) | ≈ 60 % por nodo |
| ARCA (ACI, 0,5 vCPU) | **no**, compartido | ≈ 2.100 req/s (P3) | ≈ 230 milicores (~46 %) |
| Managed Redis B0 | **no**, compartido | sin dato de techo | ~9.400 ops/s, CPU ≈ 40 % (P3) |
| Generador (PC de las mediciones) | — | ≥ 1.600 req/s probado | — |

**C₂' ≈ 1.000 req/s.**

## Hipótesis central: ¿escala ×2 el throughput?

**Sí: ×2, de ~500 a ~1.000 resp/s no-429, con un margen de −3 %** por el reparto por conexión del Load Balancer (ver P3).

El argumento es más fuerte que en P3. Aunque f resultara bajo y cada nodo de 1 vCPU se saturara por CPU antes de 500 req/s, **la CPU también se replica con cada nodo**: el throughput seguiría duplicándose, solo que a partir de un valor menor. Lo único que puede impedir el ×2 son los componentes compartidos, y ARCA y Redis quedan por debajo del 50 % con el doble de carga.

Sin rate limit, el próximo límite con 2 nodos `F1as_v7` sería la **CPU de los nodos, cerca de 1.400 req/s**, antes que la degradación de ARCA (~1.600, ejecución previa). Con 2 nodos `D2as_v4`, P3 lo ubicaba en 1.600–1.700.

## P5.a. 2 nodos, carga normal (`exchange`, 5 req/s)

- Igual que P4.b: códigos 49 / 25 / 26 %, 0 429/409/500/timeouts, p50 **659 ms ± 5 %**, p95 **983 ms ± 5 %**.
- Los 2 nodos reciben tráfico, cada uno entre **30 % y 70 %** (pocas conexiones con `pool: 50`).

## P5.b. 2 nodos, estrés (`exchange-stress`)

| Escalón | Predicción | 1 nodo `F1as_v7` (P4.c) |
| --- | --- | --- |
| ≤ 400 | 0 429; con 400, CPU por nodo ≈ **31 %** (200 req/s cada uno: 0,47 / 1,5). No es la mitad de 48 % porque hay un costo fijo (agente de Datadog, kernel) | ≈ 48 % con 400 |
| 800 | **0 429**, ~800 resp/s no-429; CPU por nodo ≈ **48 %** (400 req/s cada uno) | ~500 no-429 + ~300 429/s |
| 1.600 | **~1.000 resp/s no-429** + ~600 429/s; CPU por nodo ≈ **63 %** (48–79 %: 500 aceptadas + 300 429/s cada uno); ARCA ≈ 45–50 %; Redis ≈ 40 % | ~500 no-429 + ~1.100 429/s |

En ningún escalón hay timeouts.

## P5.c. 2 nodos, capacidad (`exchange-capacity` y `exchange-capacity-2n`)

- **`exchange-capacity` (150 a 650): 0 429 en todos los escalones** y latencia plana (p50 ≈ 630, p95 ≈ 965 ms). Cada nodo recibe ≤ ~340 req/s.
- **`exchange-capacity-2n` (600 a 1.400): estable hasta 900, primeros 429 en el escalón de 1.000 (≤ 5 %) y desde 1.100 no-429 plano en 970–1.000 resp/s.** CPU por nodo con 1.400 de entrada (500 aceptadas + 200 429/s cada uno) ≈ **62 %**. Sin timeouts.

## P5.d. 2 nodos, consistencia (`exchange-concurrency-overdraft`)

- **Exactamente 51 respuestas 200 y saldo final de 1.011,4 USD**, igual que P3.d: la reserva es un script Lua atómico en el Redis compartido.
