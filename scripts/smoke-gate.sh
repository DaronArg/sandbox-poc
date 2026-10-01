#!/usr/bin/env bash
# Smoke del gate (design.md §12). Dentro de WSL; requiere backend en :9090 e imagen assessment-runtime:poc.
# Levanta un contenedor de sesion con el docker run de §6.4 y verifica los 9 puntos.
set -euo pipefail
source "$(dirname "$0")/lib-session.sh"
CURL_WIN="${CURL_WIN:-/mnt/c/Windows/System32/curl.exe}"

code() { curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }
expect() { [ "$1" = "$2" ] || sfail "$3: esperaba $2 y dio $1"; echo "  ok  $3 -> $1"; }

start_session 1
wait_ide
KEY=$(gate_key)
IDE="ide.localhost:$PORT"; APP="app.localhost:$PORT"
R_IDE="--resolve ide.localhost:$PORT:127.0.0.1"; R_APP="--resolve app.localhost:$PORT:127.0.0.1"
CK="Cookie: assessment_gate=$KEY"

echo "== 1. sin cookie -> 403"
expect "$(code $R_IDE "http://$IDE/")" 403 "ide.localhost sin cookie"
expect "$(code $R_APP "http://$APP/")" 403 "app.localhost sin cookie"
expect "$(code "http://127.0.0.1:$PORT/")" 403 "127.0.0.1 sin cookie"
expect "$(code -H 'Cookie: assessment_gate=incorrecta' $R_IDE "http://$IDE/")" 403 "ide.localhost con cookie incorrecta"

echo "== 2. con cookie"
expect "$(code -H "$CK" $R_IDE "http://$IDE/healthz")" 200 "ide.localhost/healthz con cookie"
expect "$(code -H "$CK" $R_APP "http://$APP/")" 502 "app.localhost con cookie (front apagado)"
expect "$(code -H "$CK" "http://127.0.0.1:$PORT/")" 404 "host desconocido con cookie"

echo "== 3. WebSocket a code-server"
WSK=$(head -c16 /dev/urandom | base64)
ws_status() {
  curl -s -i --max-time 4 $R_IDE "$@" -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
    -H "Sec-WebSocket-Key: $WSK" -H "Origin: http://$IDE" \
    "http://$IDE/?reconnectionToken=smoke&reconnection=false&skipWebSocketFrames=true" 2>/dev/null | head -1 | tr -d '\r' | awk '{print $2}'
}
expect "$(ws_status -H "$CK")" 101 "WebSocket con cookie"
expect "$(ws_status)" 403 "WebSocket sin cookie"

echo "== 4. puerto de la API (:8081 -> :9081)"
expect "$(code -H 'Sec-Fetch-Mode: navigate' http://127.0.0.1:8081/)" 403 ":8081 con Sec-Fetch-Mode"
expect "$(code -H 'Origin: http://evil.example' http://127.0.0.1:8081/)" 403 ":8081 con Origin"
expect "$(code http://127.0.0.1:8081/api/price)" 502 ":8081 sin headers de navegador, API apagada"
docker exec -u coder -d "$NAME" bash -c 'cd /workspace && ./mvnw -q spring-boot:run > /tmp/api.log 2>&1'
API=000
for _ in $(seq 1 120); do
  API=$(code "http://127.0.0.1:8081/api/price?price=200&percent=25")
  [ "$API" != 502 ] && [ "$API" != 000 ] && break
  sleep 3
done
# applyDiscount sigue sin implementar (a proposito): la API responde 500; lo que se verifica es que el gate llega a Spring.
[ "$API" != 502 ] && [ "$API" != 403 ] && [ "$API" != 000 ] || { docker exec "$NAME" tail -20 /tmp/api.log; sfail ":8081 no llego a la API (codigo $API)"; }
echo "  ok  :8081 con la API levantada -> $API (respuesta de Spring, no del gate)"
expect "$(curl -s -o /dev/null -w '%{content_type}' http://127.0.0.1:8081/api/price?price=1\&percent=1 | cut -c1-16)" "application/json" "content-type de la API (JSON de Spring)"
expect "$(code -H 'Sec-Fetch-Site: none' "http://127.0.0.1:8081/api/price?price=200&percent=25")" 403 ":8081 con la API arriba sigue bloqueando navegadores"

echo "== 5. la cookie del gate no llega al upstream"
docker exec -u coder -d "$NAME" node -e '
  require("http").createServer((q, r) => {
    require("fs").writeFileSync("/tmp/upstream-headers.json", JSON.stringify(q.headers));
    r.end("ok");
  }).listen(4200, "127.0.0.1");'
sleep 2
expect "$(code -H "Cookie: assessment_gate=$KEY; otra=1" $R_APP "http://$APP/")" 200 "app.localhost con cookie hacia el upstream de prueba"
H=$(docker exec "$NAME" cat /tmp/upstream-headers.json)
echo "$H" | grep -q assessment_gate && sfail "el upstream recibio la cookie del gate"
echo "$H" | jq -e '.cookie == "otra=1"' >/dev/null || sfail "las demas cookies deben conservarse"
echo "$H" | jq -e '.host == "app.localhost:'"$PORT"'"' >/dev/null || sfail "el Host original debe preservarse"
echo "$H" | jq -e '."x-forwarded-for" != null' >/dev/null || sfail "falta X-Forwarded-For"
echo "  ok  upstream recibio cookie=otra=1, Host original y X-Forwarded-*"

echo "== 6. el alumno (coder) no puede escalar"
docker exec -u coder "$NAME" sudo -n true >/dev/null 2>&1 && sfail "sudo -n true funciono"
echo "  ok  sudo -n true falla"
docker exec -u coder "$NAME" cat /run/gate/key >/dev/null 2>&1 && sfail "coder leyo /run/gate/key"
echo "  ok  coder no lee /run/gate/key"
docker exec -u coder "$NAME" bash -c 'kill -9 $(pgrep -f /opt/gate/gate.js) 2>/dev/null' && sfail "coder pudo matar el gate"
echo "  ok  coder no puede matar el gate"
expect "$(code -H "$CK" $R_IDE "http://$IDE/healthz")" 200 "el gate sigue vivo"

echo "== 7. docker inspect no contiene la clave"
docker inspect "$NAME" | grep -q "$KEY" && sfail "la clave aparece en docker inspect"
docker exec -u coder "$NAME" env | grep -q "$KEY" && sfail "la clave aparece en env"
echo "  ok  la clave no esta en inspect ni en env"

echo "== 8. denied.log y GATE_ACCESS_DENIED"
docker exec "$NAME" cat /var/log/gate/denied.log | jq -c '{port,host,path}'
docker exec "$NAME" cat /var/log/gate/denied.log | jq -e -s 'length >= 4 and (map(select(.port==9081))|length >= 1) and (map(select(.port==7000))|length >= 3)' >/dev/null || sfail "denied.log incompleto"
OK=0
for _ in $(seq 1 15); do
  EV=$(curl -fsS "$B/api/sessions/$ID/events")
  if echo "$EV" | jq -e '[.[]|select(.type=="GATE_ACCESS_DENIED")] | length >= 4' >/dev/null; then OK=1; break; fi
  sleep 3
done
[ "$OK" = 1 ] || { echo "$EV" | jq -c '.[]|{type,payload}'; sfail "GATE_ACCESS_DENIED no llego a la API"; }
echo "  ok  GATE_ACCESS_DENIED visibles en /api/sessions/$ID/events"

echo "== 9. desde Windows (curl.exe por el reenvio de localhost de WSL)"
if [ -x "$CURL_WIN" ]; then
  wcode() { "$CURL_WIN" -s -o /dev/null -w '%{http_code}' --max-time 10 "$@"; }
  expect "$(wcode --resolve ide.localhost:$PORT:127.0.0.1 "http://$IDE/")" 403 "win: ide.localhost sin cookie"
  expect "$(wcode "http://127.0.0.1:$PORT/")" 403 "win: 127.0.0.1 sin cookie"
  expect "$(wcode --resolve ide.localhost:$PORT:127.0.0.1 -H "$CK" "http://$IDE/healthz")" 200 "win: ide.localhost/healthz con cookie"
  expect "$(wcode -H 'Sec-Fetch-Mode: navigate' http://127.0.0.1:8081/api/price)" 403 "win: :8081 con Sec-Fetch-Mode"
  expect "$(wcode "http://localhost:8081/api/price?price=200&percent=25")" "$API" "win: :8081 sin headers de navegador (curl)"
else
  sfail "no encuentro curl.exe ($CURL_WIN)"
fi

echo "OK smoke-gate"
