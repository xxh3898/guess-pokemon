import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const nginxConfig = await readFile(
  new URL("../infra/nginx/default.conf", import.meta.url),
  "utf8",
);
const cloudflareRealIpConfig = await readFile(
  new URL(
    "../infra/nginx/cloudflare-real-ip.conf",
    import.meta.url,
  ),
  "utf8",
);

test("should_trustOnlyTunnelConnectorAddresses_when_realIpIsEnabled", () => {
  assert.match(
    cloudflareRealIpConfig,
    /set_real_ip_from 172\.30\.77\.3;/,
  );
  assert.match(
    cloudflareRealIpConfig,
    /set_real_ip_from 172\.30\.77\.4;/,
  );
  assert.match(
    cloudflareRealIpConfig,
    /real_ip_header CF-Connecting-IP;/,
  );
  assert.match(
    cloudflareRealIpConfig,
    /real_ip_recursive off;/,
  );
  assert.doesNotMatch(
    cloudflareRealIpConfig,
    /set_real_ip_from (?:0\.0\.0\.0\/0|10\.0\.0\.0\/8|172\.16\.0\.0\/12|192\.168\.0\.0\/16);/,
  );
});

test("should_forwardExternalSchemeAndPort_when_requestComesFromTunnel", () => {
  assert.match(
    nginxConfig,
    /map \$realip_remote_addr \$trusted_tunnel_request \{[\s\S]*172\.30\.77\.3 1;[\s\S]*172\.30\.77\.4 1;[\s\S]*default 0;[\s\S]*\}/,
  );
  assert.match(
    nginxConfig,
    /map "\$trusted_tunnel_request:\$http_x_forwarded_proto" \$external_scheme \{[\s\S]*"1:http" http;[\s\S]*"1:https" https;[\s\S]*default \$scheme;[\s\S]*\}/,
  );
  assert.match(
    nginxConfig,
    /map "\$explicit_external_port:\$external_scheme" \$external_port \{[\s\S]*":https" 443;[\s\S]*default \$server_port;[\s\S]*\}/,
  );

  assert.equal(
    countMatches(
      nginxConfig,
      /proxy_set_header X-Forwarded-Proto \$external_scheme;/g,
    ),
    5,
  );
  assert.equal(
    countMatches(
      nginxConfig,
      /proxy_set_header X-Forwarded-Port \$external_port;/g,
    ),
    5,
  );
  assert.equal(
    countMatches(
      nginxConfig,
      /proxy_set_header X-Forwarded-For \$remote_addr;/g,
    ),
    5,
  );
});

test("should_preserveBrowserHost_when_proxyingWebSocket", () => {
  const webSocketLocation = nginxConfig.match(
    /location \/ws \{(?<body>[\s\S]*?)\n    \}/,
  )?.groups?.body;

  assert.ok(webSocketLocation, "location /ws block is required");
  assert.match(
    webSocketLocation,
    /proxy_set_header Host \$external_host;/,
  );
  assert.match(
    webSocketLocation,
    /proxy_set_header X-Forwarded-Host \$external_host;/,
  );
  assert.match(
    webSocketLocation,
    /proxy_set_header X-Forwarded-Port \$external_port;/,
  );
  assert.match(
    webSocketLocation,
    /proxy_read_timeout 70s;/,
  );
});

test("should_limitApiBursts_when_requestRateIsExceeded", () => {
  assert.match(
    nginxConfig,
    /limit_req_zone \$binary_remote_addr zone=api_per_ip:10m rate=20r\/s;/,
  );
  assert.match(
    nginxConfig,
    /limit_req_zone \$binary_remote_addr zone=auth_per_ip:10m rate=30r\/m;/,
  );
  assert.match(nginxConfig, /limit_req_status 429;/);
  assert.match(
    nginxConfig,
    /location ~ \^\/api\/v1\/auth\/\(\?:login\|signup\)\$ \{[\s\S]*limit_req zone=auth_per_ip burst=10 nodelay;/,
  );
  assert.match(
    nginxConfig,
    /location \/api\/ \{[\s\S]*limit_req zone=api_per_ip burst=40 nodelay;/,
  );
});

test("should_sendHstsOnlyForHttps_when_securityHeadersAreApplied", () => {
  assert.match(
    nginxConfig,
    /map \$external_scheme \$strict_transport_security \{[\s\S]*https "max-age=31536000";[\s\S]*default "";/,
  );
  assert.match(
    nginxConfig,
    /add_header Strict-Transport-Security \$strict_transport_security always;/,
  );
  assert.match(
    nginxConfig,
    /add_header Permissions-Policy "camera=\(\), microphone=\(\), geolocation=\(\)" always;/,
  );
  assert.match(
    nginxConfig,
    /add_header Content-Security-Policy [^\n]+ always;/,
  );
  assert.match(nginxConfig, /server_tokens off;/);
});

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}
