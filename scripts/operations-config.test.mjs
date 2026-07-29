import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  baseCompose,
  devCompose,
  tunnelCompose,
  productionCompose,
  testCompose,
  envExample,
  productionEnvExample,
  frontendDockerfile,
  backupScript,
  verifyScript,
  readme,
  architecture,
  operations,
] = await Promise.all([
  read("../compose.yaml"),
  read("../compose.dev.yaml"),
  read("../compose.tunnel.yaml"),
  read("../compose.production.yaml"),
  read("../compose.test.yaml"),
  read("../.env.example"),
  read("../.env.production.example"),
  read("../frontend/Dockerfile"),
  read("./backup-db.sh"),
  read("./verify-compose.sh"),
  read("../README.md"),
  read("../docs/ARCHITECTURE.md"),
  read("../docs/OPERATIONS.md"),
]);

const cloudflaredImage =
  "cloudflare/cloudflared:2026.7.3@" +
  "sha256:e39ee8da81ad5e05d77f38d2f51c60ca51bf2a8450ac3abab50c17fdb91d91bf";

test("should_pinCloudflaredManifest_when_tunnelProfilesAreConfigured", () => {
  assert.equal(
    countLiteral(tunnelCompose, `image: ${cloudflaredImage}`),
    2,
  );
  assert.doesNotMatch(tunnelCompose, /cloudflared:latest/);
  assert.match(tunnelCompose, /profiles:\n\s+- quick-tunnel/);
  assert.match(tunnelCompose, /profiles:\n\s+- named-tunnel/);
  assert.match(
    tunnelCompose,
    /command:\n\s+- tunnel\n\s+- --url\n\s+- http:\/\/web:80/,
  );
  assert.match(
    tunnelCompose,
    /command:\n\s+- tunnel\n\s+- run\n\s+- --token-file\n\s+- \/run\/secrets\/cloudflare_tunnel_token/,
  );
});

test("should_hardenConnectorContainers_when_tunnelProfilesRun", () => {
  for (const serviceName of [
    "cloudflared-quick",
    "cloudflared-named",
  ]) {
    const connector = serviceBlock(tunnelCompose, serviceName);
    assert.match(connector, /\n    read_only: true/);
    assert.match(connector, /\n    cap_drop:\n      - ALL/);
    assert.match(
      connector,
      /\n    security_opt:\n      - no-new-privileges:true/,
    );
    assert.match(
      connector,
      /\n    tmpfs:\n      - \/tmp:size=16m,mode=1777/,
    );
  }
});

test("should_isolateTunnelFromDatabase_when_networksAreMerged", () => {
  assert.match(
    tunnelCompose,
    /tunnel-origin:\n\s+ipam:\n\s+config:\n\s+- subnet: 172\.30\.77\.0\/29/,
  );
  assert.match(
    tunnelCompose,
    /web:[\s\S]*tunnel-origin:\n\s+ipv4_address: 172\.30\.77\.2/,
  );
  assert.match(
    tunnelCompose,
    /cloudflared-quick:[\s\S]*networks:\n\s+tunnel-origin:\n\s+ipv4_address: 172\.30\.77\.3/,
  );
  assert.match(
    tunnelCompose,
    /cloudflared-named:[\s\S]*networks:\n\s+tunnel-origin:\n\s+ipv4_address: 172\.30\.77\.4/,
  );

  const dbBlock = serviceBlock(baseCompose, "db");
  assert.doesNotMatch(dbBlock, /\n\s+ports:/);
  assert.doesNotMatch(tunnelCompose, /cloudflared-(?:quick|named):[\s\S]*\n\s+default:/);
});

test("should_forceSecureCookieAndLoopbackOrigin_when_tunnelOverrideIsUsed", () => {
  assert.match(
    tunnelCompose,
    /SESSION_COOKIE_SECURE: "true"/,
  );
  assert.match(
    tunnelCompose,
    /"127\.0\.0\.1:\$\{TUNNEL_ORIGIN_PORT:-8080\}:80"/,
  );
  assert.match(
    tunnelCompose,
    /source: \.\/infra\/nginx\/cloudflare-real-ip\.conf/,
  );
  assert.match(
    envExample,
    /TUNNEL_ORIGIN_PORT=8080/,
  );
});

test("should_isolateProductionDatabaseAndGiveOnlyApiEgress", () => {
  const db = serviceBlock(productionCompose, "db");
  const api = serviceBlock(productionCompose, "api");
  const web = serviceBlock(productionCompose, "web");

  assert.doesNotMatch(db, /\n\s+ports:/);
  assert.doesNotMatch(api, /\n\s+ports:/);
  assert.doesNotMatch(web, /\n\s+ports:/);
  assert.match(db, /\n    networks:\n      - application/);
  assert.doesNotMatch(db, /\n      - egress/);
  assert.match(
    api,
    /\n    networks:\n      - application\n      - egress/,
  );
  assert.doesNotMatch(api, /\n      - edge/);
  assert.doesNotMatch(web, /\n\s+egress:/);
  assert.match(
    web,
    /\n    networks:\n      application:\n      edge:\n        aliases:\n          - guess-pokemon-web/,
  );
  assert.match(
    productionCompose,
    /application:\n    internal: true\n  egress:\n    driver: bridge\n  edge:\n    external: true\n    name: edge/,
  );
});

test("should_useImmutableShaImagesAndSecureSessionInProduction", () => {
  assert.match(
    productionCompose,
    /image: \$\{API_IMAGE:\?API_IMAGE must be set\}/,
  );
  assert.match(
    productionCompose,
    /image: \$\{WEB_IMAGE:\?WEB_IMAGE must be set\}/,
  );
  assert.match(
    productionEnvExample,
    /API_IMAGE=ghcr\.io\/xxh3898\/guess-pokemon-api:[0-9a-f]{40}/,
  );
  assert.match(
    productionEnvExample,
    /WEB_IMAGE=ghcr\.io\/xxh3898\/guess-pokemon-web:[0-9a-f]{40}/,
  );
  assert.match(productionCompose, /SESSION_COOKIE_SECURE: "true"/);
  assert.doesNotMatch(productionCompose, /\bbuild:/);
});

test("should_hardenProductionApplicationContainers", () => {
  for (const serviceName of ["api", "web"]) {
    const service = serviceBlock(productionCompose, serviceName);
    assert.match(service, /\n    read_only: true/);
    assert.match(
      service,
      /\n    security_opt:\n      - no-new-privileges:true/,
    );
    assert.match(service, /\n    pids_limit: [0-9]+/);
    assert.match(
      service,
      /\n    logging:\n      driver: json-file\n      options:\n        max-size: 10m\n        max-file: "3"/,
    );
  }
});

test("should_mountPinnedSharedConnectorTrustInProduction", () => {
  assert.match(
    productionCompose,
    /source: \.\/infra\/nginx\/cloudflare-edge-real-ip\.conf/,
  );
  assert.match(
    productionCompose,
    /target: \/etc\/nginx\/conf\.d\/00-cloudflare-real-ip\.conf/,
  );
});

test("should_mountTokenAsFileOnly_when_namedTunnelRuns", () => {
  assert.match(
    tunnelCompose,
    /secrets:\n\s+- source: cloudflare_tunnel_token\n\s+target: cloudflare_tunnel_token/,
  );
  assert.match(
    tunnelCompose,
    /cloudflare_tunnel_token:\n\s+file: \$\{CLOUDFLARE_TUNNEL_TOKEN_FILE:-\.\/secrets\/cloudflare-tunnel-token\}/,
  );
  assert.match(
    envExample,
    /CLOUDFLARE_TUNNEL_TOKEN_FILE=\.\/secrets\/cloudflare-tunnel-token/,
  );
  assert.doesNotMatch(
    tunnelCompose,
    /CLOUDFLARE_TUNNEL_TOKEN(?:=|:)/,
  );
});

test("should_keepDevelopmentAdminerOnLoopback_when_tunnelFilesAreAdded", () => {
  assert.match(
    devCompose,
    /"127\.0\.0\.1:\$\{ADMINER_PORT:-8081\}:8080"/,
  );
  assert.doesNotMatch(baseCompose, /adminer:/);
  assert.doesNotMatch(tunnelCompose, /adminer:/);
});

test("should_validateArchiveBeforePublishing_when_backupRuns", () => {
  assert.match(backupScript, /set -Eeuo pipefail/);
  assert.match(backupScript, /umask 077/);
  assert.match(backupScript, /pg_dump/);
  assert.match(backupScript, /--format=custom/);
  assert.match(backupScript, /--no-owner/);
  assert.match(backupScript, /--no-privileges/);
  assert.match(backupScript, /pg_restore --list/);
  assert.match(backupScript, /mktemp/);
  assert.match(backupScript, /trap cleanup EXIT/);
  assert.match(backupScript, /trap 'exit 130' INT/);
  assert.match(backupScript, /trap 'exit 143' TERM/);
  assert.match(
    backupScript,
    /ln "\$\{temporary_file\}" "\$\{final_file\}"/,
  );
  assert.doesNotMatch(backupScript, /down -v|--clean|find .*delete/);
});

test("should_renderEveryComposeVariant_without_startingServices", () => {
  assert.match(verifyScript, /config --quiet/);
  assert.match(verifyScript, /compose\.dev\.yaml/);
  assert.match(verifyScript, /compose\.tunnel\.yaml/);
  assert.match(verifyScript, /--profile quick-tunnel/);
  assert.match(verifyScript, /--profile named-tunnel/);
  assert.match(verifyScript, /compose\.production\.yaml/);
  assert.match(verifyScript, /\.env\.production\.example/);
  assert.match(
    verifyScript,
    /compose_profiles="\$\{COMPOSE_PROFILES:-\}"/,
  );
  assert.match(
    verifyScript,
    /quick-tunnel과 named-tunnel profile은 동시에 사용할 수 없습니다/,
  );
  assert.doesNotMatch(verifyScript, /\bup\b|\bstart\b|\bdown\b/);
});

test("should_runStaticAndRuntimeNginxChecks_when_infraTestsRun", () => {
  assert.match(
    testCompose,
    /scripts\/operations-config\.test\.mjs/,
  );
  assert.match(testCompose, /nginx-config-test:/);
  assert.match(testCompose, /command: nginx -t/);
  assert.match(
    frontendDockerfile,
    /FROM nginx:1\.30\.4-alpine3\.24 AS runtime/,
  );
});

test("should_useCiGradleCacheMount_withoutChangingLocalDefault", () => {
  const backendTest = serviceBlock(testCompose, "backend-test");

  assert.match(
    backendTest,
    /\$\{BACKEND_GRADLE_USER_HOME_VOLUME:-backend-test-gradle-cache\}:\/home\/gradle\/\.gradle/,
  );
  assert.match(
    testCompose,
    /\n  backend-test-gradle-cache:\n/,
  );
  assert.doesNotMatch(
    backendTest,
    /--build-cache|--configuration-cache|org\.gradle\.caching/,
  );
});

test("should_keepFrontendInputsReadOnly_without_nestingOutputsUnderReadOnlyBind", () => {
  const frontendTest = serviceBlock(testCompose, "frontend-test");

  assert.doesNotMatch(frontendTest, /\.\/frontend:\/workspace:ro/);
  for (const inputMount of [
    "./frontend/index.html:/workspace/index.html:ro",
    "./frontend/package-lock.json:/workspace/package-lock.json:ro",
    "./frontend/package.json:/workspace/package.json:ro",
    "./frontend/public:/workspace/public:ro",
    "./frontend/src:/workspace/src:ro",
    "./frontend/tsconfig.app.json:/workspace/tsconfig.app.json:ro",
    "./frontend/tsconfig.json:/workspace/tsconfig.json:ro",
    "./frontend/tsconfig.node.json:/workspace/tsconfig.node.json:ro",
    "./frontend/vite.config.test.ts:/workspace/vite.config.test.ts:ro",
    "./frontend/vite.config.ts:/workspace/vite.config.ts:ro",
    "./frontend/vitest.config.ts:/workspace/vitest.config.ts:ro",
  ]) {
    assert.ok(
      frontendTest.includes(inputMount),
      `${inputMount} read-only mount is required`,
    );
  }
  assert.match(
    frontendTest,
    /frontend-test-dist:\/workspace\/dist/,
  );
  assert.match(
    frontendTest,
    /frontend-test-node-modules:\/workspace\/node_modules/,
  );
});

test("should_documentSafeOperations_when_publicationConfigIsUsed", () => {
  assert.match(
    readme,
    /\[운영 가이드\]\(docs\/OPERATIONS\.md\)/,
  );
  assert.match(
    architecture,
    /cloudflared 2026\.7\.3 multi-arch digest 고정/,
  );
  assert.match(operations, /Quick Tunnel과 named tunnel은 동시에 실행하지 않는다/);
  assert.match(
    operations,
    /운영 DB에 직접 restore하지 않는다/,
  );
  assert.match(
    operations,
    /일반 개발·운영 project에는 `down --volumes`를 사용하지 않는다/,
  );
  assert.match(
    operations,
    /자동 삭제도 하지 않는다/,
  );
  assert.match(
    operations,
    /`guess-pokemon\.chochiho\.cloud`/,
  );
  assert.match(
    operations,
    /`guess-pokemon-web`/,
  );
  assert.doesNotMatch(
    operations,
    /(?:eyJ[a-zA-Z0-9_-]{20,}|[a-f0-9]{64}\.[a-f0-9]{16})/,
  );
});

function countLiteral(value, literal) {
  return value.split(literal).length - 1;
}

function read(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

function serviceBlock(compose, serviceName) {
  const match = compose.match(
    new RegExp(
      `\\n  ${serviceName}:\\n(?<body>[\\s\\S]*?)(?=\\n  [a-z][a-z0-9-]*:\\n|\\nvolumes:|$)`,
    ),
  );
  assert.ok(match?.groups?.body, `${serviceName} service is required`);
  return match.groups.body;
}
