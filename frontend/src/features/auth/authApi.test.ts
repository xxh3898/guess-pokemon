import { describe, expect, it, vi } from "vitest";

import { ApiError, HttpClient } from "../../shared/api/HttpClient";
import { createAuthGateway } from "./authApi";

describe("authApi", () => {
  it("should_parseCurrentUser_when_responseMatchesContract", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        activeRoomCode: "AB3K7M",
        user: {
          id: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
          loginId: "trainer_red",
          nickname: "레드",
        },
      }),
    );
    const gateway = createAuthGateway(new HttpClient(fetcher));

    await expect(gateway.currentUser()).resolves.toEqual({
      activeRoomCode: "AB3K7M",
      user: {
        id: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
        loginId: "trainer_red",
        nickname: "레드",
      },
    });
  });

  it("should_rejectResponse_when_userShapeIsInvalid", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        activeRoomCode: null,
        user: {
          id: "user-id",
          nickname: "레드",
        },
      }),
    );
    const gateway = createAuthGateway(new HttpClient(fetcher));

    await expect(gateway.currentUser()).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("should_callLogoutEndpoint_when_logoutIsRequested", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          headerName: "X-XSRF-TOKEN",
          parameterName: "_csrf",
          token: "logout-token",
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const gateway = createAuthGateway(new HttpClient(fetcher));

    await gateway.logout();

    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/v1/auth/logout");
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe("POST");
  });

  it("should_clearCsrfCache_when_loginRotatesSession", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          headerName: "X-XSRF-TOKEN",
          parameterName: "_csrf",
          token: "login-token",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          user: TEST_USER,
        }),
      );
    const client = new HttpClient(fetcher);
    const clearSessionSecurity = vi.spyOn(
      client,
      "clearSessionSecurity",
    );
    const gateway = createAuthGateway(client);

    await gateway.login({
      loginId: "trainer_red",
      password: "valid-password-123",
    });

    expect(clearSessionSecurity).toHaveBeenCalledOnce();
  });

  it("should_surfaceInvalidResponseAsApiError_when_payloadIsEmpty", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const gateway = createAuthGateway(new HttpClient(fetcher));

    await expect(gateway.currentUser()).rejects.toBeInstanceOf(ApiError);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    status: 200,
  });
}

const TEST_USER = {
  id: "624f7d62-e328-4ff0-8b90-f6520b81a47f",
  loginId: "trainer_red",
  nickname: "레드",
};
