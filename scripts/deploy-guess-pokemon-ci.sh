#!/bin/bash

set -Eeuo pipefail

readonly DEPLOY_SCRIPT=/Users/homeserver/Server/scripts/deploy/deploy-guess-pokemon.sh

original_command="${SSH_ORIGINAL_COMMAND:-}"

if [[ "${original_command}" =~ ^deploy-guess-pokemon[[:space:]]([0-9a-fA-F]{40})[[:space:]]([A-Za-z0-9_-]+)$ ]]; then
  exec "${DEPLOY_SCRIPT}" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
fi

if [[ "${original_command}" =~ ^deploy-guess-pokemon-v2[[:space:]]([0-9a-f]{40})[[:space:]]keep[[:space:]]([A-Za-z0-9_-]+)$ ]]; then
  exec "${DEPLOY_SCRIPT}" "${BASH_REMATCH[1]}" keep "${BASH_REMATCH[2]}"
fi

if [[ "${original_command}" =~ ^deploy-guess-pokemon-v2[[:space:]]([0-9a-f]{40})[[:space:]]update[[:space:]](sha256:[0-9a-f]{64})[[:space:]]([A-Za-z0-9_-]+)$ ]]; then
  exec \
    "${DEPLOY_SCRIPT}" \
    "${BASH_REMATCH[1]}" \
    update \
    "${BASH_REMATCH[2]}" \
    "${BASH_REMATCH[3]}"
fi

printf '%s\n' \
  'Only deploy-guess-pokemon or strictly formatted deploy-guess-pokemon-v2 commands are allowed' \
  >&2
exit 64
