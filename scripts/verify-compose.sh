#!/usr/bin/env bash

set -Eeuo pipefail

repository_root="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1
  pwd -P
)"
environment_file="${ENV_FILE:-${repository_root}/.env}"
verification_mode="${1:-config}"

fail() {
  printf '구성 검증 실패: %s\n' "$1" >&2
  exit 1
}

case "${verification_mode}" in
  config | named)
    ;;
  *)
    fail "지원하지 않는 mode입니다. config 또는 named를 사용하세요."
    ;;
esac

command -v docker >/dev/null 2>&1 ||
  fail "Docker 명령을 찾지 못했습니다."
docker compose version >/dev/null 2>&1 ||
  fail "Docker Compose를 사용할 수 없습니다."
[[ -f "${environment_file}" ]] ||
  fail "환경 파일을 찾지 못했습니다: ${environment_file}"

normalized_profiles=",${COMPOSE_PROFILES//[[:space:]]/},"
if [[ "${normalized_profiles}" == *",quick-tunnel,"* ]] &&
  [[ "${normalized_profiles}" == *",named-tunnel,"* ]]; then
  fail "quick-tunnel과 named-tunnel profile은 동시에 사용할 수 없습니다."
fi

compose_command=(
  docker compose
  --env-file "${environment_file}"
  --file "${repository_root}/compose.yaml"
)

"${compose_command[@]}" config --quiet
"${compose_command[@]}" \
  --file "${repository_root}/compose.dev.yaml" \
  config --quiet
"${compose_command[@]}" \
  --file "${repository_root}/compose.tunnel.yaml" \
  --profile quick-tunnel \
  config --quiet
"${compose_command[@]}" \
  --file "${repository_root}/compose.tunnel.yaml" \
  --profile named-tunnel \
  config --quiet

if [[ "${verification_mode}" == "named" ]]; then
  token_file="${CLOUDFLARE_TUNNEL_TOKEN_FILE:-}"
  if [[ -z "${token_file}" ]]; then
    while IFS= read -r line; do
      case "${line}" in
        CLOUDFLARE_TUNNEL_TOKEN_FILE=*)
          token_file="${line#*=}"
          ;;
      esac
    done <"${environment_file}"
  fi
  token_file="${token_file:-./secrets/cloudflare-tunnel-token}"

  [[ "${token_file}" != *'$'* ]] ||
    fail "token file path에는 변수 표현식을 사용할 수 없습니다."
  [[ "${token_file}" != *'`'* ]] ||
    fail "token file path에는 명령 표현식을 사용할 수 없습니다."
  if [[ "${token_file}" != /* ]]; then
    token_file="${repository_root}/${token_file#./}"
  fi

  [[ ! -L "${token_file}" ]] ||
    fail "token file은 symbolic link일 수 없습니다."
  [[ -f "${token_file}" && -s "${token_file}" ]] ||
    fail "비어 있지 않은 named tunnel token file이 필요합니다."
fi

printf 'Compose 구성 검증 완료: base, dev, quick-tunnel, named-tunnel\n'
