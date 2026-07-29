#!/bin/sh

set -eu

backend=false
frontend=false
infrastructure=false
backend_image=false
frontend_image=false
all=false

while IFS= read -r changed_path; do
  case "${changed_path}" in
    .github/workflows/* | .dockerignore | compose.test.yaml | scripts/classify-ci-paths.sh)
      all=true
      ;;
    backend/*)
      backend=true
      backend_image=true
      ;;
    frontend/*)
      frontend=true
      frontend_image=true
      ;;
    infra/nginx/default.conf)
      infrastructure=true
      frontend_image=true
      ;;
    infra/* | scripts/* | compose*.yaml | .env.example | .env.production.example | README.md | docs/*)
      infrastructure=true
      ;;
  esac
done

if [ "${all}" = "true" ]; then
  backend=true
  frontend=true
  infrastructure=true
  backend_image=true
  frontend_image=true
fi

write_outputs() {
  printf 'backend=%s\n' "${backend}"
  printf 'frontend=%s\n' "${frontend}"
  printf 'infrastructure=%s\n' "${infrastructure}"
  printf 'backend_image=%s\n' "${backend_image}"
  printf 'frontend_image=%s\n' "${frontend_image}"
}

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  write_outputs >>"${GITHUB_OUTPUT}"
else
  write_outputs
fi
