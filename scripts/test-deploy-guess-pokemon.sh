#!/bin/bash

set -Eeuo pipefail

PROJECT_ROOT="$(
  CDPATH= cd -- "$(dirname -- "$0")/.." && pwd
)"
SOURCE_SCRIPT="${PROJECT_ROOT}/scripts/deploy-guess-pokemon.sh"
MOCK_DOCKER="${PROJECT_ROOT}/scripts/fixtures/mock-guess-pokemon-docker.sh"
MOCK_CURL="${PROJECT_ROOT}/scripts/fixtures/mock-guess-pokemon-curl.sh"

REVISION_ONE=1111111111111111111111111111111111111111
REVISION_TWO=2222222222222222222222222222222222222222
REVISION_THREE=3333333333333333333333333333333333333333
CONFIG_DIGEST=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
CONFIG_DIGEST_TWO=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
LEGACY_CONFIG_DIGEST=sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc

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
runtime_backup_script="${test_root}/runtime-backup.sh"
runtime_deploy_script="${test_root}/runtime-deploy.sh"
runtime_backup_marker="${test_root}/runtime-backup-ran"
runtime_backup_args_log="${test_root}/runtime-backup-args.log"
curl_log="${test_root}/curl.log"
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
  -e "s#^API_IMAGE=.*#API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:${REVISION_TWO}#" \
  -e "s#^WEB_IMAGE=.*#WEB_IMAGE=ghcr.io/xxh3898/guess-pokemon-web:${REVISION_TWO}#" \
  "${app_dir}/.env" >"${app_dir}/.env.updated"
/bin/mv "${app_dir}/.env.updated" "${app_dir}/.env"

printf '#!/bin/bash\nexit 97\n' >"${backup_script}"
printf \
  '#!/bin/bash\n: >"%s"\nprintf "%%s\\n" "$*" >>"%s"\n' \
  "${runtime_backup_marker}" \
  "${runtime_backup_args_log}" \
  >"${runtime_backup_script}"
printf '#!/bin/bash\nexit 0\n' >"${runtime_deploy_script}"
/bin/chmod 600 "${backup_script}"
/bin/chmod 700 "${runtime_backup_script}" "${runtime_deploy_script}"
: >"${runtime_backup_args_log}"
: >"${curl_log}"

/usr/bin/sed \
  -e "s#readonly DOCKER_BIN=/usr/local/bin/docker#readonly DOCKER_BIN=${MOCK_DOCKER}#" \
  -e "s#readonly CURL_BIN=/usr/bin/curl#readonly CURL_BIN=${MOCK_CURL}#" \
  -e "s#readonly APP_DIR=/Users/homeserver/Server/apps/guess-pokemon#readonly APP_DIR=${app_dir}#" \
  -e "s#readonly BACKUP_SCRIPT=/Users/homeserver/Server/scripts/backup/backup-guess-pokemon.sh#readonly BACKUP_SCRIPT=${backup_script}#" \
  "${SOURCE_SCRIPT}" \
  >"${test_script}"
/bin/chmod 700 "${test_script}" "${MOCK_DOCKER}" "${MOCK_CURL}"

run_deploy() {
  printf 'test-token' \
    | /usr/bin/env \
        FAKE_RUNTIME_COMPOSE="${runtime_compose}" \
        FAKE_RUNTIME_REAL_IP="${runtime_real_ip}" \
        FAKE_RUNTIME_BACKUP_SCRIPT="${runtime_backup_script}" \
        FAKE_RUNTIME_DEPLOY_SCRIPT="${runtime_deploy_script}" \
        FAKE_CONFIG_REVISION="${FAKE_CONFIG_REVISION_OVERRIDE:-${REVISION_ONE}}" \
        FAKE_CONFIG_PROJECT="${FAKE_CONFIG_PROJECT:-guess-pokemon}" \
        FAKE_REVISION_ONE="${REVISION_ONE}" \
        FAKE_REVISION_TWO="${REVISION_TWO}" \
        FAKE_REVISION_THREE="${REVISION_THREE}" \
        FAKE_DOCKER_LOG="${FAKE_DOCKER_LOG:-}" \
        FAKE_CURL_LOG="${curl_log}" \
        FAKE_PUBLIC_SMOKE_FAIL="${FAKE_PUBLIC_SMOKE_FAIL:-false}" \
        FAKE_PUBLIC_SMOKE_FAIL_ONCE_FILE="${FAKE_PUBLIC_SMOKE_FAIL_ONCE_FILE:-}" \
        FAKE_MIGRATION_FAIL="${FAKE_MIGRATION_FAIL:-false}" \
        FAKE_FAIL_CP="${FAKE_FAIL_CP:-false}" \
        FAKE_RUNTIME_INVALID_DEPLOY_SYNTAX="${FAKE_RUNTIME_INVALID_DEPLOY_SYNTAX:-false}" \
        FAKE_RUNTIME_INSECURE_SCRIPT_MODE="${FAKE_RUNTIME_INSECURE_SCRIPT_MODE:-false}" \
        FAKE_RUNTIME_EXTRA_FILE="${FAKE_RUNTIME_EXTRA_FILE:-false}" \
        FAKE_RUNTIME_EXTRA_DIR="${FAKE_RUNTIME_EXTRA_DIR:-false}" \
        FAKE_RUNTIME_SYMLINK="${FAKE_RUNTIME_SYMLINK:-false}" \
        FAKE_FAIL_APP_UP_ONCE_FILE="${FAKE_FAIL_APP_UP_ONCE_FILE:-}" \
        FAKE_RUNNING_SERVICES="${FAKE_RUNNING_SERVICES:-}" \
        FAKE_RENDER_BASELINE_COMPOSE_FILE="${FAKE_RENDER_BASELINE_COMPOSE_FILE:-}" \
        FAKE_RENDER_CANDIDATE_DB_IMAGE="${FAKE_RENDER_CANDIDATE_DB_IMAGE:-}" \
        FAKE_RENDER_CANDIDATE_DB_EXTRA_ENVIRONMENT="${FAKE_RENDER_CANDIDATE_DB_EXTRA_ENVIRONMENT:-}" \
        FAKE_RENDER_CANDIDATE_DB_COMMAND_JSON="${FAKE_RENDER_CANDIDATE_DB_COMMAND_JSON:-}" \
        FAKE_RENDER_CANDIDATE_DB_ENTRYPOINT_JSON="${FAKE_RENDER_CANDIDATE_DB_ENTRYPOINT_JSON:-}" \
        FAKE_RENDER_CANDIDATE_API_EXTRA_ENVIRONMENT="${FAKE_RENDER_CANDIDATE_API_EXTRA_ENVIRONMENT:-}" \
        FAKE_RENDER_CANDIDATE_FLYWAY_ENABLED="${FAKE_RENDER_CANDIDATE_FLYWAY_ENABLED:-}" \
        FAKE_RENDER_CANDIDATE_API_HEALTHCHECK_JSON="${FAKE_RENDER_CANDIDATE_API_HEALTHCHECK_JSON:-}" \
        FAKE_RENDER_CANDIDATE_API_TMPFS_JSON="${FAKE_RENDER_CANDIDATE_API_TMPFS_JSON:-}" \
        FAKE_RENDER_CANDIDATE_API_USER_JSON="${FAKE_RENDER_CANDIDATE_API_USER_JSON:-}" \
        FAKE_RENDER_CANDIDATE_DB_SERVICE_EXTRA="${FAKE_RENDER_CANDIDATE_DB_SERVICE_EXTRA:-}" \
        FAKE_RENDER_CANDIDATE_API_SERVICE_EXTRA="${FAKE_RENDER_CANDIDATE_API_SERVICE_EXTRA:-}" \
        FAKE_RENDER_CANDIDATE_WEB_SERVICE_EXTRA="${FAKE_RENDER_CANDIDATE_WEB_SERVICE_EXTRA:-}" \
        FAKE_RENDER_DB_VOLUME_EXTRA="${FAKE_RENDER_DB_VOLUME_EXTRA:-}" \
        FAKE_RENDER_POSTGRES_VOLUME_EXTRA="${FAKE_RENDER_POSTGRES_VOLUME_EXTRA:-}" \
        FAKE_RENDER_API_HEALTHCHECK_JSON="${FAKE_RENDER_API_HEALTHCHECK_JSON:-}" \
        FAKE_RENDER_API_COMMAND_JSON="${FAKE_RENDER_API_COMMAND_JSON:-}" \
        FAKE_RENDER_API_ENTRYPOINT_JSON="${FAKE_RENDER_API_ENTRYPOINT_JSON:-}" \
        FAKE_RENDER_API_EXTRA_ENVIRONMENT="${FAKE_RENDER_API_EXTRA_ENVIRONMENT:-}" \
        FAKE_RENDER_API_CAP_ADD_JSON="${FAKE_RENDER_API_CAP_ADD_JSON:-}" \
        FAKE_RENDER_API_DEVICES_JSON="${FAKE_RENDER_API_DEVICES_JSON:-}" \
        FAKE_RENDER_API_IMAGE="${FAKE_RENDER_API_IMAGE:-}" \
        FAKE_RENDER_API_NETWORKS_JSON="${FAKE_RENDER_API_NETWORKS_JSON:-}" \
        FAKE_RENDER_API_PID_JSON="${FAKE_RENDER_API_PID_JSON:-}" \
        FAKE_RENDER_API_PORTS_JSON="${FAKE_RENDER_API_PORTS_JSON:-}" \
        FAKE_RENDER_API_PRIVILEGED="${FAKE_RENDER_API_PRIVILEGED:-}" \
        FAKE_RENDER_API_USE_API_SOCKET="${FAKE_RENDER_API_USE_API_SOCKET:-}" \
        FAKE_RENDER_API_VOLUMES_JSON="${FAKE_RENDER_API_VOLUMES_JSON:-}" \
        FAKE_RENDER_API_VOLUMES_FROM_JSON="${FAKE_RENDER_API_VOLUMES_FROM_JSON:-}" \
        FAKE_RENDER_API_CONFIGS_JSON="${FAKE_RENDER_API_CONFIGS_JSON:-}" \
        FAKE_RENDER_API_SECRETS_JSON="${FAKE_RENDER_API_SECRETS_JSON:-}" \
        FAKE_RENDER_API_ENV_FILE_JSON="${FAKE_RENDER_API_ENV_FILE_JSON:-}" \
        FAKE_RENDER_API_EXTRA_HOSTS_JSON="${FAKE_RENDER_API_EXTRA_HOSTS_JSON:-}" \
        FAKE_RENDER_API_EXTERNAL_LINKS_JSON="${FAKE_RENDER_API_EXTERNAL_LINKS_JSON:-}" \
        FAKE_RENDER_API_LINKS_JSON="${FAKE_RENDER_API_LINKS_JSON:-}" \
        FAKE_RENDER_APPLICATION_JSON="${FAKE_RENDER_APPLICATION_JSON:-}" \
        FAKE_RENDER_DB_NETWORKS_JSON="${FAKE_RENDER_DB_NETWORKS_JSON:-}" \
        FAKE_RENDER_EGRESS_JSON="${FAKE_RENDER_EGRESS_JSON:-}" \
        FAKE_RENDER_EDGE_JSON="${FAKE_RENDER_EDGE_JSON:-}" \
        FAKE_RENDER_EDGE_ALIAS="${FAKE_RENDER_EDGE_ALIAS:-}" \
        FAKE_RENDER_EXTRA_SERVICE_JSON="${FAKE_RENDER_EXTRA_SERVICE_JSON:-}" \
        FAKE_RENDER_LOGGING_JSON="${FAKE_RENDER_LOGGING_JSON:-}" \
        FAKE_RENDER_WEB_IMAGE="${FAKE_RENDER_WEB_IMAGE:-}" \
        FAKE_RENDER_WEB_NETWORKS_JSON="${FAKE_RENDER_WEB_NETWORKS_JSON:-}" \
        FAKE_RENDER_WEB_SERVICE_NAME="${FAKE_RENDER_WEB_SERVICE_NAME:-}" \
        FAKE_RENDER_REAL_IP_SOURCE="${FAKE_RENDER_REAL_IP_SOURCE:-}" \
        /bin/bash "${test_script}" "$@"
}

run_recovery() {
  /usr/bin/env \
    FAKE_RUNTIME_COMPOSE="${runtime_compose}" \
    FAKE_RUNTIME_REAL_IP="${runtime_real_ip}" \
    FAKE_RUNTIME_BACKUP_SCRIPT="${runtime_backup_script}" \
    FAKE_RUNTIME_DEPLOY_SCRIPT="${runtime_deploy_script}" \
    FAKE_CONFIG_REVISION="${REVISION_ONE}" \
    FAKE_REVISION_ONE="${REVISION_ONE}" \
    FAKE_REVISION_TWO="${REVISION_TWO}" \
    FAKE_REVISION_THREE="${REVISION_THREE}" \
    FAKE_DOCKER_LOG="${FAKE_DOCKER_LOG:-}" \
    FAKE_CURL_LOG="${curl_log}" \
    FAKE_PUBLIC_SMOKE_FAIL="${FAKE_PUBLIC_SMOKE_FAIL:-false}" \
    FAKE_PUBLIC_SMOKE_FAIL_ONCE_FILE="${FAKE_PUBLIC_SMOKE_FAIL_ONCE_FILE:-}" \
    /bin/bash "${test_script}" recover
}

assert_deploy_rejected() {
  local message="$1"
  local exit_code
  shift

  set +e
  run_deploy "$@" >/dev/null 2>&1
  exit_code="$?"
  set -e
  if [[ "${exit_code}" -ne 1 ]]; then
    printf '%s\n' "${message}" >&2
    exit 1
  fi
}

bootstrap_candidate="${app_dir}/runtime-config/releases/${CONFIG_DIGEST#sha256:}"
state_file="${app_dir}/runtime-config/state"
current_link="${app_dir}/runtime-config/current"
initialization_marker="${app_dir}/.runtime-config-v2-initialized"
bootstrap_failure_marker="${test_root}/fail-bootstrap-app-up-once"
bootstrap_docker_log="${test_root}/bootstrap-docker.log"
: >"${bootstrap_docker_log}"

FAKE_CONFIG_PROJECT=wrong-project \
  assert_deploy_rejected \
    'Runtime config artifact with a different project label must fail' \
    "${REVISION_ONE}" \
    update \
    "${CONFIG_DIGEST}" \
    test-user

FAKE_RUNTIME_INVALID_DEPLOY_SYNTAX=true \
  assert_deploy_rejected \
    'Runtime config artifact with invalid worker syntax must fail' \
    "${REVISION_ONE}" \
    update \
    "${CONFIG_DIGEST}" \
    test-user

FAKE_RUNTIME_INSECURE_SCRIPT_MODE=true \
  assert_deploy_rejected \
    'Runtime config artifact with an insecure worker mode must fail' \
    "${REVISION_ONE}" \
    update \
    "${CONFIG_DIGEST}" \
    test-user

FAKE_RUNTIME_EXTRA_DIR=true \
  assert_deploy_rejected \
    'Runtime config artifact with an extra entry must fail' \
    "${REVISION_ONE}" \
    update \
    "${CONFIG_DIGEST}" \
    test-user

set +e
FAKE_DOCKER_LOG="${bootstrap_docker_log}" \
FAKE_FAIL_APP_UP_ONCE_FILE="${bootstrap_failure_marker}" \
  run_deploy \
    "${REVISION_ONE}" \
    update \
    "${CONFIG_DIGEST}" \
    test-user \
    >/dev/null 2>&1
bootstrap_failure_exit_code="$?"
set -e
if [[ "${bootstrap_failure_exit_code}" -ne 1 ]]; then
  printf 'Interrupted first v2 deployment must fail after rollback\n' >&2
  exit 1
fi
test -f "${bootstrap_failure_marker}"
test -d "${bootstrap_candidate}"
test -f "${runtime_backup_marker}"
/usr/bin/tail -n 1 "${runtime_backup_args_log}" \
  | /usr/bin/grep -Fxq -- '--trigger predeploy'
test ! -e "${state_file}"
test ! -e "${current_link}"
test ! -e "${initialization_marker}"
test ! -e "${app_dir}/runtime-config/pending"
/usr/bin/grep -Fxq \
  "API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:${REVISION_TWO}" \
  "${app_dir}/.env"
bootstrap_up_log="${test_root}/bootstrap-up.log"
/usr/bin/grep '^compose .* up ' "${bootstrap_docker_log}" >"${bootstrap_up_log}"
bootstrap_up_count="$(/usr/bin/wc -l <"${bootstrap_up_log}" | /usr/bin/tr -d ' ')"
test "${bootstrap_up_count}" -eq 2
/usr/bin/sed -n '1p' "${bootstrap_up_log}" \
  | /usr/bin/grep -Fq -- \
      "--file ${bootstrap_candidate}/compose.yaml up "
/usr/bin/sed -n '2p' "${bootstrap_up_log}" \
  | /usr/bin/grep -Fq -- \
      "--file ${app_dir}/compose.yaml up "

FAKE_FAIL_APP_UP_ONCE_FILE="${bootstrap_failure_marker}" \
run_deploy \
  "${REVISION_ONE}" \
  update \
  "${CONFIG_DIGEST}" \
  test-user

test -f "${state_file}"
test "$(/bin/cat "${initialization_marker}")" = RUNTIME_CONFIG_V2=initialized
/usr/bin/grep -Fxq "RUNTIME_CONFIG_DIGEST=${CONFIG_DIGEST}" "${state_file}"
/usr/bin/grep -Fxq "RUNTIME_CONFIG_REVISION=${REVISION_ONE}" "${state_file}"
test -L "${current_link}"
test ! -e "${app_dir}/runtime-config/pending"

legacy_release="${app_dir}/runtime-config/releases/${LEGACY_CONFIG_DIGEST#sha256:}"
/bin/cp -R "${bootstrap_candidate}" "${legacy_release}"
/bin/rm -rf -- "${legacy_release}/scripts"
legacy_content_sha="$(
  {
    /usr/bin/shasum -a 256 "${legacy_release}/compose.yaml"
    /usr/bin/shasum -a 256 \
      "${legacy_release}/infra/nginx/cloudflare-edge-real-ip.conf"
  } | /usr/bin/shasum -a 256 | /usr/bin/awk '{print $1}'
)"
/bin/cp "${state_file}" "${state_file}.before-legacy-transition"
/bin/cp "${app_dir}/.env" "${app_dir}/.env.before-legacy-transition"
/usr/bin/sed \
  -e "s#^RUNTIME_CONFIG_DIGEST=.*#RUNTIME_CONFIG_DIGEST=${LEGACY_CONFIG_DIGEST}#" \
  -e "s#^RUNTIME_CONFIG_CONTENT_SHA256=.*#RUNTIME_CONFIG_CONTENT_SHA256=${legacy_content_sha}#" \
  "${state_file}" >"${state_file}.legacy-transition"
/bin/mv "${state_file}.legacy-transition" "${state_file}"
/bin/rm -f -- "${current_link}"
/bin/ln -s "releases/${LEGACY_CONFIG_DIGEST#sha256:}" "${current_link}"

FAKE_CONFIG_REVISION_OVERRIDE="${REVISION_TWO}" \
  run_deploy \
    "${REVISION_TWO}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user

/bin/mv "${state_file}.before-legacy-transition" "${state_file}"
/bin/mv "${app_dir}/.env.before-legacy-transition" "${app_dir}/.env"
/bin/rm -f -- "${current_link}"
/bin/ln -s "releases/${CONFIG_DIGEST#sha256:}" "${current_link}"
/bin/rm -rf -- \
  "${app_dir}/runtime-config/releases/${CONFIG_DIGEST_TWO#sha256:}" \
  "${legacy_release}"

/bin/mv "${state_file}" "${state_file}.both-missing"
/bin/mv "${current_link}" "${current_link}.both-missing"
set +e
run_deploy \
  "${REVISION_TWO}" \
  update \
  "${CONFIG_DIGEST_TWO}" \
  test-user \
  >/dev/null 2>&1
missing_initialized_state_exit_code="$?"
run_deploy "${REVISION_TWO}" test-user >/dev/null 2>&1
legacy_missing_initialized_state_exit_code="$?"
set -e
if [[ "${missing_initialized_state_exit_code}" -ne 1 ]] \
  || [[ "${legacy_missing_initialized_state_exit_code}" -ne 1 ]]
then
  printf 'Initialized runtime config must not fallback after state deletion\n' >&2
  exit 1
fi
/bin/mv "${state_file}.both-missing" "${state_file}"
/bin/mv "${current_link}.both-missing" "${current_link}"

/bin/mv "${state_file}" "${state_file}.missing"
set +e
run_deploy \
  "${REVISION_TWO}" \
  update \
  "${CONFIG_DIGEST_TWO}" \
  test-user \
  >/dev/null 2>&1
missing_state_exit_code="$?"
set -e
if [[ "${missing_state_exit_code}" -ne 1 ]]; then
  printf 'Deployment with a current pointer but missing state must fail\n' >&2
  exit 1
fi
/bin/mv "${state_file}.missing" "${state_file}"

/bin/ln -s missing-pending "${app_dir}/runtime-config/pending"
set +e
run_deploy "${REVISION_TWO}" keep test-user >/dev/null 2>&1
dangling_pending_exit_code="$?"
set -e
if [[ "${dangling_pending_exit_code}" -ne 1 ]]; then
  printf 'Deployment with a dangling pending symlink must require recovery\n' >&2
  exit 1
fi
/bin/rm -f -- "${app_dir}/runtime-config/pending"

set +e
run_deploy "${REVISION_TWO}" test-user >/dev/null 2>&1
legacy_after_v2_exit_code="$?"
set -e
if [[ "${legacy_after_v2_exit_code}" -ne 1 ]]; then
  printf 'Legacy Guess Pokémon deploy must be disabled after v2 state initialization\n' >&2
  exit 1
fi

/bin/mv "${app_dir}/compose.yaml" "${app_dir}/compose.yaml.legacy"
run_deploy "${REVISION_TWO}" keep test-user
/bin/mv "${app_dir}/compose.yaml.legacy" "${app_dir}/compose.yaml"

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

/bin/mv "${state_file}" "${state_file}.real"
/bin/ln -s "$(/usr/bin/basename "${state_file}.real")" "${state_file}"
set +e
run_recovery >/dev/null 2>&1
symlink_state_recovery_exit_code="$?"
set -e
if [[ "${symlink_state_recovery_exit_code}" -ne 1 || ! -f "${pending_file}" ]]; then
  printf 'Recovery with a symlink state must fail and preserve pending\n' >&2
  exit 1
fi
/bin/rm -f -- "${state_file}"
/bin/mv "${state_file}.real" "${state_file}"

/bin/mv "${app_dir}/compose.yaml" "${app_dir}/compose.yaml.legacy"
/bin/rm -f -- "${initialization_marker}" "${current_link}"
run_recovery
/bin/mv "${app_dir}/compose.yaml.legacy" "${app_dir}/compose.yaml"

test "$(/bin/cat "${initialization_marker}")" = RUNTIME_CONFIG_V2=initialized
test "$(/usr/bin/readlink "${current_link}")" \
  = "releases/${CONFIG_DIGEST#sha256:}"
test ! -e "${pending_file}"
/usr/bin/grep -Fxq \
  "API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:${REVISION_TWO}" \
  "${app_dir}/.env"
/usr/bin/grep -Fxq "APPLICATION_REVISION=${REVISION_TWO}" "${state_file}"

{
  printf 'PREVIOUS_APPLICATION_REVISION=%s\n' "${REVISION_TWO}"
  printf 'PREVIOUS_RUNTIME_CONFIG_DIGEST=%s\n' "${CONFIG_DIGEST}"
  printf 'TARGET_APPLICATION_REVISION=%s\n' "${REVISION_TWO}"
  printf 'TARGET_RUNTIME_CONFIG_DIGEST=%s\n' "${CONFIG_DIGEST}"
} >"${pending_file}"
/bin/chmod 600 "${pending_file}"
run_recovery
test ! -e "${pending_file}"

release_one="${app_dir}/runtime-config/releases/${CONFIG_DIGEST#sha256:}"
release_two="${app_dir}/runtime-config/releases/${CONFIG_DIGEST_TWO#sha256:}"
/bin/cp -R "${release_one}" "${release_two}"
original_content_sha="$(/usr/bin/sed -n 's/^RUNTIME_CONFIG_CONTENT_SHA256=//p' "${state_file}")"
target_content_sha="$(
  {
    /usr/bin/shasum -a 256 "${release_two}/compose.yaml"
    /usr/bin/shasum -a 256 \
      "${release_two}/infra/nginx/cloudflare-edge-real-ip.conf"
    /usr/bin/shasum -a 256 \
      "${release_two}/scripts/backup-guess-pokemon.sh"
    /usr/bin/shasum -a 256 \
      "${release_two}/scripts/deploy-guess-pokemon.sh"
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

/bin/cp "${state_file}" "${state_file}.valid"
/usr/bin/sed \
  -e 's#^RUNTIME_CONFIG_REVISION=.*#RUNTIME_CONFIG_REVISION=garbage#' \
  "${state_file}.valid" >"${state_file}"
set +e
run_recovery >/dev/null 2>&1
invalid_state_recovery_exit_code="$?"
set -e
if [[ "${invalid_state_recovery_exit_code}" -ne 1 || ! -f "${pending_file}" ]]; then
  printf 'Recovery with invalid state values must fail and preserve pending\n' >&2
  exit 1
fi
/bin/mv "${state_file}.valid" "${state_file}"

set +e
run_recovery >/dev/null 2>&1
mismatched_predecessor_exit_code="$?"
set -e
if [[ "${mismatched_predecessor_exit_code}" -ne 1 || ! -f "${pending_file}" ]]; then
  printf 'Completed target recovery with a mismatched predecessor must fail\n' >&2
  exit 1
fi
/usr/bin/sed \
  -e "s#^PREVIOUS_APPLICATION_REVISION=.*#PREVIOUS_APPLICATION_REVISION=${REVISION_TWO}#" \
  -e "s#^PREVIOUS_RUNTIME_CONFIG_DIGEST=.*#PREVIOUS_RUNTIME_CONFIG_DIGEST=${CONFIG_DIGEST}#" \
  "${state_file}" >"${state_file}.matched"
/bin/mv "${state_file}.matched" "${state_file}"

/bin/rm -f -- "${initialization_marker}"
test ! -e "${initialization_marker}"
run_recovery

test "$(/bin/cat "${initialization_marker}")" = RUNTIME_CONFIG_V2=initialized
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

FAKE_RENDER_API_EXTRA_ENVIRONMENT=',"NEW_RUNTIME_SETTING":"enabled"' \
FAKE_RENDER_API_HEALTHCHECK_JSON='{"test":["CMD-SHELL","wget -qO- http://127.0.0.1:8080/actuator/health/readiness | grep -q '\''\"status\":\"UP\"'\''"],"interval":"30s","retries":2}' \
FAKE_RENDER_LOGGING_JSON='{"driver":"local","options":{"max-size":"20m"}}' \
  run_deploy "${REVISION_TWO}" keep test-user

verified_state_sha="$(
  /usr/bin/shasum -a 256 "${state_file}" | /usr/bin/awk '{print $1}'
)"
verified_env_sha="$(
  /usr/bin/shasum -a 256 "${app_dir}/.env" | /usr/bin/awk '{print $1}'
)"
verified_current_target="$(/usr/bin/readlink "${current_link}")"

migration_failure_log="${test_root}/migration-failure-docker.log"
: >"${migration_failure_log}"
set +e
FAKE_CONFIG_REVISION_OVERRIDE="${REVISION_THREE}" \
FAKE_DOCKER_LOG="${migration_failure_log}" \
FAKE_MIGRATION_FAIL=true \
  run_deploy \
    "${REVISION_THREE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user \
    >/dev/null 2>&1
migration_failure_exit_code="$?"
set -e
if [[ "${migration_failure_exit_code}" -ne 1 ]] \
  || [[ ! -f "${pending_file}" ]]
then
  printf 'Migration failure must retain a recoverable pending transaction\n' >&2
  exit 1
fi
/usr/bin/grep -Fq -- \
  'run --rm --no-deps --pull never --entrypoint java api -Dloader.main=com.guesspokemon.ops.MigrationMain -cp /app/application.jar org.springframework.boot.loader.launch.PropertiesLauncher' \
  "${migration_failure_log}"
/usr/bin/grep -Fxq -- \
  "migration-images API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:${REVISION_THREE} WEB_IMAGE=ghcr.io/xxh3898/guess-pokemon-web:${REVISION_THREE}" \
  "${migration_failure_log}"
if /usr/bin/grep -q '^compose .* up ' "${migration_failure_log}"; then
  printf 'Migration failure must not start candidate application containers\n' >&2
  exit 1
fi
test "$(/usr/bin/shasum -a 256 "${state_file}" | /usr/bin/awk '{print $1}')" \
  = "${verified_state_sha}"
test "$(/usr/bin/shasum -a 256 "${app_dir}/.env" | /usr/bin/awk '{print $1}')" \
  = "${verified_env_sha}"
test "$(/usr/bin/readlink "${current_link}")" = "${verified_current_target}"
run_recovery
test ! -e "${pending_file}"

public_smoke_failure_marker="${test_root}/fail-public-smoke-once"
set +e
FAKE_CONFIG_REVISION_OVERRIDE="${REVISION_THREE}" \
FAKE_PUBLIC_SMOKE_FAIL_ONCE_FILE="${public_smoke_failure_marker}" \
  run_deploy \
    "${REVISION_THREE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user \
    >/dev/null 2>&1
public_smoke_failure_exit_code="$?"
set -e
if [[ "${public_smoke_failure_exit_code}" -ne 1 ]] \
  || [[ ! -f "${public_smoke_failure_marker}" ]] \
  || [[ -e "${pending_file}" ]]
then
  printf 'Public smoke failure must roll application images back and clear pending\n' >&2
  exit 1
fi
test "$(/usr/bin/shasum -a 256 "${state_file}" | /usr/bin/awk '{print $1}')" \
  = "${verified_state_sha}"
test "$(/usr/bin/shasum -a 256 "${app_dir}/.env" | /usr/bin/awk '{print $1}')" \
  = "${verified_env_sha}"
test "$(/usr/bin/readlink "${current_link}")" = "${verified_current_target}"

FAKE_RENDER_BASELINE_COMPOSE_FILE="${release_one}/compose.yaml" \
FAKE_RENDER_CANDIDATE_DB_IMAGE=postgres:unexpected \
  assert_deploy_rejected \
    'Runtime config changing the active PostgreSQL image must fail' \
    "${REVISION_THREE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user

FAKE_RENDER_BASELINE_COMPOSE_FILE="${release_one}/compose.yaml" \
FAKE_RENDER_CANDIDATE_DB_EXTRA_ENVIRONMENT=',"PGDATA":"/tmp/unprotected-data"' \
  assert_deploy_rejected \
    'Runtime config changing PostgreSQL storage environment must fail' \
    "${REVISION_THREE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user

FAKE_RENDER_BASELINE_COMPOSE_FILE="${release_one}/compose.yaml" \
FAKE_RENDER_CANDIDATE_DB_COMMAND_JSON='["postgres","--single"]' \
  assert_deploy_rejected \
    'Runtime config changing the PostgreSQL command must fail' \
    "${REVISION_THREE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user

FAKE_RENDER_BASELINE_COMPOSE_FILE="${release_one}/compose.yaml" \
FAKE_RENDER_CANDIDATE_API_EXTRA_ENVIRONMENT=',"SPRING_JPA_HIBERNATE_DDL_AUTO":"create-drop"' \
  assert_deploy_rejected \
    'Runtime config enabling destructive schema management must fail' \
    "${REVISION_THREE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user

FAKE_RENDER_BASELINE_COMPOSE_FILE="${release_one}/compose.yaml" \
FAKE_RENDER_CANDIDATE_FLYWAY_ENABLED=true \
  assert_deploy_rejected \
    'Runtime config enabling automatic API Flyway execution must fail' \
    "${REVISION_THREE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user

FAKE_RENDER_BASELINE_COMPOSE_FILE="${release_one}/compose.yaml" \
FAKE_RENDER_CANDIDATE_API_EXTRA_ENVIRONMENT=',"spring.jpa.hibernate.ddl-auto":"create-drop"' \
  assert_deploy_rejected \
    'Runtime config using a relaxed-binding Spring schema key must fail' \
    "${REVISION_THREE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user

FAKE_RENDER_BASELINE_COMPOSE_FILE="${release_one}/compose.yaml" \
FAKE_RENDER_CANDIDATE_API_EXTRA_ENVIRONMENT=',"spring.datasource.url":"jdbc:postgresql://elsewhere/guess_pokemon"' \
  assert_deploy_rejected \
    'Runtime config with colliding relaxed-binding Spring keys must fail closed' \
    "${REVISION_THREE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user

FAKE_RENDER_BASELINE_COMPOSE_FILE="${release_one}/compose.yaml" \
FAKE_RENDER_CANDIDATE_API_EXTRA_ENVIRONMENT=',"SPRING_APPLICATION_JSON":"{}"' \
  assert_deploy_rejected \
    'Runtime config using Spring JSON property overrides must fail' \
    "${REVISION_THREE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user

FAKE_RENDER_BASELINE_COMPOSE_FILE="${release_one}/compose.yaml" \
FAKE_RENDER_CANDIDATE_API_SERVICE_EXTRA=',"post_start":[{"command":["/bin/sh","-c","true"]}]' \
  assert_deploy_rejected \
    'Runtime config with an API post_start hook must fail' \
    "${REVISION_THREE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user

FAKE_RENDER_BASELINE_COMPOSE_FILE="${release_one}/compose.yaml" \
FAKE_RENDER_CANDIDATE_DB_SERVICE_EXTRA=',"pre_stop":[{"command":["/bin/sh","-c","true"]}]' \
  assert_deploy_rejected \
    'Runtime config with a database pre_stop hook must fail' \
    "${REVISION_THREE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user

FAKE_RENDER_BASELINE_COMPOSE_FILE="${release_one}/compose.yaml" \
FAKE_RENDER_CANDIDATE_API_HEALTHCHECK_JSON='{"test":["CMD-SHELL","true # http://127.0.0.1:8080/actuator/health/readiness status UP"],"interval":"10s"}' \
  assert_deploy_rejected \
    'Runtime config replacing readiness with an always-success probe must fail' \
    "${REVISION_THREE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user

FAKE_RENDER_BASELINE_COMPOSE_FILE="${release_one}/compose.yaml" \
FAKE_RENDER_CANDIDATE_API_USER_JSON='"00:1000"' \
  assert_deploy_rejected \
    'Runtime config changing the API process user must fail' \
    "${REVISION_THREE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user

FAKE_RENDER_BASELINE_COMPOSE_FILE="${release_one}/compose.yaml" \
FAKE_RENDER_CANDIDATE_API_TMPFS_JSON='["/tmp:size=128m,mode=1777","/app:size=32m"]' \
  assert_deploy_rejected \
    'Runtime config changing the API tmpfs target set must fail' \
    "${REVISION_THREE}" \
    update \
    "${CONFIG_DIGEST_TWO}" \
    test-user

FAKE_RENDER_WEB_SERVICE_NAME=renamed-web \
  assert_deploy_rejected \
    'Runtime config without the required Web service must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_EXTRA_SERVICE_JSON=',"sidecar":{"image":"busybox","networks":{},"volumes":[]}' \
  assert_deploy_rejected \
    'Runtime config with an extra service must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_DB_VOLUME_EXTRA='"subpath":"18/docker/base"' \
  assert_deploy_rejected \
    'PostgreSQL volume subpath override must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_API_VOLUMES_JSON='[{"type":"volume","source":"postgres-data","target":"/var/lib/postgresql","volume":{}}]' \
  assert_deploy_rejected \
    'API service mounting the database volume must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_API_COMMAND_JSON='["sh","-c","exit 0"]' \
  assert_deploy_rejected \
    'Runtime config overriding the API image command must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_API_VOLUMES_FROM_JSON='["db"]' \
  assert_deploy_rejected \
    'Runtime config using volumes_from must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_API_CONFIGS_JSON='[{"source":"host-config","target":"/tmp/config"}]' \
  assert_deploy_rejected \
    'Runtime config using Compose configs must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_API_SECRETS_JSON='[{"source":"host-secret","target":"/tmp/secret"}]' \
  assert_deploy_rejected \
    'Runtime config using Compose secrets must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_API_ENV_FILE_JSON='[{"path":"/Users/homeserver/Server/apps/guess-pokemon/.env"}]' \
  assert_deploy_rejected \
    'Runtime config using a service env_file must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_API_EXTRA_HOSTS_JSON='{"db":"192.0.2.10"}' \
  assert_deploy_rejected \
    'Runtime config overriding the database hostname must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_POSTGRES_VOLUME_EXTRA=',"driver_opts":{"type":"none","o":"bind","device":"/"}' \
  assert_deploy_rejected \
    'PostgreSQL top-level volume host bind must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_DB_NETWORKS_JSON='{"application":null,"egress":null}' \
  assert_deploy_rejected \
    'Database attachment to the egress network must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_API_NETWORKS_JSON='{"application":null,"edge":null}' \
  assert_deploy_rejected \
    'API attachment outside application and egress must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_WEB_NETWORKS_JSON='{"application":null}' \
  assert_deploy_rejected \
    'Web without the edge network must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_APPLICATION_JSON='{"name":"shared-internal","driver":"bridge","internal":true}' \
  assert_deploy_rejected \
    'Shared application network must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_EGRESS_JSON='{"name":"guess-pokemon_egress","driver":"bridge","external":true}' \
  assert_deploy_rejected \
    'External egress network must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_EDGE_ALIAS=unexpected \
  assert_deploy_rejected \
    'Runtime config without the Cloudflare Web alias must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_WEB_NETWORKS_JSON='{"application":null,"edge":{"aliases":["guess-pokemon-web","portfolio"]}}' \
  assert_deploy_rejected \
    'Runtime config with an additional shared edge alias must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_API_PORTS_JSON='[{"target":8080,"published":"8080"}]' \
  assert_deploy_rejected \
    'Runtime config with a published host port must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_API_PRIVILEGED=true \
  assert_deploy_rejected \
    'Runtime config with a privileged service must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_API_CAP_ADD_JSON='["SYS_ADMIN"]' \
  assert_deploy_rejected \
    'Runtime config adding Linux capabilities must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_API_USE_API_SOCKET=true \
  assert_deploy_rejected \
    'Runtime config with Docker API socket access must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_API_PID_JSON='"host"' \
  assert_deploy_rejected \
    'Runtime config with a host namespace must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_API_VOLUMES_JSON='[{"type":"bind","source":"/","target":"/host"}]' \
  assert_deploy_rejected \
    'Runtime config with a broad host bind must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

set +e
FAKE_RUNNING_SERVICES=$'db\nweb' \
  run_deploy "${REVISION_THREE}" keep test-user >/dev/null 2>&1
incomplete_service_exit_code="$?"
set -e
if [[ "${incomplete_service_exit_code}" -ne 1 ]]; then
  printf 'Deployment missing a required running service must fail\n' >&2
  exit 1
fi
/usr/bin/grep -Fxq "APPLICATION_REVISION=${REVISION_TWO}" "${state_file}"
/usr/bin/grep -Fxq \
  "API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:${REVISION_TWO}" \
  "${app_dir}/.env"
if [[ ! -f "${pending_file}" ]]; then
  printf 'Failed deployment and rollback readiness must retain pending state\n' >&2
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

/bin/mv "${state_file}" "${state_file}.valid"
/bin/ln -s missing-state "${state_file}"
set +e
run_deploy \
  "${REVISION_THREE}" \
  update \
  "${CONFIG_DIGEST_TWO}" \
  test-user \
  >/dev/null 2>&1
dangling_state_exit_code="$?"
set -e
if [[ "${dangling_state_exit_code}" -ne 1 ]]; then
  printf 'Update with a dangling runtime config state symlink must fail\n' >&2
  exit 1
fi
/bin/rm -f -- "${state_file}"
/bin/mv "${state_file}.valid" "${state_file}"

FAKE_RENDER_API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:unexpected \
  assert_deploy_rejected \
    'Runtime config with a different API image must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_WEB_IMAGE=ghcr.io/xxh3898/guess-pokemon-web:unexpected \
  assert_deploy_rejected \
    'Runtime config with a different Web image must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

FAKE_RENDER_REAL_IP_SOURCE=/tmp/stale/infra/nginx/cloudflare-edge-real-ip.conf \
  assert_deploy_rejected \
    'Runtime config with a non-release real-IP bind must fail' \
    "${REVISION_THREE}" \
    keep \
    test-user

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
