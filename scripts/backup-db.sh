#!/usr/bin/env bash

set -Eeuo pipefail

umask 077

repository_root="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.." >/dev/null 2>&1
  pwd -P
)"
environment_file="${ENV_FILE:-${repository_root}/.env}"
backup_directory="${BACKUP_DIR:-${repository_root}/backups}"
compose_project_name="${COMPOSE_PROJECT_NAME:-}"
temporary_file=""

fail() {
  printf '백업 실패: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [[ -n "${temporary_file}" && -f "${temporary_file}" ]]; then
    unlink "${temporary_file}"
  fi
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

command -v docker >/dev/null 2>&1 ||
  fail "Docker 명령을 찾지 못했습니다."
docker compose version >/dev/null 2>&1 ||
  fail "Docker Compose를 사용할 수 없습니다."

[[ -f "${environment_file}" ]] ||
  fail "환경 파일을 찾지 못했습니다: ${environment_file}"
[[ -n "${backup_directory}" ]] ||
  fail "BACKUP_DIR은 빈 값일 수 없습니다."

if [[ -n "${compose_project_name}" ]] &&
  [[ ! "${compose_project_name}" =~ ^[a-z0-9][a-z0-9_-]*$ ]]; then
  fail "COMPOSE_PROJECT_NAME 형식이 올바르지 않습니다."
fi

mkdir -p "${backup_directory}"
backup_directory="$(
  cd "${backup_directory}" >/dev/null 2>&1
  pwd -P
)"

[[ "${backup_directory}" != "/" ]] ||
  fail "filesystem root에는 백업할 수 없습니다."
[[ "${backup_directory}" != "${repository_root}" ]] ||
  fail "repository root에는 백업할 수 없습니다."

compose_command=(docker compose)
if [[ -n "${compose_project_name}" ]]; then
  compose_command+=(--project-name "${compose_project_name}")
fi
compose_command+=(
  --env-file "${environment_file}"
  --file "${repository_root}/compose.yaml"
)

running_services="$(
  "${compose_command[@]}" ps --status running --services
)"
if ! grep -qx "db" <<<"${running_services}"; then
  fail "대상 Compose project의 db service가 실행 중이 아닙니다."
fi

project_label="${compose_project_name:-guess-pokemon}"
timestamp="$(date -u '+%Y%m%dT%H%M%SZ')"
final_file="${backup_directory}/guess-pokemon-${project_label}-${timestamp}.dump"
temporary_file="$(
  mktemp "${backup_directory}/.guess-pokemon-backup.XXXXXX"
)"

"${compose_command[@]}" exec -T db sh -ceu '
  exec pg_dump \
    --format=custom \
    --no-owner \
    --no-privileges \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}"
' >"${temporary_file}"

[[ -s "${temporary_file}" ]] ||
  fail "생성한 archive가 비어 있습니다."

"${compose_command[@]}" exec -T db \
  pg_restore --list <"${temporary_file}" >/dev/null

if ! ln "${temporary_file}" "${final_file}"; then
  fail "같은 이름의 archive가 이미 있습니다."
fi
unlink "${temporary_file}"
temporary_file=""

printf '백업 완료: %s\n' "${final_file}"
