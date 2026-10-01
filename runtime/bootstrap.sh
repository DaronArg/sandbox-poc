#!/bin/bash
# ENTRYPOINT (corre como root): levanta el gate como usuario `gate` y baja privilegios a `coder` para la sesion.
set -e

mkdir -p /run/gate /var/log/gate
chown gate:gate /run/gate /var/log/gate
chmod 700 /run/gate
chmod 755 /var/log/gate

setpriv --reuid=gate --regid=gate --clear-groups node /opt/gate/gate.js &

exec setpriv --reuid=coder --regid=coder --init-groups env HOME=/home/coder /usr/local/bin/session.sh
