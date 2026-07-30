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
        /bin/bash "${test_script}" "$@"
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

run_deploy "${REVISION_TWO}" keep test-user

/usr/bin/grep -Fxq \
  "API_IMAGE=ghcr.io/xxh3898/guess-pokemon-api:${REVISION_TWO}" \
  "${app_dir}/.env"
/usr/bin/grep -Fxq "APPLICATION_REVISION=${REVISION_TWO}" "${state_file}"
/usr/bin/grep -Fxq "RUNTIME_CONFIG_DIGEST=${CONFIG_DIGEST}" "${state_file}"
/usr/bin/grep -Fxq "RUNTIME_CONFIG_REVISION=${REVISION_ONE}" "${state_file}"

release_dir="${app_dir}/runtime-config/releases/${CONFIG_DIGEST#sha256:}"
printf '\n# tampered\n' >>"${release_dir}/compose.yaml"

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
