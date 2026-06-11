#!/bin/sh
set -eu

node /app/scripts/configure-git-global.cjs

exec "$@"
