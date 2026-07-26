import { describe, expect, it, vi } from "vitest";

import {
  createWebSocketUrl,
  type RealtimeStompClient,
  type RealtimeStompClientFactory,
  type RealtimeStompConfiguration,
  StompRoomRealtimeGateway,
} from "./RoomRealtimeGateway";

describe("StompRoomRealtimeGateway", () => {
  it("should_buildSecureWebSocketUrl_when_pageUsesHttps", () => {
    expect(
      createWebSocketUrl({
        host: "guess.example.com",
        protocol: "https:",
      }),
    ).toBe("wss://guess.example.com/ws");
  });

  it("should_connectSubscribeAndResume_when_roomSessionOpens", async () => {
    const fake = new FakeStompClient();
    const factory = createFactory(fake);
    const onStatusChange = vi.fn();
    const gateway = new StompRoomRealtimeGateway(
      vi.fn().mockResolvedValue({
        headerName: "X-XSRF-TOKEN",
        token: "csrf-token",
      }),
      factory,
      () => "98835cf8-c6f2-4576-a900-b26519ddbbed",
      () => ({ host: "localhost:5173", protocol: "http:" }),
    );

    gateway.open("AB3K7M", {
      onEvent: vi.fn(),
      onRealtimeError: vi.fn(),
      onStatusChange,
      onTransportError: vi.fn(),
    });
    await flushPromises();
    await fake.beforeConnect();
    fake.connect();

    expect(fake.activate).toHaveBeenCalledOnce();
    expect(fake.connectHeaders).toEqual({
      "X-XSRF-TOKEN": "csrf-token",
    });
    expect(fake.destinations()).toEqual([
      "/user/queue/game-events",
      "/user/queue/errors",
    ]);
    expect(fake.publish).toHaveBeenCalledWith({
      body: JSON.stringify({
        commandId: "98835cf8-c6f2-4576-a900-b26519ddbbed",
        expectedStateVersion: 0,
        payload: {},
      }),
      destination: "/app/rooms/AB3K7M/resume",
      headers: {
        "content-type": "application/json",
      },
    });
    expect(onStatusChange).toHaveBeenLastCalledWith("connected");
    expect(factory).toHaveBeenCalledWith(
      expect.objectContaining({
        brokerURL: "ws://localhost:5173/ws",
        heartbeatIncoming: 10_000,
        heartbeatOutgoing: 10_000,
        maxReconnectDelay: 10_000,
        reconnectDelay: 1_000,
      }),
    );
  });

  it("should_forwardParsedEvent_when_gameQueueReceivesMessage", async () => {
    const fake = new FakeStompClient();
    const onEvent = vi.fn();
    const gateway = createGateway(fake);

    gateway.open("AB3K7M", {
      onEvent,
      onRealtimeError: vi.fn(),
      onStatusChange: vi.fn(),
      onTransportError: vi.fn(),
    });
    await flushPromises();
    fake.connect();
    fake.message(
      "/user/queue/game-events",
      JSON.stringify({
        eventId: "2069dc9a-624f-48f9-8b2c-65e912006224",
        eventType: "PLAYER_JOINED",
        gameId: null,
        occurredAt: "2026-07-25T03:00:00Z",
        payload: {
          player: {
            nickname: "그린",
            userId: "70226fe2-cdee-4261-a3cb-fbd87a4df783",
          },
        },
        roomCode: "AB3K7M",
        stateVersion: 2,
      }),
    );

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "PLAYER_JOINED",
        stateVersion: 2,
      }),
    );
  });

  it("should_publishAllGameCommands_when_sessionIsConnected", async () => {
    const fake = new FakeStompClient();
    const session = createGateway(fake).open("AB3K7M", {
      onEvent: vi.fn(),
      onRealtimeError: vi.fn(),
      onStatusChange: vi.fn(),
      onTransportError: vi.fn(),
    });
    await flushPromises();
    fake.connect();
    fake.publish.mockClear();

    session.selectPokemon(25, 2);
    session.askQuestion("  날개가 있나요?  ", 3);
    session.answerQuestion(
      "NO",
      "  날개처럼 보이지만 팔이에요.  ",
      4,
    );
    session.guessPokemon(6, 5);
    session.changeRolePreference("SELECTOR", 6);
    session.requestSnapshot();

    expect(fake.publish.mock.calls).toEqual([
      [
        command(
          "/app/rooms/AB3K7M/select-pokemon",
          2,
          { nationalDexId: 25 },
        ),
      ],
      [
        command("/app/rooms/AB3K7M/ask", 3, {
          question: "날개가 있나요?",
        }),
      ],
      [
        command("/app/rooms/AB3K7M/answer", 4, {
          answer: "NO",
          comment: "날개처럼 보이지만 팔이에요.",
        }),
      ],
      [
        command("/app/rooms/AB3K7M/guess", 5, {
          nationalDexId: 6,
        }),
      ],
      [
        command("/app/rooms/AB3K7M/role-preference", 6, {
          preferredRole: "SELECTOR",
        }),
      ],
      [command("/app/rooms/AB3K7M/resume", 0, {})],
    ]);
  });

  it("should_publishNullComment_when_answerCommentIsBlank", async () => {
    const fake = new FakeStompClient();
    const session = createGateway(fake).open("AB3K7M", {
      onEvent: vi.fn(),
      onRealtimeError: vi.fn(),
      onStatusChange: vi.fn(),
      onTransportError: vi.fn(),
    });
    await flushPromises();
    fake.connect();
    fake.publish.mockClear();

    session.answerQuestion("YES", " \n ", 4);

    expect(fake.publish).toHaveBeenCalledWith(
      command("/app/rooms/AB3K7M/answer", 4, {
        answer: "YES",
        comment: null,
      }),
    );
  });

  it("should_rejectAnswerComment_when_commentExceedsMaximumLength", async () => {
    const fake = new FakeStompClient();
    const session = createGateway(fake).open("AB3K7M", {
      onEvent: vi.fn(),
      onRealtimeError: vi.fn(),
      onStatusChange: vi.fn(),
      onTransportError: vi.fn(),
    });
    await flushPromises();
    fake.connect();
    fake.publish.mockClear();

    expect(() =>
      session.answerQuestion("UNKNOWN", "🙂".repeat(201), 4),
    ).toThrow("게임 요청 내용을 다시 확인해 주세요.");
    expect(fake.publish).not.toHaveBeenCalled();
  });

  it("should_rejectCommand_when_sessionIsNotConnected", async () => {
    const fake = new FakeStompClient();
    const session = createGateway(fake).open("AB3K7M", {
      onEvent: vi.fn(),
      onRealtimeError: vi.fn(),
      onStatusChange: vi.fn(),
      onTransportError: vi.fn(),
    });
    await flushPromises();

    expect(() => session.askQuestion("질문", 1)).toThrow(
      "실시간 연결을 확인하고 있어요. 연결된 뒤 다시 시도해 주세요.",
    );
    expect(fake.publish).not.toHaveBeenCalled();
  });

  it("should_unsubscribeAndDeactivate_when_sessionCloses", async () => {
    const fake = new FakeStompClient();
    const session = createGateway(fake).open("AB3K7M", {
      onEvent: vi.fn(),
      onRealtimeError: vi.fn(),
      onStatusChange: vi.fn(),
      onTransportError: vi.fn(),
    });
    await flushPromises();
    fake.connect();

    await session.close();

    expect(fake.unsubscribe).toHaveBeenCalledTimes(2);
    expect(fake.deactivate).toHaveBeenCalledOnce();
  });

  it("should_ignoreCredentialAbort_when_sessionClosesDuringConnect", async () => {
    const fake = new FakeStompClient();
    const onTransportError = vi.fn();
    const gateway = new StompRoomRealtimeGateway(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener(
            "abort",
            () => {
              reject(
                new DOMException(
                  "signal is aborted without reason",
                  "AbortError",
                ),
              );
            },
            { once: true },
          );
        }),
      createFactory(fake),
    );
    const session = gateway.open("AB3K7M", {
      onEvent: vi.fn(),
      onRealtimeError: vi.fn(),
      onStatusChange: vi.fn(),
      onTransportError,
    });
    await flushPromises();
    const connecting = fake.beforeConnect();

    await session.close();

    await expect(connecting).resolves.toBeUndefined();
    expect(onTransportError).not.toHaveBeenCalled();
  });

  it("should_replacePreviousSession_when_newRoomSessionOpens", async () => {
    const first = new FakeStompClient();
    const second = new FakeStompClient();
    const factory = vi
      .fn<RealtimeStompClientFactory>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const gateway = new StompRoomRealtimeGateway(
      vi.fn().mockResolvedValue({
        headerName: "X-XSRF-TOKEN",
        token: "csrf-token",
      }),
      factory,
      () => "98835cf8-c6f2-4576-a900-b26519ddbbed",
      () => ({ host: "localhost:5173", protocol: "http:" }),
    );
    const handlers = {
      onEvent: vi.fn(),
      onRealtimeError: vi.fn(),
      onStatusChange: vi.fn(),
      onTransportError: vi.fn(),
    };

    gateway.open("AB3K7M", handlers);
    await flushPromises();
    gateway.open("CD4M8N", handlers);
    await flushPromises();

    expect(first.deactivate).toHaveBeenCalledOnce();
    expect(second.activate).toHaveBeenCalledOnce();
  });

  it("should_waitForPreviousDeactivation_when_strictModeReopensSession", async () => {
    const first = new FakeStompClient();
    let finishDeactivation: (() => void) | undefined;
    first.deactivate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDeactivation = resolve;
        }),
    );
    const second = new FakeStompClient();
    const factory = vi
      .fn<RealtimeStompClientFactory>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const gateway = new StompRoomRealtimeGateway(
      vi.fn().mockResolvedValue({
        headerName: "X-XSRF-TOKEN",
        token: "csrf-token",
      }),
      factory,
      () => "98835cf8-c6f2-4576-a900-b26519ddbbed",
      () => ({ host: "localhost:5173", protocol: "http:" }),
    );
    const handlers = {
      onEvent: vi.fn(),
      onRealtimeError: vi.fn(),
      onStatusChange: vi.fn(),
      onTransportError: vi.fn(),
    };

    const firstSession = gateway.open("AB3K7M", handlers);
    await flushPromises();
    const closing = firstSession.close();
    gateway.open("AB3K7M", handlers);
    await flushPromises();

    expect(second.activate).not.toHaveBeenCalled();

    finishDeactivation?.();
    await closing;
    await flushPromises();

    expect(second.activate).toHaveBeenCalledOnce();
  });
});

function createGateway(fake: FakeStompClient) {
  return new StompRoomRealtimeGateway(
    vi.fn().mockResolvedValue({
      headerName: "X-XSRF-TOKEN",
      token: "csrf-token",
    }),
    createFactory(fake),
    () => "98835cf8-c6f2-4576-a900-b26519ddbbed",
    () => ({ host: "localhost:5173", protocol: "http:" }),
  );
}

function createFactory(
  fake: FakeStompClient,
): ReturnType<typeof vi.fn<RealtimeStompClientFactory>> {
  return vi.fn<RealtimeStompClientFactory>((configuration) => {
    fake.configuration = configuration;
    return fake;
  });
}

class FakeStompClient implements RealtimeStompClient {
  readonly activate = vi.fn();
  readonly deactivate = vi.fn().mockResolvedValue(undefined);
  readonly publish = vi.fn();
  readonly unsubscribe = vi.fn();
  connectHeaders: Record<string, string> = {};
  configuration?: RealtimeStompConfiguration;
  private readonly subscriptions = new Map<
    string,
    (message: { body: string }) => void
  >();

  subscribe(
    destination: string,
    callback: (message: { body: string }) => void,
  ) {
    this.subscriptions.set(destination, callback);
    return {
      unsubscribe: this.unsubscribe,
    };
  }

  beforeConnect(): Promise<void> {
    if (!this.configuration) {
      throw new Error("configuration missing");
    }
    return this.configuration.beforeConnect(this);
  }

  connect(): void {
    this.configuration?.onConnect();
  }

  destinations(): string[] {
    return [...this.subscriptions.keys()];
  }

  message(destination: string, body: string): void {
    this.subscriptions.get(destination)?.({ body });
  }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function command(
  destination: string,
  expectedStateVersion: number,
  payload: Record<string, unknown>,
) {
  return {
    body: JSON.stringify({
      commandId: "98835cf8-c6f2-4576-a900-b26519ddbbed",
      expectedStateVersion,
      payload,
    }),
    destination,
    headers: {
      "content-type": "application/json",
    },
  };
}
