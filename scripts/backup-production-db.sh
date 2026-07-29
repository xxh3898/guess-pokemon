#!/bin/bash

set -Eeuo pipefail

umask 077

readonly DOCKER_BIN=/usr/local/bin/docker
readonly APP_DIR=/Users/homeserver/Server/apps/guess-pokemon
readonly COMPOSE_FILE="${APP_DIR}/compose.yaml"
readonly ENV_FILE="${APP_DIR}/.env"
readonly BACKUP_DIR=/Users/homeserver/Server/backups/guess-pokemon
readonly RETENTION_SECONDS=$((3 * 24 * 60 * 60))

temporary_file=
final_file=

fail() {
  printf 'Guess Pokémon DB backup failed: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [[ -n "${temporary_file}" && -f "${temporary_file}" ]]; then
    /bin/unlink "${temporary_file}"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ! -x "${DOCKER_BIN}" ]]; then
  fail "Docker CLI is not executable: ${DOCKER_BIN}"
fi

if [[ ! -f "${COMPOSE_FILE}" || ! -f "${ENV_FILE}" ]]; then
  fail "production Compose configuration is incomplete"
fi

/bin/mkdir -p "${BACKUP_DIR}"

compose() {
  "${DOCKER_BIN}" \
    compose \
    --project-directory "${APP_DIR}" \
    --env-file "${ENV_FILE}" \
    --file "${COMPOSE_FILE}" \
    "$@"
}

running_services="$(compose ps --status running --services)"
if ! /usr/bin/grep -qx db <<<"${running_services}"; then
  fail "production db service is not running"
fi

timestamp="$(/bin/date -u '+%Y%m%dT%H%M%SZ')"
final_file="${BACKUP_DIR}/guess-pokemon-production-${timestamp}.dump"
temporary_file="$(
  /usr/bin/mktemp "${BACKUP_DIR}/.guess-pokemon-backup.XXXXXX"
)"

# Variables expand inside the database container, not in this host shell.
# shellcheck disable=SC2016
compose exec -T db /bin/sh -ceu '
  exec pg_dump \
    --format=custom \
    --no-owner \
    --no-privileges \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}"
' >"${temporary_file}"

if [[ ! -s "${temporary_file}" ]]; then
  fail "generated archive is empty"
fi

compose exec -T db pg_restore --list <"${temporary_file}" >/dev/null

if ! /bin/ln "${temporary_file}" "${final_file}"; then
  fail "archive with the same name already exists"
fi

/bin/unlink "${temporary_file}"
temporary_file=

now_epoch="$(/bin/date '+%s')"
for candidate in "${BACKUP_DIR}"/guess-pokemon-production-*.dump; do
  if [[ ! -f "${candidate}" || "${candidate}" == "${final_file}" ]]; then
    continue
  fi

  candidate_name="$(/usr/bin/basename "${candidate}")"
  if [[ ! "${candidate_name}" =~ ^guess-pokemon-production-[0-9]{8}T[0-9]{6}Z\.dump$ ]]; then
    continue
  fi

  modified_epoch="$(/usr/bin/stat -f '%m' "${candidate}")"
  age_seconds=$((now_epoch - modified_epoch))

  if ((age_seconds > RETENTION_SECONDS)); then
    /bin/unlink "${candidate}"
    printf 'Expired backup removed: %s\n' "${candidate}"
  fi
done

printf 'Backup completed: %s\n' "${final_file}"
