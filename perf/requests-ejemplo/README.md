# Requests de ejemplo (request y response)

Ejecución reproducible de las observaciones del informe sobre el código: cada paso guarda el
comando `curl` exacto y la respuesta completa del servidor (status, headers y cuerpo).

| Archivo | Qué hace |
| --- | --- |
| `requests.sh` | Requests generales. Sirve contra cualquier base: `BASE=http://localhost:3000` o `BASE=http://$(cat node/lb_dns)` (Azure) |
| `burst.mjs` | Ráfaga de N `POST /exchange` concurrentes; cuenta los códigos y muestra una respuesta 429 completa |
| `app-local.mjs` | Arranca la app real (`node/app.js`) con `arcaUri` tomado de `ARCA_URI` (en Azure lo escribe Terraform en `node/config.js`) |
| `run-local.sh` | Levanta ARCA y Redis en Docker, la app, y corre todo: `requests.sh`, dependencias caídas y TS1 (`ARCA_RETRIES=1`) |

## Cómo se corrió

Desde la raíz del repo, en Git Bash, con Docker Desktop andando:

```bash
perf/requests-ejemplo/run-local.sh
```

Contenedores: `arqsoft/arca:1.0.0` con `--cpus 0.5 --memory 512m` (como `arca.tf`) y `redis:7.4`
(sin TLS, a diferencia de Managed Redis). Son los mismos que en `perf/ejecucion-previa/`.

## Resultados (`perf/results/requests-ejemplo/`)

| Archivo | Qué muestra |
| --- | --- |
| `requests.txt` | `GET /`; `GET /health` 200; `PUT /rates` con el recíproco 0.00066; DNI inválido o ausente → 400; exchanges 200 (con `codigoAutorizacion`), 403 y 503; mismo DNI repetido (veredicto estable, 500 al azar); `GET /log`; `GET /accounts`; ráfaga de 700 → 500 admitidas y 200 con 429 |
| `dependencias-caidas.txt` | ARCA detenido → 503 `reason=unreachable` (fail closed); Redis detenido → `/health` 503 mientras `GET /` sigue en 200; Redis de vuelta → `/health` 200 |
| `reintento.txt` | Con `ARCA_RETRIES=1`: 30 exchanges y las líneas `attempts=2` del log (reintentos ante HTTP 500) |
| `app-log.txt`, `app-log-reintento.txt` | stdout completo de la app en cada corrida |

