# Hook de telemetria: tras cada comando agrega {command, exitCode} a /tmp/telemetry/commands.log.
__tel_hook() {
  local ec=$?
  local line num cmd
  line=$(HISTTIMEFORMAT= history 1)
  num=${line%%[![:space:]0-9]*}
  num=${num//[[:space:]]/}
  [ -z "$num" ] && return
  [ "$num" = "$__TEL_LAST" ] && return
  __TEL_LAST=$num
  cmd=$(printf '%s' "$line" | sed -E 's/^ *[0-9]+ *//')
  cmd=${cmd//\\/\\\\}
  cmd=${cmd//\"/\\\"}
  cmd=${cmd//$'\t'/\\t}
  mkdir -p /tmp/telemetry
  printf '{"command":"%s","exitCode":%d}\n' "$cmd" "$ec" >> /tmp/telemetry/commands.log
}
case "$PROMPT_COMMAND" in
  *__tel_hook*) ;;
  *) PROMPT_COMMAND="__tel_hook${PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
esac
