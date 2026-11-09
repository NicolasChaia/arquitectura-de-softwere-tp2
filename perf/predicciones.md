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
