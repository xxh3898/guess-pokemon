#!/bin/bash

set -Eeuo pipefail

readonly SCRIPT_DIR="$(
  cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd -P
)"
readonly SOURCE_SCRIPT="${SCRIPT_DIR}/backup-production-db.sh"
readonly ZERO_DIGEST=sha256:0000000000000000000000000000000000000000000000000000000000000000
readonly APPLICATION_SHA=1111111111111111111111111111111111111111
readonly PREVIOUS_SHA=2222222222222222222222222222222222222222
readonly CONFIG_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
readonly CONFIG_SHA=3333333333333333333333333333333333333333

test_root="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/guess-backup-test.XXXXXX")"

cleanup() {
  if [[ "$(basename "${test_root}")" == guess-backup-test.* ]]; then
    /bin/rm -rf -- "${test_root}"
  fi
}

trap cleanup EXIT INT TERM

mock_docker="${test_root}/docker"
docker_log="${test_root}/docker.log"

{
  printf '%s\n' \
    '#!/bin/bash' \
    'set -Eeuo pipefail' \
    'printf "%s\n" "$*" >>"${DOCKER_LOG}"' \
    'if [[ " $* " != *" --project-name guess-pokemon "* ]]; then' \
    '  printf "Compose project name was not pinned: %s\n" "$*" >&2' \
    '  exit 1' \
    'elif [[ " $* " == *" ps --status running --services "* ]]; then' \
    '  printf "db\n"' \
    'elif [[ " $* " == *" pg_restore --list "* ]]; then' \
    '  /bin/cat >/dev/null' \
    'elif [[ " $* " == *" exec -T db /bin/sh -ceu "* ]]; then' \
    '  printf "mock PostgreSQL custom archive\n"' \
    'else' \
    '  printf "unexpected Docker invocation: %s\n" "$*" >&2' \
    '  exit 1' \
    'fi'
} >"${mock_docker}"
/bin/chmod 700 "${mock_docker}"

prepare_script() {
  local app_dir="$1"
  local backup_dir="$2"
  local target_script="$3"

  /usr/bin/sed \
    -e "s#readonly DOCKER_BIN=/usr/local/bin/docker#readonly DOCKER_BIN=${mock_docker}#" \
    -e "s#readonly APP_DIR=/Users/homeserver/Server/apps/guess-pokemon#readonly APP_DIR=${app_dir}#" \
    -e "s#readonly BACKUP_DIR=/Users/homeserver/Server/backups/guess-pokemon#readonly BACKUP_DIR=${backup_dir}#" \
    "${SOURCE_SCRIPT}" >"${target_script}"
  /bin/chmod 700 "${target_script}"
}

runtime_content_sha256() {
  local release_dir="$1"

  {
    /usr/bin/shasum -a 256 "${release_dir}/compose.yaml"
    /usr/bin/shasum -a 256 \
      "${release_dir}/infra/nginx/cloudflare-edge-real-ip.conf"
  } | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}'
}

prepare_runtime_state() {
  local app_dir="$1"
  local release_dir="${app_dir}/runtime-config/releases/${CONFIG_DIGEST#sha256:}"
  local content_sha

  /bin/mkdir -p "${release_dir}/infra/nginx"
  printf 'name: guess-pokemon\nservices: {}\n' >"${release_dir}/compose.yaml"
  printf 'set_real_ip_from 192.0.2.0/24;\n' \
    >"${release_dir}/infra/nginx/cloudflare-edge-real-ip.conf"
  content_sha="$(runtime_content_sha256 "${release_dir}")"

  {
    printf 'APPLICATION_REVISION=%s\n' "${APPLICATION_SHA}"
    printf 'PREVIOUS_APPLICATION_REVISION=%s\n' "${PREVIOUS_SHA}"
    printf 'PREVIOUS_RUNTIME_CONFIG_DIGEST=%s\n' "${ZERO_DIGEST}"
    printf 'RUNTIME_CONFIG_CONTENT_SHA256=%s\n' "${content_sha}"
    printf 'RUNTIME_CONFIG_DIGEST=%s\n' "${CONFIG_DIGEST}"
    printf 'RUNTIME_CONFIG_REVISION=%s\n' "${CONFIG_SHA}"
  } >"${app_dir}/runtime-config/state"
  /bin/ln -s \
    "releases/${CONFIG_DIGEST#sha256:}" \
    "${app_dir}/runtime-config/current"
}

v2_app="${test_root}/v2-app"
v2_backups="${test_root}/v2-backups"
v2_script="${test_root}/v2-backup.sh"
/bin/mkdir -p "${v2_app}" "${v2_backups}"
printf 'POSTGRES_DB=guess\nPOSTGRES_USER=guess\nPOSTGRES_PASSWORD=test\n' \
  >"${v2_app}/.env"
prepare_runtime_state "${v2_app}"
prepare_script "${v2_app}" "${v2_backups}" "${v2_script}"

COMPOSE_PROJECT_NAME=ambient-project \
DOCKER_LOG="${docker_log}" \
  "${v2_script}" >/dev/null
expected_release="${v2_app}/runtime-config/releases/${CONFIG_DIGEST#sha256:}"
/usr/bin/grep -Fq -- "--project-name guess-pokemon" "${docker_log}"
/usr/bin/grep -Fq -- "--project-directory ${expected_release}" "${docker_log}"
/usr/bin/grep -Fq -- "--file ${expected_release}/compose.yaml" "${docker_log}"
test "$(find "${v2_backups}" -name 'guess-pokemon-production-*.dump' -type f | wc -l | tr -d ' ')" = 1

unsafe_app="${test_root}/unsafe-app"
unsafe_backups="${test_root}/unsafe-backups"
unsafe_script="${test_root}/unsafe-backup.sh"
/bin/mkdir -p "${unsafe_app}" "${unsafe_backups}"
printf 'POSTGRES_DB=guess\nPOSTGRES_USER=guess\nPOSTGRES_PASSWORD=test\n' \
  >"${unsafe_app}/.env"
prepare_runtime_state "${unsafe_app}"
/bin/rm -f -- "${unsafe_app}/runtime-config/current"
/bin/ln -s releases/not-the-verified-release "${unsafe_app}/runtime-config/current"
prepare_script "${unsafe_app}" "${unsafe_backups}" "${unsafe_script}"

if DOCKER_LOG="${docker_log}" "${unsafe_script}" >/dev/null 2>&1; then
  printf 'backup unexpectedly accepted a current pointer that disagrees with state\n' >&2
  exit 1
fi
test "$(find "${unsafe_backups}" -name 'guess-pokemon-production-*.dump' -type f | wc -l | tr -d ' ')" = 0

tampered_app="${test_root}/tampered-app"
tampered_backups="${test_root}/tampered-backups"
tampered_script="${test_root}/tampered-backup.sh"
/bin/mkdir -p "${tampered_app}" "${tampered_backups}"
printf 'POSTGRES_DB=guess\nPOSTGRES_USER=guess\nPOSTGRES_PASSWORD=test\n' \
  >"${tampered_app}/.env"
prepare_runtime_state "${tampered_app}"
printf '\n# tampered after verification\n' \
  >>"${tampered_app}/runtime-config/releases/${CONFIG_DIGEST#sha256:}/compose.yaml"
prepare_script "${tampered_app}" "${tampered_backups}" "${tampered_script}"

if DOCKER_LOG="${docker_log}" "${tampered_script}" >/dev/null 2>&1; then
  printf 'backup unexpectedly accepted a tampered runtime release\n' >&2
  exit 1
fi
test "$(find "${tampered_backups}" -name 'guess-pokemon-production-*.dump' -type f | wc -l | tr -d ' ')" = 0

symlink_state_app="${test_root}/symlink-state-app"
symlink_state_backups="${test_root}/symlink-state-backups"
symlink_state_script="${test_root}/symlink-state-backup.sh"
/bin/mkdir -p "${symlink_state_app}" "${symlink_state_backups}"
printf 'POSTGRES_DB=guess\nPOSTGRES_USER=guess\nPOSTGRES_PASSWORD=test\n' \
  >"${symlink_state_app}/.env"
prepare_runtime_state "${symlink_state_app}"
/bin/mv \
  "${symlink_state_app}/runtime-config/state" \
  "${symlink_state_app}/runtime-config/state.target"
/bin/ln -s state.target "${symlink_state_app}/runtime-config/state"
prepare_script \
  "${symlink_state_app}" \
  "${symlink_state_backups}" \
  "${symlink_state_script}"

if DOCKER_LOG="${docker_log}" "${symlink_state_script}" >/dev/null 2>&1; then
  printf 'backup unexpectedly accepted a symlink runtime state\n' >&2
  exit 1
fi
test "$(find "${symlink_state_backups}" -name 'guess-pokemon-production-*.dump' -type f | wc -l | tr -d ' ')" = 0

legacy_app="${test_root}/legacy-app"
legacy_backups="${test_root}/legacy-backups"
legacy_script="${test_root}/legacy-backup.sh"
/bin/mkdir -p "${legacy_app}" "${legacy_backups}"
printf 'POSTGRES_DB=guess\nPOSTGRES_USER=guess\nPOSTGRES_PASSWORD=test\n' \
  >"${legacy_app}/.env"
printf 'name: guess-pokemon\nservices: {}\n' >"${legacy_app}/compose.yaml"
prepare_script "${legacy_app}" "${legacy_backups}" "${legacy_script}"

: >"${docker_log}"
DOCKER_LOG="${docker_log}" "${legacy_script}" >/dev/null
/usr/bin/grep -Fq -- "--project-name guess-pokemon" "${docker_log}"
/usr/bin/grep -Fq -- "--project-directory ${legacy_app}" "${docker_log}"
/usr/bin/grep -Fq -- "--file ${legacy_app}/compose.yaml" "${docker_log}"

printf 'Guess Pokémon production backup selection tests passed\n'
