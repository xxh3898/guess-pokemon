import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  baseCompose,
  devCompose,
  tunnelCompose,
  testCompose,
  envExample,
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
  read("../compose.test.yaml"),
  read("../.env.example"),
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
