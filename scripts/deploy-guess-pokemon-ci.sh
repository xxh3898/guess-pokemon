#!/bin/bash

set -Eeuo pipefail

readonly DEPLOY_SCRIPT=/Users/homeserver/Server/scripts/deploy/deploy-guess-pokemon.sh

original_command="${SSH_ORIGINAL_COMMAND:-}"

if [[ ! "${original_command}" =~ ^deploy-guess-pokemon[[:space:]]([0-9a-fA-F]{40})[[:space:]]([A-Za-z0-9_-]+)$ ]]; then
  printf 'Only deploy-guess-pokemon <commit-sha> <registry-user> is allowed\n' >&2
  exit 64
fi

exec "${DEPLOY_SCRIPT}" "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
