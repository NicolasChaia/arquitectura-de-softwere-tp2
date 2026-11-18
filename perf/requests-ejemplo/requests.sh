#!/bin/bash
# Requests de ejemplo contra arVault, con su response completa (status, headers y cuerpo).
set -uo pipefail
BASE="${BASE:-http://localhost:3000}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JSON='Content-Type: application/json'

step() { echo; echo "### $*"; }
req() {
  # req <método> <path> [cuerpo JSON]
  local m="$1" p="$2" b="${3:-}"
  if [ -n "$b" ]; then
    echo "\$ curl -s -i -X $m $BASE$p -H '$JSON' -d '$b'"
    curl -s -i -m 10 -X "$m" "$BASE$p" -H "$JSON" -d "$b"
  else
    echo "\$ curl -s -i -X $m $BASE$p"
    curl -s -i -m 10 -X "$m" "$BASE$p"
  fi
  echo
}
exch() {
  # exch <dni>: exchange USD -> ARS, mismo cuerpo que perf/exchange.yaml
  req POST /exchange "{\"baseCurrency\":\"USD\",\"counterCurrency\":\"ARS\",\"baseAccountId\":100,\"counterAccountId\":101,\"baseAmount\":100,\"dni\":\"$1\"}"
}

echo "# Requests de ejemplo contra $BASE"
echo "# Fecha: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

step "1. GET / responde sin tocar Redis ni ARCA (node/createApp.js)"
req GET /

step "2. GET /health hace ping a Redis (node/api/health.js)"
req GET /health

step "3. PUT /rates guarda el par y su recíproco redondeado a 5 decimales: USD/ARS 1513 -> ARS/USD 0.00066 (node/services/rates.js)"
req PUT /rates '{"baseCurrency":"USD","counterCurrency":"ARS","rate":1513}'

step "4. DNI fuera de rango -> 400, sin llamar a ARCA (node/api/exchange.js)"
exch 123

step "5. DNI con caracteres no numéricos -> 400"
exch 12a45678

step "6. Exchange sin el campo dni -> 400"
req POST /exchange '{"baseCurrency":"USD","counterCurrency":"ARS","baseAccountId":100,"counterAccountId":101,"baseAmount":100}'

step "7. Exchanges con DNIs válidos: 200 (aprobado, con codigoAutorizacion), 403 (rechazado) o 503 (ARCA devolvió 500)"
for dni in 1000000 99999999 12345678 20304050 33444555 27123456 45678901 30111222 18765432 40101235; do
  exch "$dni"
done

step "8. El mismo DNI repetido: el veredicto (aprobado/rechazado) se mantiene; el 500 de ARCA es al azar"
for i in 1 2 3 4; do exch 27123456; done

step "9. GET /log?limit=5: las últimas operaciones, leídas de Redis (node/repository/log.js)"
req GET "/log?limit=5"

step "10. GET /accounts: saldos después de los exchanges aprobados"
req GET /accounts

step "11. Ráfaga de 700 POST /exchange concurrentes contra un límite de 500 req/s -> el excedente recibe 429 (node/createApp.js)"
echo "\$ node perf/requests-ejemplo/burst.mjs $BASE 700"
node "$DIR/burst.mjs" "$BASE" 700
