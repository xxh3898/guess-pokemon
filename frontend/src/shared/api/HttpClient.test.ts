import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, HttpClient } from "./HttpClient";

describe("HttpClient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should_sendSessionCookieAndCsrfHeader_when_postingJson", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          headerName: "X-XSRF-TOKEN",
          parameterName: "_csrf",
          token: "csrf-token",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new HttpClient(fetcher);

    await client.post("/api/v1/auth/login", {
      loginId: "trainer_red",
      password: "password",
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/auth/csrf");
    const request = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(request.credentials).toBe("same-origin");
    expect(request.body).toBe(
      '{"loginId":"trainer_red","password":"password"}',
    );
    expect(new Headers(request.headers).get("X-XSRF-TOKEN")).toBe(
      "csrf-token",
    );
  });

  it("should_reuseCsrfToken_when_sessionHasNotChanged", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          headerName: "X-XSRF-TOKEN",
          parameterName: "_csrf",
          token: "shared-token",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ first: true }))
      .mockResolvedValueOnce(jsonResponse({ second: true }));
    const client = new HttpClient(fetcher);

    await client.post("/api/v1/first", {});
    await client.post("/api/v1/second", {});

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[0]?.[0]).toBe("/api/v1/auth/csrf");
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/v1/first");
    expect(fetcher.mock.calls[2]?.[0]).toBe("/api/v1/second");
  });

  it("should_shareCsrfCredential_when_realtimeConnects", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      csrfResponse("realtime-token"),
    );
    const client = new HttpClient(fetcher);

    await expect(client.getCsrfCredential()).resolves.toEqual({
      headerName: "X-XSRF-TOKEN",
      token: "realtime-token",
    });
    await expect(client.getCsrfCredential()).resolves.toEqual({
      headerName: "X-XSRF-TOKEN",
      token: "realtime-token",
    });

    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("should_sendCsrfHeader_when_deletingResource", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse("leave-token"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new HttpClient(fetcher);

    await expect(
      client.delete("/api/v1/rooms/AB3K7M/members/me"),
    ).resolves.toBeUndefined();

    const request = fetcher.mock.calls[1]?.[1] as RequestInit;
    expect(request.method).toBe("DELETE");
    expect(new Headers(request.headers).get("X-XSRF-TOKEN")).toBe(
      "leave-token",
    );
  });

  it("should_refreshTokenOnce_when_csrfTokenIsRejected", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse("expired-token"))
      .mockResolvedValueOnce(
        problemResponse(403, "CSRF_INVALID", "CSRF 오류"),
      )
      .mockResolvedValueOnce(csrfResponse("refreshed-token"))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new HttpClient(fetcher);

    await expect(
      client.post("/api/v1/auth/login", {
        loginId: "trainer_red",
        password: "password",
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetcher).toHaveBeenCalledTimes(4);
    const retriedRequest = fetcher.mock.calls[3]?.[1] as RequestInit;
    expect(
      new Headers(retriedRequest.headers).get("X-XSRF-TOKEN"),
    ).toBe("refreshed-token");
  });

  it("should_mapProblemDetailAndRetryAfter_when_apiRejectsRequest", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      problemResponse(
        429,
        "LOGIN_RATE_LIMITED",
        "잠시 뒤 다시 시도해 주세요.",
        { "Retry-After": "600" },
      ),
    );
    const client = new HttpClient(fetcher);

    const request = client.get("/api/v1/auth/me");

    await expect(request).rejects.toMatchObject({
      code: "LOGIN_RATE_LIMITED",
      detail: "잠시 뒤 다시 시도해 주세요.",
      retryAfterSeconds: 600,
      status: 429,
      traceId: "trace123",
    });
  });

  it("should_notifySessionExpiration_when_authenticationIsRequired", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        problemResponse(
          401,
          "AUTHENTICATION_REQUIRED",
          "로그인이 필요합니다.",
        ),
      );
    const client = new HttpClient(fetcher);
    const listener = vi.fn();
    client.subscribeSessionExpired(listener);

    await expect(client.get("/api/v1/auth/me")).rejects.toBeInstanceOf(
      ApiError,
    );

    expect(listener).toHaveBeenCalledOnce();
  });

  it("should_returnUndefined_when_responseHasNoContent", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(csrfResponse("logout-token"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new HttpClient(fetcher);

    await expect(
      client.post("/api/v1/auth/logout"),
    ).resolves.toBeUndefined();
  });

  it("should_useSafeMessage_when_networkRequestFails", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError("failed"));
    const client = new HttpClient(fetcher);

    await expect(client.get("/api/v1/auth/me")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      detail:
        "서버에 연결하지 못했습니다. " +
        "네트워크 상태를 확인한 뒤 다시 시도해 주세요.",
      status: 0,
    });
  });
});

function csrfResponse(token: string): Response {
  return jsonResponse({
    headerName: "X-XSRF-TOKEN",
    parameterName: "_csrf",
    token,
  });
}

function jsonResponse(
  body: unknown,
  init: ResponseInit = { status: 200 },
): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
  });
}

function problemResponse(
  status: number,
  code: string,
  detail: string,
  headers?: HeadersInit,
): Response {
  return jsonResponse(
    {
      code,
      detail,
      status,
      title: "요청 실패",
      traceId: "trace123",
      type: "about:blank",
    },
    { headers, status },
  );
}
