#!/bin/sh
set -eu
mkdir -p "${DATA_DIR:-/data}"
chown node:node "${DATA_DIR:-/data}"
exec su-exec node:node node /app/src/server.js