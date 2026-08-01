#!/bin/sh

set -eu

backend=false
frontend=false
infrastructure=false
api_image=false
web_image=false
all=false

for changed_path in "$@"; do
  matched=true

  case "${changed_path}" in
    .github/workflows/* | .dockerignore | compose.test.yaml | scripts/classify-ci-paths.sh)
      all=true
      ;;
    backend/Dockerfile)
      backend=true
      infrastructure=true
      api_image=true
      ;;
    frontend/Dockerfile)
      frontend=true
      infrastructure=true
      web_image=true
      ;;
    backend/*)
      backend=true
      api_image=true
      ;;
    frontend/*)
      frontend=true
      web_image=true
      ;;
    infra/nginx/default.conf)
      infrastructure=true
      web_image=true
      ;;
    infra/* | launchd/* | scripts/* | compose*.yaml | runtime-config.Dockerfile | .env.example | .env.production.example | README.md | docs/*)
      infrastructure=true
      ;;
    AGENTS.md | .editorconfig | .gitignore)
      ;;
    *)
      matched=false
      ;;
  esac

  if [ "${matched}" = "false" ]; then
    all=true
  fi
done

if [ "${all}" = "true" ]; then
  backend=true
  frontend=true
  infrastructure=true
  api_image=true
  web_image=true
fi

write_outputs() {
  printf 'backend=%s\n' "${backend}"
  printf 'frontend=%s\n' "${frontend}"
  printf 'infrastructure=%s\n' "${infrastructure}"
  printf 'api_image=%s\n' "${api_image}"
  printf 'web_image=%s\n' "${web_image}"
}

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  write_outputs >>"${GITHUB_OUTPUT}"
else
  write_outputs
fi
