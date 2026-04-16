#!/bin/bash
set -euo pipefail

CONFIG_TEMPLATE="/opt/hermes/config.yaml.template"
CONFIG_DIR="/root/.hermes"
CONFIG_FILE="${CONFIG_DIR}/config.yaml"

mkdir -p "${CONFIG_DIR}"

if [ -f "${CONFIG_TEMPLATE}" ] && [ ! -f "${CONFIG_FILE}" ]; then
  envsubst < "${CONFIG_TEMPLATE}" > "${CONFIG_FILE}"
fi

if [ -f /opt/hermes/.hermes-version ]; then
  echo "Hermes image version: $(cat /opt/hermes/.hermes-version)"
fi

exec "$@"
