#!/bin/bash
# Corre los requests de ejemplo contra la app real levantada en la PC, con ARCA y
# Redis en Docker (mismos contenedores que perf/ejecucion-previa), y agrega los casos
# que requieren tocar las dependencias: Redis caído, ARCA caído y TS1 (ARCA_RETRIES=1).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="$ROOT/perf/requests-ejemplo"
OUT="$ROOT/perf/results/requests-ejemplo"
BASE=http://localhost:3000
export ARCA_URI=http://localhost:18080 REDIS_URL=redis://localhost:16379
JSON='Content-Type: application/json'
mkdir -p "$OUT"

ensure() { # ensure <nombre> <args de docker run...>
  local name="$1"; shift
  docker start "$name" >/dev/null 2>&1 || docker run -d --name "$name" "$@" >/dev/null
}
ensure tp2-arca --cpus 0.5 --memory 512m -p 18080:8080 arqsoft/arca:1.0.0
ensure tp2-redis -p 16379:6379 redis:7.4
sleep 3
docker exec tp2-redis redis-cli FLUSHALL >/dev/null

APP_PID=""
start_app() { # start_app <archivo de log> [VAR=valor...]
  local log="$1"; shift
  ( cd "$DIR" && exec env "$@" node app-local.mjs >"$log" 2>&1 ) &
  APP_PID=$!
  for _ in $(seq 1 50); do curl -s -o /dev/null "$BASE/" && return 0; sleep 0.2; done
  echo "la app no arrancó; ver $log" >&2; exit 1
}
stop_app() { kill "$APP_PID" 2>/dev/null; wait "$APP_PID" 2>/dev/null; sleep 1; }
exch() {
  echo "\$ curl -s -i -X POST $BASE/exchange -H '$JSON' -d '{\"baseCurrency\":\"USD\",\"counterCurrency\":\"ARS\",\"baseAccountId\":100,\"counterAccountId\":101,\"baseAmount\":100,\"dni\":\"$1\"}'"
  curl -s -i -m 10 -X POST "$BASE/exchange" -H "$JSON" \
    -d "{\"baseCurrency\":\"USD\",\"counterCurrency\":\"ARS\",\"baseAccountId\":100,\"counterAccountId\":101,\"baseAmount\":100,\"dni\":\"$1\"}"
  echo
}

entorno() {
  echo "# Entorno: app real (node/app.js vía perf/requests-ejemplo/app-local.mjs, Node $(node -v)) en la PC del grupo,"
  echo "# ARCA arqsoft/arca:1.0.0 en Docker (--cpus 0.5 --memory 512m, como arca.tf), Redis 7.4 en Docker (sin TLS)."
  echo "# Rate limit de /exchange: 500 req/s local (valor por defecto de node/config.js)."
}

# --- 1) Requests generales, ARCA_RETRIES=0 (baseline) ---
start_app "$OUT/app-log.txt" ARCA_RETRIES=0
{ entorno; BASE=$BASE "$DIR/requests.sh"; } > "$OUT/requests.txt"

# --- 2) Dependencias caídas ---
{
  entorno
  echo "# Fecha: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "### 1. ARCA caído (docker stop tp2-arca): el exchange falla cerrado con 503, reason=unreachable, sin reservar fondos"
  echo "\$ docker stop tp2-arca"; docker stop tp2-arca >/dev/null; echo
  exch 12345678
  echo "\$ docker start tp2-arca"; docker start tp2-arca >/dev/null; sleep 3; echo
  echo "### 2. Redis caído (docker stop tp2-redis): GET /health responde 503 degraded"
  echo "\$ docker stop tp2-redis"; docker stop tp2-redis >/dev/null; sleep 1; echo
  echo "\$ curl -s -i -X GET $BASE/health"; curl -s -i -m 10 "$BASE/health"; echo; echo
  echo "### 3. GET / sigue respondiendo 200 con Redis caído: la sonda TCP del LB (node.tf) no detectaría la falla"
  echo "\$ curl -s -i -X GET $BASE/"; curl -s -i -m 10 "$BASE/"; echo; echo
  echo "\$ docker start tp2-redis"; docker start tp2-redis >/dev/null; sleep 3; echo
  echo "### 4. Redis de vuelta: GET /health vuelve a 200"
  echo "\$ curl -s -i -X GET $BASE/health"; curl -s -i -m 10 "$BASE/health"; echo
} > "$OUT/dependencias-caidas.txt"
stop_app

# --- 3) TS1: ARCA_RETRIES=1 ---
docker exec tp2-redis redis-cli FLUSHALL >/dev/null
start_app "$OUT/app-log-reintento.txt" ARCA_RETRIES=1
{
  entorno
  echo "# Variante: ARCA_RETRIES=1 (táctica 1, como en ansible/vmss_deploy.yml)."
  echo "# Fecha: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "### 30 exchanges con DNIs distintos; las líneas attempts=2 del log son reintentos ante HTTP 500 de ARCA"
  for i in $(seq 1 30); do
    dni=$((30000000 + i * 7919))
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 -X POST "$BASE/exchange" -H "$JSON" \
      -d "{\"baseCurrency\":\"USD\",\"counterCurrency\":\"ARS\",\"baseAccountId\":100,\"counterAccountId\":101,\"baseAmount\":100,\"dni\":\"$dni\"}")
    echo "dni=$dni -> HTTP $code"
  done
  echo
  echo "### Líneas de ARCA del log de la app (stdout de node/app.js)"
  grep "^ARCA " "$OUT/app-log-reintento.txt"
  echo
  echo "### Resumen"
  echo "validaciones: $(grep -c '^ARCA ' "$OUT/app-log-reintento.txt")"
  echo "con reintento (attempts=2): $(grep -c 'attempts=2' "$OUT/app-log-reintento.txt")"
  echo "error después del reintento (503): $(grep 'attempts=2' "$OUT/app-log-reintento.txt" | grep -c 'status=error')"
} > "$OUT/reintento.txt"
stop_app

echo "listo: $OUT"
ls -1 "$OUT"
