#!/bin/sh
set -eu
if [ -n "${SUPERVISOR_TOKEN:-}" ]; then
	CONTROL_ENABLED="$(node -e 'const options = JSON.parse(require("node:fs").readFileSync("/data/options.json", "utf8")); process.stdout.write(options.allow_control === true ? "true" : "false")')"
	export CONTROL_ENABLED
fi
mkdir -p "${DATA_DIR:-/data}"
chown node:node "${DATA_DIR:-/data}"
exec su-exec node:node node /app/src/server.js