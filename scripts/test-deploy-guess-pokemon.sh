#!/bin/bash

set -Eeuo pipefail

PROJECT_ROOT="$(
  CDPATH= cd -- "$(dirname -- "$0")/.." && pwd
)"
SOURCE_SCRIPT="${PROJECT_ROOT}/scripts/deploy-guess-pokemon.sh"
MOCK_DOCKER="${PROJECT_ROOT}/scripts/fixtures/mock-guess-pokemon-docker.sh"

REVISION_ONE=1111111111111111111111111111111111111111
REVISION_TWO=2222222222222222222222222222222222222222
REVISION_THREE=3333333333333333333333333333333333333333
CONFIG_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
CONFIG_DIGEST_TWO=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb

test_root="$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/guess-pokemon-deploy-test.XXXXXX")"
cleanup() {
  if [[ "$(/usr/bin/basename "${test_root}")" == guess-pokemon-deploy-test.* ]]; then
    /bin/rm -rf -- "${test_root}"
  fi
}
trap cleanup EXIT INT TERM

app_dir="${test_root}/app"
test_script="${test_root}/deploy-guess-pokemon.sh"
backup_script="${test_root}/backup.sh"
runtime_compose="${test_root}/runtime-compose.yaml"
runtime_real_ip="${test_root}/cloudflare-edge-real-ip.conf"
/bin/mkdir -p "${app_dir}"
/bin/cp "${PROJECT_ROOT}/compose.production.yaml" "${app_dir}/compose.yaml"
/bin/cp "${PROJECT_ROOT}/compose.production.yaml" "${runtime_compose}"
/bin/cp \
  "${PROJECT_ROOT}/infra/nginx/cloudflare-edge-real-ip.conf" \
  "${runtime_real_ip}"
/bin/cp "${PROJECT_ROOT}/.env.production.example" "${app_dir}/.env"

/usr/bin/sed \
  -e "s#^API_IMAGE=.*#API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:${REVISION_ONE}#" \
  -e "s#^WEB_IMAGE=.*#WEB_IMAGE=ghcr.io/xxh3898/guess-pokemon-web:${REVISION_ONE}#" \
  "${app_dir}/.env" >"${app_dir}/.env.updated"
/bin/mv "${app_dir}/.env.updated" "${app_dir}/.env"

printf '#!/bin/bash\nexit 0\n' >"${backup_script}"
/bin/chmod 700 "${backup_script}"

/usr/bin/sed \
  -e "s#readonly DOCKER_BIN=/usr/local/bin/docker#readonly DOCKER_BIN=${MOCK_DOCKER}#" \
  -e "s#readonly APP_DIR=/Users/homeserver/Server/apps/guess-pokemon#readonly APP_DIR=${app_dir}#" \
  -e "s#readonly BACKUP_SCRIPT=/Users/homeserver/Server/scripts/backup/backup-guess-pokemon.sh#readonly BACKUP_SCRIPT=${backup_script}#" \
  "${SOURCE_SCRIPT}" \
  >"${test_script}"
/bin/chmod 700 "${test_script}" "${MOCK_DOCKER}"

run_deploy() {
  printf 'test-token' \
    | /usr/bin/env \
        FAKE_RUNTIME_COMPOSE="${runtime_compose}" \
        FAKE_RUNTIME_REAL_IP="${runtime_real_ip}" \
        FAKE_CONFIG_REVISION="${REVISION_ONE}" \
        FAKE_REVISION_ONE="${REVISION_ONE}" \
        FAKE_REVISION_TWO="${REVISION_TWO}" \
        FAKE_REVISION_THREE="${REVISION_THREE}" \
        FAKE_DOCKER_LOG="${FAKE_DOCKER_LOG:-}" \
        FAKE_FAIL_CP="${FAKE_FAIL_CP:-false}" \
        FAKE_RENDER_API_IMAGE="${FAKE_RENDER_API_IMAGE:-}" \
        FAKE_RENDER_WEB_IMAGE="${FAKE_RENDER_WEB_IMAGE:-}" \
        FAKE_RENDER_REAL_IP_SOURCE="${FAKE_RENDER_REAL_IP_SOURCE:-}" \
        /bin/bash "${test_script}" "$@"
}

run_recovery() {
  /usr/bin/env \
    FAKE_RUNTIME_COMPOSE="${runtime_compose}" \
    FAKE_RUNTIME_REAL_IP="${runtime_real_ip}" \
    FAKE_CONFIG_REVISION="${REVISION_ONE}" \
    FAKE_REVISION_ONE="${REVISION_ONE}" \
    FAKE_REVISION_TWO="${REVISION_TWO}" \
    FAKE_REVISION_THREE="${REVISION_THREE}" \
    /bin/bash "${test_script}" recover
}

run_deploy \
  "${REVISION_ONE}" \
  update \
  "${CONFIG_DIGEST}" \
  test-user

state_file="${app_dir}/runtime-config/state"
test -f "${state_file}"
/usr/bin/grep -Fxq "RUNTIME_CONFIG_DIGEST=${CONFIG_DIGEST}" "${state_file}"
/usr/bin/grep -Fxq "RUNTIME_CONFIG_REVISION=${REVISION_ONE}" "${state_file}"
test -L "${app_dir}/runtime-config/current"
test ! -e "${app_dir}/runtime-config/pending"

set +e
run_deploy "${REVISION_TWO}" test-user >/dev/null 2>&1
legacy_after_v2_exit_code="$?"
set -e
if [[ "${legacy_after_v2_exit_code}" -ne 1 ]]; then
  printf 'Legacy Guess Pokémon deploy must be disabled after v2 state initialization\n' >&2
  exit 1
fi

run_deploy "${REVISION_TWO}" keep test-user

/usr/bin/grep -Fxq \
  "API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:${REVISION_TWO}" \
  "${app_dir}/.env"
/usr/bin/grep -Fxq "APPLICATION_REVISION=${REVISION_TWO}" "${state_file}"
/usr/bin/grep -Fxq "RUNTIME_CONFIG_DIGEST=${CONFIG_DIGEST}" "${state_file}"
/usr/bin/grep -Fxq "RUNTIME_CONFIG_REVISION=${REVISION_ONE}" "${state_file}"
test "$(/usr/bin/readlink "${app_dir}/runtime-config/current")" \
  = "releases/${CONFIG_DIGEST#sha256:}"
if /usr/bin/find "${app_dir}/runtime-config/releases" -name '.current.*' | /usr/bin/grep -q .; then
  printf 'Atomic current pointer update left an internal temporary symlink\n' >&2
  exit 1
fi

pending_file="${app_dir}/runtime-config/pending"
{
  printf 'PREVIOUS_APPLICATION_REVISION=%s\n' "${REVISION_TWO}"
  printf 'PREVIOUS_RUNTIME_CONFIG_DIGEST=%s\n' "${CONFIG_DIGEST}"
  printf 'TARGET_APPLICATION_REVISION=%s\n' "${REVISION_THREE}"
  printf 'TARGET_RUNTIME_CONFIG_DIGEST=%s\n' "${CONFIG_DIGEST}"
} >"${pending_file}"
/bin/chmod 600 "${pending_file}"
/usr/bin/sed \
  -e "s#^API_IMAGE=.*#API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:${REVISION_THREE}#" \
  -e "s#^WEB_IMAGE=.*#WEB_IMAGE=ghcr.io/xxh3898/guess-pokemon-web:${REVISION_THREE}#" \
  "${app_dir}/.env" >"${app_dir}/.env.interrupted"
/bin/mv "${app_dir}/.env.interrupted" "${app_dir}/.env"

set +e
run_deploy "${REVISION_ONE}" test-user >/dev/null 2>&1
legacy_pending_exit_code="$?"
set -e
if [[ "${legacy_pending_exit_code}" -ne 1 || ! -f "${pending_file}" ]]; then
  printf 'Legacy Guess Pokémon deploy must preserve and reject pending transaction\n' >&2
  exit 1
fi

run_recovery

test ! -e "${pending_file}"
/usr/bin/grep -Fxq \
  "API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:${REVISION_TWO}" \
  "${app_dir}/.env"
/usr/bin/grep -Fxq "APPLICATION_REVISION=${REVISION_TWO}" "${state_file}"

release_one="${app_dir}/runtime-config/releases/${CONFIG_DIGEST#sha256:}"
release_two="${app_dir}/runtime-config/releases/${CONFIG_DIGEST_TWO#sha256:}"
/bin/cp -R "${release_one}" "${release_two}"
original_content_sha="$(/usr/bin/sed -n 's/^RUNTIME_CONFIG_CONTENT_SHA256=//p' "${state_file}")"
target_content_sha="$(
  {
    /usr/bin/shasum -a 256 "${release_two}/compose.yaml"
    /usr/bin/shasum -a 256 \
      "${release_two}/infra/nginx/cloudflare-edge-real-ip.conf"
  } | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}'
)"
{
  printf 'PREVIOUS_APPLICATION_REVISION=%s\n' "${REVISION_TWO}"
  printf 'PREVIOUS_RUNTIME_CONFIG_DIGEST=%s\n' "${CONFIG_DIGEST}"
  printf 'TARGET_APPLICATION_REVISION=%s\n' "${REVISION_THREE}"
  printf 'TARGET_RUNTIME_CONFIG_DIGEST=%s\n' "${CONFIG_DIGEST_TWO}"
} >"${pending_file}"
/usr/bin/sed \
  -e "s#^APPLICATION_REVISION=.*#APPLICATION_REVISION=${REVISION_THREE}#" \
  -e "s#^RUNTIME_CONFIG_DIGEST=.*#RUNTIME_CONFIG_DIGEST=${CONFIG_DIGEST_TWO}#" \
  -e "s#^RUNTIME_CONFIG_CONTENT_SHA256=.*#RUNTIME_CONFIG_CONTENT_SHA256=${target_content_sha}#" \
  "${state_file}" >"${state_file}.target"
/bin/mv "${state_file}.target" "${state_file}"
/usr/bin/sed \
  -e "s#^API_IMAGE=.*#API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:${REVISION_THREE}#" \
  -e "s#^WEB_IMAGE=.*#WEB_IMAGE=ghcr.io/xxh3898/guess-pokemon-web:${REVISION_THREE}#" \
  "${app_dir}/.env" >"${app_dir}/.env.target"
/bin/mv "${app_dir}/.env.target" "${app_dir}/.env"

run_recovery

test "$(/usr/bin/readlink "${app_dir}/runtime-config/current")" \
  = "releases/${CONFIG_DIGEST_TWO#sha256:}"
test ! -e "${pending_file}"

/usr/bin/sed \
  -e "s#^APPLICATION_REVISION=.*#APPLICATION_REVISION=${REVISION_TWO}#" \
  -e "s#^RUNTIME_CONFIG_DIGEST=.*#RUNTIME_CONFIG_DIGEST=${CONFIG_DIGEST}#" \
  -e "s#^RUNTIME_CONFIG_CONTENT_SHA256=.*#RUNTIME_CONFIG_CONTENT_SHA256=${original_content_sha}#" \
  "${state_file}" >"${state_file}.restored"
/bin/mv "${state_file}.restored" "${state_file}"
/usr/bin/sed \
  -e "s#^API_IMAGE=.*#API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:${REVISION_TWO}#" \
  -e "s#^WEB_IMAGE=.*#WEB_IMAGE=ghcr.io/xxh3898/guess-pokemon-web:${REVISION_TWO}#" \
  "${app_dir}/.env" >"${app_dir}/.env.restored"
/bin/mv "${app_dir}/.env.restored" "${app_dir}/.env"
/bin/rm -f -- "${app_dir}/runtime-config/current"
/bin/ln -s "releases/${CONFIG_DIGEST#sha256:}" "${app_dir}/runtime-config/current"

printf 'UNKNOWN=value\n' >"${pending_file}"
set +e
run_recovery >/dev/null 2>&1
recovery_exit_code="$?"
set -e
if [[ "${recovery_exit_code}" -ne 1 || ! -f "${pending_file}" ]]; then
  printf 'Invalid pending recovery must fail closed\n' >&2
  exit 1
fi
/bin/rm -f -- "${pending_file}"

/usr/bin/sed \
  -e "s#^API_IMAGE=.*#API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:${REVISION_ONE}#" \
  -e "s#^WEB_IMAGE=.*#WEB_IMAGE=ghcr.io/xxh3898/guess-pokemon-web:${REVISION_ONE}#" \
  "${app_dir}/.env" >"${app_dir}/.env.drifted"
/bin/mv "${app_dir}/.env.drifted" "${app_dir}/.env"
set +e
run_deploy \
  "${REVISION_THREE}" \
  update \
  "${CONFIG_DIGEST_TWO}" \
  test-user \
  >/dev/null 2>&1
drifted_state_exit_code="$?"
set -e
if [[ "${drifted_state_exit_code}" -ne 1 ]]; then
  printf 'Update with application revision state drift must fail\n' >&2
  exit 1
fi
/usr/bin/sed \
  -e "s#^API_IMAGE=.*#API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:${REVISION_TWO}#" \
  -e "s#^WEB_IMAGE=.*#WEB_IMAGE=ghcr.io/xxh3898/guess-pokemon-web:${REVISION_TWO}#" \
  "${app_dir}/.env" >"${app_dir}/.env.restored"
/bin/mv "${app_dir}/.env.restored" "${app_dir}/.env"

/bin/cp "${state_file}" "${state_file}.valid"
/usr/bin/sed \
  -e 's#^RUNTIME_CONFIG_DIGEST=.*#RUNTIME_CONFIG_DIGEST=malformed#' \
  "${state_file}.valid" >"${state_file}"
set +e
run_deploy \
  "${REVISION_THREE}" \
  update \
  "${CONFIG_DIGEST_TWO}" \
  test-user \
  >/dev/null 2>&1
invalid_state_exit_code="$?"
set -e
if [[ "${invalid_state_exit_code}" -ne 1 ]]; then
  printf 'Update with an invalid existing runtime config state must fail\n' >&2
  exit 1
fi
/bin/mv "${state_file}.valid" "${state_file}"

set +e
FAKE_RENDER_API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:unexpected \
  run_deploy "${REVISION_THREE}" keep test-user >/dev/null 2>&1
wrong_image_exit_code="$?"
set -e
if [[ "${wrong_image_exit_code}" -ne 1 ]]; then
  printf 'Runtime config with a different API image must fail\n' >&2
  exit 1
fi

set +e
FAKE_RENDER_REAL_IP_SOURCE=/tmp/stale/infra/nginx/cloudflare-edge-real-ip.conf \
  run_deploy "${REVISION_THREE}" keep test-user >/dev/null 2>&1
wrong_real_ip_exit_code="$?"
set -e
if [[ "${wrong_real_ip_exit_code}" -ne 1 ]]; then
  printf 'Runtime config with a non-release real-IP bind must fail\n' >&2
  exit 1
fi

docker_log="${test_root}/docker.log"
set +e
FAKE_FAIL_CP=true \
FAKE_DOCKER_LOG="${docker_log}" \
  run_deploy \
    "${REVISION_ONE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user \
    >/dev/null 2>&1
cleanup_exit_code="$?"
set -e
if [[ "${cleanup_exit_code}" -ne 1 ]]; then
  printf 'Broken runtime config extraction must fail\n' >&2
  exit 1
fi
/usr/bin/grep -Fq 'rm mock-runtime-config-container' "${docker_log}"
if /usr/bin/find "${app_dir}/runtime-config/releases" -maxdepth 1 -type d -name '.tmp.*' | /usr/bin/grep -q .; then
  printf 'Broken runtime config extraction left a temporary release\n' >&2
  exit 1
fi

release_dir="${release_one}"
printf '\n# tampered\n' >>"${release_dir}/compose.yaml"

set +e
run_deploy \
  "${REVISION_THREE}" \
  update \
  "${CONFIG_DIGEST_TWO}" \
  test-user \
  >/dev/null 2>&1
update_exit_code="$?"
set -e

if [[ "${update_exit_code}" -ne 1 ]]; then
  printf 'Update with a tampered active runtime config must fail: actual=%s\n' "${update_exit_code}" >&2
  exit 1
fi

set +e
run_deploy "${REVISION_THREE}" keep test-user >/dev/null 2>&1
exit_code="$?"
set -e

if [[ "${exit_code}" -ne 1 ]]; then
  printf 'Tampered runtime config must fail: actual=%s\n' "${exit_code}" >&2
  exit 1
fi

/usr/bin/grep -Fxq \
  "API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:${REVISION_TWO}" \
  "${app_dir}/.env"

printf 'Guess Pokémon deploy v2 tests passed\n'
