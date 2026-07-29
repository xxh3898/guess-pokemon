#!/bin/bash

set -Eeuo pipefail

readonly DOCKER_BIN=/usr/local/bin/docker
readonly APP_DIR=/Users/homeserver/Server/apps/guess-pokemon
readonly COMPOSE_FILE="${APP_DIR}/compose.yaml"
readonly ENV_FILE="${APP_DIR}/.env"
readonly BACKUP_SCRIPT=/Users/homeserver/Server/scripts/backup/backup-guess-pokemon.sh
readonly API_IMAGE_REPOSITORY=ghcr.io/xxh3898/guess-pokemon-api
readonly WEB_IMAGE_REPOSITORY=ghcr.io/xxh3898/guess-pokemon-web
readonly HEALTH_TIMEOUT_SECONDS=180
readonly ACTIVE_GAME_POLL_INTERVAL_SECONDS=60
readonly ACTIVE_GAME_WAIT_TIMEOUT_SECONDS=900

usage() {
  printf 'Usage: deploy-guess-pokemon.sh <commit-sha> <registry-user>\n' >&2
}

fail() {
  printf 'Guess Pokémon deployment failed: %s\n' "$1" >&2
  exit 1
}

if [[ "$#" -ne 2 ]]; then
  usage
  exit 64
fi

commit_sha="$1"
registry_user="$2"

if [[ ! "${commit_sha}" =~ ^[0-9a-fA-F]{40}$ ]]; then
  printf 'Commit SHA must contain exactly 40 hexadecimal characters\n' >&2
  exit 64
fi

if [[ ! "${registry_user}" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'Registry user contains unsupported characters\n' >&2
  exit 64
fi

if [[ ! -x "${DOCKER_BIN}" ]]; then
  fail "Docker CLI is not executable: ${DOCKER_BIN}"
fi

if [[ ! -f "${COMPOSE_FILE}" || ! -f "${ENV_FILE}" ]]; then
  fail "production Compose configuration is incomplete"
fi

if [[ ! -x "${BACKUP_SCRIPT}" ]]; then
  fail "production backup script is not executable"
fi

registry_token="$(/bin/cat)"
if [[ -z "${registry_token}" ]]; then
  printf 'GHCR token must not be empty\n' >&2
  exit 64
fi

umask 077

docker_config_dir="$(
  /usr/bin/mktemp -d "${TMPDIR:-/tmp}/guess-pokemon-docker-config.XXXXXX"
)"
env_temp=
logged_in=false

# ShellCheck cannot infer that trap invokes this cleanup function.
# shellcheck disable=SC2329
cleanup() {
  registry_token=

  if [[ -n "${env_temp}" && -e "${env_temp}" ]]; then
    /bin/unlink "${env_temp}"
  fi

  if [[ "${logged_in}" == true ]]; then
    "${DOCKER_BIN}" \
      --config "${docker_config_dir}" \
      logout ghcr.io \
      >/dev/null 2>&1 \
      || true
  fi

  if [[ "$(/usr/bin/basename "${docker_config_dir}")" == guess-pokemon-docker-config.* ]]; then
    /bin/rm -rf -- "${docker_config_dir}"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

compose() {
  "${DOCKER_BIN}" \
    compose \
    --project-directory "${APP_DIR}" \
    --env-file "${ENV_FILE}" \
    --file "${COMPOSE_FILE}" \
    "$@"
}

read_active_game_count() {
  local active_game_count

  active_game_count="$(
    # Variables expand inside the database container, not in this host shell.
    # shellcheck disable=SC2016
    compose exec -T db /bin/sh -ceu '
      exec psql \
        --username "${POSTGRES_USER}" \
        --dbname "${POSTGRES_DB}" \
        --tuples-only \
        --no-align \
        --command "SELECT count(*) FROM game WHERE status = '\''IN_PROGRESS'\''"
    ' \
      | /usr/bin/tr -d '[:space:]'
  )"

  if [[ ! "${active_game_count}" =~ ^[0-9]+$ ]]; then
    fail "could not determine active game count"
  fi

  printf '%s' "${active_game_count}"
}

wait_for_no_active_games() {
  local active_game_count
  local elapsed_seconds=0
  local sleep_seconds

  while true; do
    active_game_count="$(read_active_game_count)"

    if ((active_game_count == 0)); then
      if ((elapsed_seconds > 0)); then
        printf 'No active games remain; deployment will continue\n'
      fi
      return
    fi

    if ((elapsed_seconds >= ACTIVE_GAME_WAIT_TIMEOUT_SECONDS)); then
      fail "deployment timed out after ${ACTIVE_GAME_WAIT_TIMEOUT_SECONDS}s because ${active_game_count} game(s) are still in progress"
    fi

    sleep_seconds="${ACTIVE_GAME_POLL_INTERVAL_SECONDS}"
    if ((elapsed_seconds + sleep_seconds > ACTIVE_GAME_WAIT_TIMEOUT_SECONDS)); then
      sleep_seconds="$((ACTIVE_GAME_WAIT_TIMEOUT_SECONDS - elapsed_seconds))"
    fi

    printf \
      'Waiting %ss before checking %s active game(s) again (%ss/%ss elapsed)\n' \
      "${sleep_seconds}" \
      "${active_game_count}" \
      "${elapsed_seconds}" \
      "${ACTIVE_GAME_WAIT_TIMEOUT_SECONDS}"
    /bin/sleep "${sleep_seconds}"
    elapsed_seconds="$((elapsed_seconds + sleep_seconds))"
  done
}

read_env_value() {
  local key="$1"
  local value

  value="$(
    /usr/bin/awk -F= -v key="${key}" '
      $1 == key {
        value = substr($0, index($0, "=") + 1)
        count += 1
      }
      END {
        if (count != 1) {
          exit 1
        }
        print value
      }
    ' "${ENV_FILE}"
  )" || fail "${key} must appear exactly once in ${ENV_FILE}"

  printf '%s' "${value}"
}

write_image_env() {
  local api_image="$1"
  local web_image="$2"

  env_temp="$(/usr/bin/mktemp "${APP_DIR}/.env.tmp.XXXXXX")"

  if ! /usr/bin/awk \
    -v api_image="${api_image}" \
    -v web_image="${web_image}" '
      BEGIN {
        api_count = 0
        web_count = 0
      }
      /^API_IMAGE=/ {
        print "API_IMAGE=" api_image
        api_count += 1
        next
      }
      /^WEB_IMAGE=/ {
        print "WEB_IMAGE=" web_image
        web_count += 1
        next
      }
      {
        print
      }
      END {
        if (api_count != 1 || web_count != 1) {
          exit 1
        }
      }
    ' "${ENV_FILE}" >"${env_temp}"
  then
    fail "API_IMAGE and WEB_IMAGE must each appear once in ${ENV_FILE}"
  fi

  /bin/chmod 600 "${env_temp}"
  /bin/mv -f -- "${env_temp}" "${ENV_FILE}"
  env_temp=
}

extract_sha() {
  local image="$1"
  local repository="$2"
  local image_sha="${image#"${repository}:"}"

  if [[ "${image}" != "${repository}:${image_sha}" ]] \
    || [[ ! "${image_sha}" =~ ^[0-9a-fA-F]{40}$ ]] \
    || [[ "${image_sha}" == "0000000000000000000000000000000000000000" ]]
  then
    return 1
  fi

  printf '%s' "${image_sha}"
}

normalized_sha="$(
  printf '%s' "${commit_sha}" \
    | /usr/bin/tr '[:upper:]' '[:lower:]'
)"
new_api_image="${API_IMAGE_REPOSITORY}:${normalized_sha}"
new_web_image="${WEB_IMAGE_REPOSITORY}:${normalized_sha}"
current_api_image="$(read_env_value API_IMAGE)"
current_web_image="$(read_env_value WEB_IMAGE)"
previous_sha=

current_api_sha="$(extract_sha "${current_api_image}" "${API_IMAGE_REPOSITORY}")" \
  || current_api_sha=
current_web_sha="$(extract_sha "${current_web_image}" "${WEB_IMAGE_REPOSITORY}")" \
  || current_web_sha=

if [[ -n "${current_api_sha}" || -n "${current_web_sha}" ]]; then
  if [[ -z "${current_api_sha}" || "${current_api_sha}" != "${current_web_sha}" ]]; then
    fail "current API and web images do not share one valid commit SHA"
  fi
  previous_sha="${current_api_sha}"
fi

printf '%s' "${registry_token}" \
  | "${DOCKER_BIN}" \
      --config "${docker_config_dir}" \
      login ghcr.io \
      --username "${registry_user}" \
      --password-stdin \
      >/dev/null
logged_in=true
registry_token=

"${DOCKER_BIN}" --config "${docker_config_dir}" pull "${new_api_image}"
"${DOCKER_BIN}" --config "${docker_config_dir}" pull "${new_web_image}"

API_IMAGE="${new_api_image}" \
WEB_IMAGE="${new_web_image}" \
  "${DOCKER_BIN}" \
    compose \
    --project-directory "${APP_DIR}" \
    --env-file "${ENV_FILE}" \
    --file "${COMPOSE_FILE}" \
    config \
    --quiet

running_services="$(compose ps --status running --services)"
if ! /usr/bin/grep -qx db <<<"${running_services}"; then
  fail "production db service must be running before deployment"
fi

wait_for_no_active_games

"${BACKUP_SCRIPT}"

write_image_env "${new_api_image}" "${new_web_image}"

if compose up \
  --detach \
  --no-build \
  --pull never \
  --remove-orphans \
  --wait \
  --wait-timeout "${HEALTH_TIMEOUT_SECONDS}"
then
  printf 'Guess Pokémon deployment succeeded: %s\n' "${normalized_sha}"
  exit 0
fi

printf 'Guess Pokémon deployment failed for commit: %s\n' "${normalized_sha}" >&2
compose logs --tail 100 api web >&2 || true

if [[ -n "${previous_sha}" ]]; then
  previous_api_image="${API_IMAGE_REPOSITORY}:${previous_sha}"
  previous_web_image="${WEB_IMAGE_REPOSITORY}:${previous_sha}"

  printf 'Rolling back application images to: %s\n' "${previous_sha}" >&2
  write_image_env "${previous_api_image}" "${previous_web_image}"

  if compose up \
    --detach \
    --no-build \
    --pull never \
    --remove-orphans \
    --wait \
    --wait-timeout "${HEALTH_TIMEOUT_SECONDS}"
  then
    printf 'Application image rollback succeeded: %s\n' "${previous_sha}" >&2
  else
    printf 'Application image rollback failed: %s\n' "${previous_sha}" >&2
    compose logs --tail 100 api web >&2 || true
  fi
else
  printf 'No previous SHA image exists; keeping the database and stopping failed app containers\n' >&2
  write_image_env "${current_api_image}" "${current_web_image}"
  compose stop api web || true
fi

printf 'Database migration is not rolled back automatically\n' >&2
exit 1
