# Ejecución previa local (9/11/2026)

| Componente | Cómo se levantó                                                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARCA       | `docker run --cpus 0.5 --memory 512m -p 18080:8080 arqsoft/arca:1.0.0` (los mismos límites que `arca.tf`)                                                        |
| Redis      | `docker run -p 16379:6379 redis:7.4` (sin TLS, a diferencia de Managed Redis)                                                                                    |
| App        | `app-local.mjs`: arma la app igual que `node/app.js`, pero con ARCA y Redis locales, y loguea cada 2 s las req/s, la CPU del proceso y el ELU del hilo principal |
| Generador  | Artillery 2 de `perf/`, con los mismos flujos que `perf/exchange.yaml`                                                                                           |

## Qué se midió

| Medición                      | Comando                                                                                                   | Resultado                                                                                                                      | Archivo                                                             |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Distribución de ARCA          | `node arca-distribucion.mjs http://localhost:18080/validar 5000 20`                                       | 49,2 % aprobados, 25,3 % rechazados, 25,5 % error 500. Aprobado y rechazado: 202–526 ms (p50 358). Error: p50 6 ms             | `resultados/arca-distribucion-5000.txt`                             |
| Capacidad de ARCA             | `ARCA_TARGET=http://localhost:18080 npx artillery run arca-capacidad.yaml` + `docker stats`               | Latencia sin cambios hasta 800 req/s (0,30 cores); a 1600 req/s, CPU en el tope de 0,5 y p50 de 1–1,7 s                        | `resultados/arca-capacidad.json`, `arca-capacidad-docker-stats.txt` |
| App, escalones con rate limit | `node app-local.mjs <ruta a node/>` + `TARGET=http://localhost:3300 npx artillery run app-escalones.yaml` | Estable hasta 400 req/s (p50 ~490 ms); a 800 req/s colapsa, con 429, ECONNREFUSED y timeouts                                   | `resultados/app-escalones.json`, `app-escalones-proceso.jsonl`      |
| App, capacidad sin rate limit | Ídem con `NO_LIMIT=1` y `app-saturacion.yaml`                                                             | ELU 0,73 a 400 y 0,79 a 500 req/s; **1,0 a 600 → colapso**. 1,70 ms de hilo principal y 3,35 ms de CPU del proceso por request | `resultados/app-saturacion.json`, `app-saturacion-proceso.jsonl`    |
| Techo del generador           | `node servidor-instantaneo.mjs` + `TARGET=http://localhost:5600 npx artillery run generador.yaml`         | 1.600 req/s reales, sin errores                                                                                                | `resultados/generador.json`                                         |

Variables de entorno de `app-local.mjs`: `REDIS_URL=redis://localhost:16379`, `ARCA_URI=http://localhost:18080` y, opcionalmente, `NO_LIMIT=1`.

## Límites de estas mediciones

- **El hardware no es el de Azure.** Los ms de CPU se convierten con el factor k de `perf/predicciones.md` (sección 3), y en Azure se vuelven a medir con `exchange.node.event_loop_utilization` y `exchange.node.process_cpu_cores`.
- **Redis local no usa TLS** y está en la misma máquina: subestima el costo de Redis.
- **ARCA, Redis, la app y el generador comparten la PC** (16 hilos). No se midió la CPU de Artillery, así que no se descarta que le haya quitado algo de CPU a la app en los escalones altos.
