#!/usr/bin/env bash
# Smoke del repo de examen dentro de un contenedor con gate (E3). Dentro de WSL.
#  - los 4 tests siguen fallando a proposito
#  - con applyDiscount implementado en el workspace, /api/price por el front devuelve finalPrice=150
#  - spring-boot:run + npm start; front por app.localhost; /api relativo via proxy de ng serve; API por :8081
set -euo pipefail
source "$(dirname "$0")/lib-session.sh"
CURL_WIN="${CURL_WIN:-/mnt/c/Windows/System32/curl.exe}"
code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }

# el upstream local se vuelve a sembrar con el contenido actual de exam-template/
if ! grep -q '^GITHUB_TOKEN=.\+' "$ROOT/.env" 2>/dev/null; then ensure_upstream; "$ROOT/scripts/local-upstream.sh" seed >/dev/null; fi

start_session 1
wait_ide
KEY=$(gate_key); CK="Cookie: assessment_gate=$KEY"
R_APP="--resolve app.localhost:$PORT:127.0.0.1"

echo "== el clone trae el examen Angular (API relativa, proxy, sin @CrossOrigin, README, requests.http)"
docker exec -u coder "$NAME" test -f /workspace/frontend/proxy.conf.json || sfail "falta frontend/proxy.conf.json"
docker exec -u coder "$NAME" grep -q "proxy.conf.json" /workspace/frontend/angular.json || sfail "angular.json sin proxyConfig"
docker exec -u coder "$NAME" grep -q "'/api/price'" /workspace/frontend/src/app/app.ts || sfail "app.ts sin API relativa"
docker exec -u coder "$NAME" grep -rq CrossOrigin /workspace/src && sfail "sigue @CrossOrigin"
docker exec -u coder "$NAME" test -f /workspace/requests.http || sfail "falta requests.http"
docker exec -u coder "$NAME" test -f /workspace/frontend/main.js && sfail "quedo el front de Vite"
echo "  ok"

echo "== ./mvnw test: los 4 tests siguen fallando"
OUT=$(docker exec -u coder "$NAME" bash -c 'cd /workspace && ./mvnw -B test 2>&1' || true)
echo "$OUT" | grep -E 'Tests run:.*Fail' | tail -1
echo "$OUT" | grep -qE 'Tests run: 4, Failures: 2, Errors: 2' || { echo "$OUT" | tail -30; sfail "se esperaban 4 tests con 2 failures + 2 errors"; }

echo "== spring-boot:run + npm start"
docker exec -u coder -d "$NAME" bash -c 'cd /workspace && ./mvnw -q spring-boot:run > /tmp/api.log 2>&1'
docker exec -u coder "$NAME" bash -c 'cd /workspace/frontend && npm install --no-audit --no-fund > /tmp/npm-install.log 2>&1' || { docker exec "$NAME" tail /tmp/npm-install.log; sfail "npm install"; }
docker exec -u coder -d "$NAME" bash -c 'cd /workspace/frontend && npm start > /tmp/ng-serve.log 2>&1'
for _ in $(seq 1 60); do [ "$(code -H "$CK" $R_APP "http://app.localhost:$PORT/")" = 200 ] && break; sleep 2; done
CODE=$(code -H "$CK" $R_APP "http://app.localhost:$PORT/"); [ "$CODE" = 200 ] || { docker exec "$NAME" tail -20 /tmp/ng-serve.log; sfail "app.localhost/ dio $CODE"; }
echo "  ok  app.localhost:<P>/ -> 200 (front por el gate)"
curl -s -H "$CK" $R_APP "http://app.localhost:$PORT/" | grep -q 'Calculadora de precios' || sfail "el HTML del front no es el esperado"

echo "== /api relativo por app.localhost llega a Spring (via proxy de ng serve)"
for _ in $(seq 1 90); do [ "$(code http://127.0.0.1:8081/api/price?price=200\&percent=25)" != 502 ] && break; sleep 2; done
CODE=$(code -H "$CK" $R_APP "http://app.localhost:$PORT/api/price?price=200&percent=25")
BODY=$(curl -s -H "$CK" $R_APP "http://app.localhost:$PORT/api/price?price=200&percent=25")
echo "  app.localhost/api/price -> $CODE $(echo "$BODY" | cut -c1-120)"
# applyDiscount sin implementar: Spring responde 500 con JSON de error. Lo que importa: no es 502 de gate/proxy ni 404 del dev server.
case "$CODE" in 200|400|500) : ;; *) sfail "/api/price por el front dio $CODE" ;; esac
echo "$BODY" | jq -e 'type == "object"' >/dev/null || sfail "la respuesta no es JSON de Spring"
echo "  NOTA: 500 esperado mientras PriceService.applyDiscount no este implementado"

echo "== applyDiscount implementado en el workspace -> el front recibe finalPrice=150 por /api relativo"
docker exec -u coder "$NAME" sed -i '/UnsupportedOperationException/c\        if (percent < 0 || percent > 100 || price < 0) throw new IllegalArgumentException("invalid"); return price * (100 - percent) / 100.0;' /workspace/src/main/java/com/example/exam/PriceService.java
docker exec "$NAME" pkill -f spring-boot || true; sleep 2
docker exec -u coder -d "$NAME" bash -c 'cd /workspace && ./mvnw -q spring-boot:run > /tmp/api.log 2>&1'
for _ in $(seq 1 90); do [ "$(code http://127.0.0.1:8081/api/price?price=200\&percent=25)" = 200 ] && break; sleep 2; done
BODY=$(curl -s -H "$CK" $R_APP "http://app.localhost:$PORT/api/price?price=200&percent=25")
echo "$BODY" | jq -e '.finalPrice == 150' >/dev/null || sfail "finalPrice esperado 150, llego: $BODY"
echo "  ok  $BODY"

echo "== curl.exe desde Windows a localhost:8081"
WCODE=$("$CURL_WIN" -s -o NUL -w '%{http_code}' --max-time 10 "http://localhost:8081/api/price?price=200&percent=25")
echo "  win localhost:8081/api/price -> $WCODE"
[ "$WCODE" = 200 ] || sfail "Windows vio $WCODE (se esperaba 200)"

echo "OK smoke-exam"
