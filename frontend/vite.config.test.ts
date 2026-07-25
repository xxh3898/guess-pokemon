import {
  describe,
  expect,
  it,
} from "vitest";
import type {
  ProxyOptions,
  UserConfig,
} from "vite";

import viteConfig from "./vite.config.ts";

describe("Vite development proxy", () => {
  it("should_preserveBrowserHost_when_proxyingWebSocket", () => {
    const apiProxy = requireProxyOptions("/api");
    const webSocketProxy = requireProxyOptions("/ws");

    expect(apiProxy.changeOrigin).toBe(true);
    expect(webSocketProxy.changeOrigin).toBe(false);
    expect(webSocketProxy.ws).toBe(true);
    expect(webSocketProxy.rewriteWsOrigin).not.toBe(true);
  });
});

function requireProxyOptions(path: "/api" | "/ws"): ProxyOptions {
  const config = viteConfig as UserConfig;
  const options = config.server?.proxy?.[path];
  if (!options || typeof options === "string") {
    throw new Error(`${path} proxy options are required`);
  }
  return options;
}
