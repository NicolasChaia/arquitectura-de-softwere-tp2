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

# Cambios en el tamaño del vCPU

Se debió reestructurar por el motivo de que no se podía escalar a dos nodos en las pruebas de la segunda instancia debido al tamaño que estos tenían. Por esto es que se bajo a 1 el vCPU

| Hecho                                                                                                                               | Fuente                                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Cuota Free Trial: **4 vCPU por región**. 2 nodos `D2as_v4` + jumpbox `D2as_v4` = 6                                                  | `results/2-nodos/apply-error-cuota.txt`    |
| Jumpbox `D2as_v4` (2 vCPU) + 2 nodos de 1 vCPU = **4**                                                                              | `variables.tf` (`machine_sku`, `node_sku`) |
| En `eastus` la suscripción no ofrece `DS1_v2`, `F1s`, `A1_v2` ni la serie B. Los únicos SKU de 1 vCPU son de la familia F v7 de AMD | `results/2-nodos/sku-1vcpu-eastus.txt`     |
| `F1as_v7` se pudo crear como VMSS en `eastus` (prueba descartable, 50 s, disco NVMe elegido por Azure)                              | `results/2-nodos/sku-1vcpu-eastus.txt`     |

Para comparar 1 contra 2 nodos con la misma máquina, se vuelve a medir 1 nodo con `F1as_v7` (`results/1-nodo-f1as/`). El caso escalado va a `results/2-nodos-f1as/`.

## Capacidad de 1 nodo `F1as_v7`

Con 1 nodo `D2as_v4`, el nodo llegó al rate limit de **500 req/s** sin colapsar. En ese punto la VM usaba ~45 % de sus 2 vCPU, o sea, **~0,9 vCPU** (`results/1-nodo/exchange-capacity-4.png`).

`F1as_v7` tiene 1 vCPU. En `D2as_v4`, en cambio, cada vCPU es medio core compartido (`results/1-nodo/nodos-lscpu.txt`). Por eso estimamos que el mismo trabajo ocupa **~70 % del único vCPU**: alcanza para llegar a 500 req/s con margen.

**El límite de 1 nodo va a ser el rate limit de 500 req/s, no la CPU.**

## P4.a. 1 nodo `F1as_v7`, `root` (GET `/`, 1 req/s)

- **p50 145 ms**, igual que con `D2as_v4`. Es solo la red.

## P4.b. 1 nodo `F1as_v7`, carga normal (`exchange`, 5 req/s)

| Métrica | Predicción | Por qué |
| --- | --- | --- |
| Códigos | 200: **50 %**, 403: **25 %**, 503: **25 %** | lo define ARCA, no la máquina |
| 409, 429, 500, timeouts | **0** | 5 req/s ≪ 500 |
| Latencia Artillery | p50 **660 ms**, p95 **985 ms** | igual que P1 medido: con 5 req/s la CPU no influye |
| CPU del nodo | **< 5 %** | la carga es mínima |

## P4.c. 1 nodo `F1as_v7`, estrés (`exchange-stress`: 50, 100, 200, 400, 800 y 1.600 req/s)

| Escalón | Predicción | Por qué |
| --- | --- | --- |
| ≤ 400 | latencias iguales a P4.b, 0 429, sin timeouts. CPU ≈ **55 %** con 400 | 400 < 500 del rate limit, y la CPU alcanza |
| 800 y 1.600 | **~500 resp/s** atendidas con latencia normal, el resto **429**. CPU ≈ **70 %** con 800 y ≈ **80 %** con 1.600 | el rate limit corta en 500, igual que con `D2as_v4`. Los 429 también cuestan algo de CPU |
| Recuperación | vuelve a P4.b enseguida | no queda cola |

## P4.d. 1 nodo `F1as_v7`, capacidad (`exchange-capacity`: 150 a 650 req/s)

- **Estable hasta 500 req/s; desde 550, el excedente sale como 429** y las atendidas quedan en ~500 resp/s.
- **Por qué:** el rate limit corta en 500 antes de que se llene la CPU (~70 %).

## P4.e. 1 nodo `F1as_v7`, consistencia (`exchange-concurrency-overdraft`)

- ** ~50 respuestas 200** y saldo final de **1.095 USD**, nunca negativo. La cantidad la definen el saldo y la tasa, no la máquina.
- **Por qué:** la tasa ARS → USD efectiva es 0,00066, porque `PUT /rates` redondea la recíproca a 5 decimales (`node/services/rates.js` l. 23). Cada exchange pide 1.750.000 × 0,00066 = 1.155 USD: alcanzan para ⌊60.000 / 1.155⌋ = 51 y sobran 60.000 − 51 × 1.155 = 1.095.

---

# P5. Caso escalado: 2 nodos `F1as_v7`

## ¿Escala ×2 el throughput?

**Sí: de ~500 a ~1.000 req/s atendidas.**

- **Por qué:** con 1 nodo lo que limita es el rate limit, y cada nodo tiene el suyo. Con 2 nodos, el límite pasa a **2 × 500 = 1.000 req/s**. La CPU también se duplica: cada nodo tiene su vCPU y atiende lo mismo que con 1 nodo (~50 % de CPU). Pero hay que tener cuidado porque como no se duplican ni ARCA ni Redis sino que se comparten. El otro riesgo es el **Load Balancer**: reparte conexiones, no requests. Si un nodo recibe más de la mitad, llega a su límite de 500 antes que el otro y el total queda un poco por debajo de 1.000. Por eso la predicción es 900 a 1.000.

## P5.a. 2 nodos, `root` y carga normal (`exchange`, 5 req/s)

| Métrica                 | Predicción                                                       | Por qué                                                           |
| ----------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------- |
| `root` p50              | **145 ms**                                                       | es solo la red                                                    |
| Códigos                 | 200: **50 %**, 403: **25 %**, 503: **25 %**                      | lo define ARCA                                                    |
| 409, 429, 500, timeouts | **0**                                                            | 5 req/s ≪ 1.000                                                   |
| Latencia Artillery      | p50 **620 ms**, p95 **965 ms**                                   | igual que con 1 nodo: con 5 req/s la cantidad de nodos no influye |


## P5.b. 2 nodos, estrés (`exchange-stress`: 50, 100, 200, 400, 800 y 1.600 req/s)

| Escalón      | Predicción                                                                                                           | Por qué                                                                                                |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| ≤ 400        | latencia como P5.a, 0 429. CPU por nodo ≈ **25 %** con 400                                                           | cada nodo recibe ~200 req/s: lo mismo que 1 nodo con 200                                               |
| **800**      | **0 429**, ~800 req/s atendidas. CPU por nodo ≈ **40 %**                                                             | 800 < 1.000; cada nodo recibe ~400 (con 1 nodo, en 800 ya había 300/s de 429)                          |
| **1.600**    | **~1.000 req/s atendidas** y ~600/s de 429, sin timeouts. CPU por nodo ≈ **55 %**. ARCA ≈ **50 %**, Redis ≈ **30 %** | el rate limit corta en 2 × 500. Cada nodo recibe ~800: lo mismo que 1 nodo en el escalón de 800 (52 %) |


## P5.c. 2 nodos, capacidad (`exchange-capacity` y `exchange-capacity-2n`)

- **`exchange-capacity` (150 a 650): 0 429 en todos los escalones**, latencia plana (p50 ≈ 620 ms, p95 ≈ 965 ms). Con 1 nodo aparecían desde 550.
  - **Por qué:** con 650 de entrada, cada nodo recibe ~325, por debajo de su límite de 500.
- **`exchange-capacity-2n` (600 a 1.400): estable hasta 900; los 429 aparecen entre 1.000 y 1.100**, y desde ahí las atendidas quedan planas en **~1.000 req/s**. Sin timeouts. CPU por nodo ≈ **55 %** al final.
  - **Por qué:** 2 × 500 = 1.000. Si el reparto del LB no es parejo, los primeros 429 pueden aparecer un escalón antes.

## P5.d. 2 nodos, consistencia (`exchange-concurrency-overdraft`)

- **51 respuestas 200** y saldo final de **1.095 USD**, nunca negativo. Igual que con 1 nodo.
- **Por qué:** la reserva es un script Lua atómico en el Redis compartido. Da igual a qué nodo llegue cada request: los dos descuentan del mismo saldo.

---

# P6. Táctica 1: reintento ante errores de ARCA (2 nodos `F1as_v7`)

Escrito el 12/11, después de medir 2 nodos (`results/2-nodos-f1as/`) y **antes** de implementar la táctica.

## Problema observado

Con 2 nodos y 5 req/s, el **22–26 % de los clientes recibe 503** porque ARCA respondió HTTP 500 (`results/2-nodos-f1as/exchange.json`; `results/1-nodo-f1as/exchange.json`). No es falta de capacidad: pasa igual con 5 req/s que con 1.000.

## Qué se cambia

- Si ARCA responde **HTTP 5xx**, la app la vuelve a llamar **1 vez** (`ARCA_RETRIES=1`, configurado por Ansible). **No se reintentan los timeouts** (3 s): si ARCA está saturada y no responde, reintentar le sumaría carga justo cuando no puede atenderla.
- Es seguro reintentar: validar no tiene efectos y ocurre **antes** de reservar fondos (`node/services/exchange.js`), así que no hay riesgo de cobrar dos veces.
- Todo lo demás queda como en `2-nodos-f1as`: 2 nodos `F1as_v7`, rate limit local de 500 req/s por nodo.

## Datos que se usan

| Dato | Valor | Fuente |
| --- | --- | --- |
| Errores de ARCA | **26 % por llamada, al azar**: un mismo DNI falla en una llamada y responde bien en la siguiente | `ejecucion-previa/resultados/arca-determinismo.txt` |
| Aprobado o rechazado | depende siempre del DNI (0 casos mezclados en 200) → el reintento no cambia la proporción 2:1 entre 200 y 403 | ídem; `results/2-nodos-f1as/exchange.json` (51,8 % / 25,9 %) |
| Latencia de un error de ARCA | p50 **6 ms** | `ejecucion-previa/resultados/arca-distribucion-5000.txt` |
| ARCA con ~1.000 req/s (2 nodos) | **50 %** de su CPU | `results/2-nodos-f1as/exchange-capacity-2n-azure.txt` |
| Redis con ~1.000 req/s | ~9.400 ops/s (≈ 9,4 por request), CPU 34 % (14 % en reposo) | ídem |
| Nodos con ~500 req/s cada uno | CPU ≈ **45 %**, ELU ≈ 0,44 | `results/2-nodos-f1as/exchange-capacity(2n)-2n-4.png` |

## Cuentas

- **503:** ahora solo si fallan las 2 llamadas: 0,26² ≈ **7 %** (antes 26 %).
- **El resto se reparte 2:1**, como antes: 200 ≈ 0,93 × 2/3 ≈ **62 %**, 403 ≈ 0,93 × 1/3 ≈ **31 %**.
- **Llamadas a ARCA por request:** 1 + 0,26 = **1,26**.
- **Exchanges exitosos:** pasan de ~50 % a ~62 % de lo atendido (**+25 %**). Un 200 hace más trabajo que un 403 o un 503 (reserva Lua, 2 transferencias, más operaciones de Redis), así que los nodos y Redis trabajan más con la misma cantidad de requests.

## P6.a. Carga normal (`exchange`, 5 req/s)

| Métrica | Predicción | Antes (`2-nodos-f1as`) | Por qué |
| --- | --- | --- | --- |
| 503 | **7 % ± 3** | 22,3 % | 0,26² |
| 200 / 403 | **62 % / 31 %** (± 4) | 51,8 % / 25,9 % | los que antes eran 503 se reparten 2:1 |
| 409, 429, 500, timeouts | **0** | 0 | 5 req/s ≪ 1.000 |
| Latencia Artillery p50 | **~750 ms** (+90) | 659 ms | hay menos 503 rápidos (~10 ms) que tiren la mediana para abajo; el que se reintenta suma solo ~6 ms |
| Latencia Artillery p95 | **~1.000 ms** (+40) | 963 ms | la cola la siguen definiendo los 200; ahora hay más |

## P6.b. Capacidad con 2 nodos (`exchange-capacity-2n`: 600 a 1.400 req/s)

| Métrica | Predicción | Antes | Por qué |
| --- | --- | --- | --- |
| Atendidas (no-429) | **~1.000 req/s**, igual | ~998 | el reintento ocurre después del rate limit: no cambia cuántas entran |
| **200 por segundo** en el tope | **~620** (+25 %) | ~495 | 62 % de 1.000 |
| Llamadas a ARCA en el tope | **~1.260/s** | ~1.000/s | 1,26 por request |
| CPU de ARCA en el tope | **~63 %** (± 5) | 50 % | 50 % × 1,26 |
| Redis en el tope | ~**10.800 ops/s**, CPU **~37 %** | 9.400 ops/s, 34 % | +16 % de operaciones por los 200 de más |
| CPU por nodo en el tope | **~50 %**, ELU ~0,5 | 45 %, 0,44 | más 200 y las llamadas extra a ARCA |
| Timeouts | **0** | 0 | ARCA al 63 % sigue con margen |

## P6.c. Consistencia (`exchange-concurrency-overdraft`)

- **51 respuestas 200 y saldo final de 1.095 USD**, igual que antes: lo que limita es el saldo, no ARCA.
- De las 600: 503 ≈ **40** (7 %; antes 154), 403 ≈ **185** (antes 152) y 409 ≈ **325** (antes 243). Los 409 suben porque ahora hay más aprobados por ARCA que se quedan sin fondos.
- Ningún saldo negativo ni descontado dos veces: el reintento ocurre antes de reservar.

## Tradeoff que se espera ver

Se gana **disponibilidad** (un 503 de cada 4 pasa a 1 de cada 14) a costa de **~26 % más de carga en ARCA**, que es el recurso compartido que no escala. Con el rate limit actual (1.000 req/s) sobra margen. Pero el techo de ARCA, medido en requests de clientes, baja **≈ 1,26 veces**: si ARCA se satura cerca de ~2.300 req/s sin reintento (corrida sin rate limit, pendiente de commitear), con reintento se saturaría cerca de **~1.800**. Ese número se usa para dimensionar la táctica 2.

## Cómo se mide

- Escenarios: `root` (L), `exchange`, `exchange-capacity-2n` y `exchange-concurrency-overdraft`, en `results/tactica-reintento/`, desde la misma ubicación que `2-nodos-f1as`.
- Métrica propia nueva: `exchange.arca.retry` (reintentos por segundo) en Datadog; debería dar ~26 % de las validaciones.
- Azure Monitor (`azure-metrics.sh`) para la CPU de ARCA y la carga de Redis.
