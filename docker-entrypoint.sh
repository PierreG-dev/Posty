#!/bin/sh
# Lance web + worker dans le même container.
# - Worker en background avec restart-loop : s'il crash, il repart en 2s
#   sans tuer le container.
# - Web au premier plan : c'est lui que tini monitore. S'il crash, le
#   container tombe et Coolify redémarre tout.
# Les signaux SIGTERM/SIGINT reçus par tini (PID 1) sont routés à next ;
# le subshell worker est tué en cascade à l'arrêt du container.

set -e

(
  while true; do
    node dist-worker/worker/index.js || true
    echo "{\"ts\":\"$(date -u +%FT%TZ)\",\"level\":\"warn\",\"msg\":\"worker.exited_restarting\"}" >&2
    sleep 2
  done
) &

exec npx next start -p 3000
