import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const nginxConfig = await readFile(
  new URL("../infra/nginx/default.conf", import.meta.url),
  "utf8",
);

test("WebSocket proxy preserves the external host and port", () => {
  assert.match(
    nginxConfig,
    /map \$http_host \$external_port \{[\s\S]*~:\(\?<host_port>\[0-9\]\+\)\$ \$host_port;[\s\S]*default \$server_port;[\s\S]*\}/,
  );

  const webSocketLocation = nginxConfig.match(
    /location \/ws \{(?<body>[\s\S]*?)\n    \}/,
  )?.groups?.body;

  assert.ok(webSocketLocation, "location /ws block is required");
  assert.match(
    webSocketLocation,
    /proxy_set_header Host \$http_host;/,
  );
  assert.match(
    webSocketLocation,
    /proxy_set_header X-Forwarded-Port \$external_port;/,
  );
});
