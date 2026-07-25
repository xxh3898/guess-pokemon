import {
  Client,
  ReconnectionTimeMode,
  type StompConfig,
} from "@stomp/stompjs";

import {
  ApiError,
  type CsrfCredential,
  HttpClient,
  httpClient,
} from "../api/HttpClient";
import {
  isValidRoomCode,
  normalizeRoomCode,
} from "../../features/room/roomCode";
import {
  parseRealtimeError,
  parseRoomRealtimeEvent,
  type RealtimeErrorMessage,
  type RoomRealtimeEvent,
} from "./realtimeTypes";
import type { GameAnswer } from "../../features/room/roomTypes";

const GAME_EVENTS_DESTINATION = "/user/queue/game-events";
const ERRORS_DESTINATION = "/user/queue/errors";
const HEARTBEAT_MILLISECONDS = 10_000;
const INITIAL_RECONNECT_DELAY_MILLISECONDS = 1_000;
const MAX_RECONNECT_DELAY_MILLISECONDS = 10_000;

export type RealtimeConnectionStatus =
  | "connected"
  | "connecting"
  | "reconnecting";

export interface RoomRealtimeHandlers {
  onEvent(event: RoomRealtimeEvent): void;
  onRealtimeError(error: RealtimeErrorMessage): void;
  onStatusChange(status: RealtimeConnectionStatus): void;
  onTransportError(detail: string): void;
}

export interface RoomRealtimeSession {
  answerQuestion(
    answer: GameAnswer,
    expectedStateVersion: number,
  ): string;
  askQuestion(
    question: string,
    expectedStateVersion: number,
  ): string;
  changeRematchReady(
    ready: boolean,
    expectedStateVersion: number,
  ): string;
  close(): Promise<void>;
  guessPokemon(
    nationalDexId: number,
    expectedStateVersion: number,
  ): string;
  requestSnapshot(): string;
  selectPokemon(
    nationalDexId: number,
    expectedStateVersion: number,
  ): string;
}

export interface RoomRealtimeGateway {
  open(
    roomCode: string,
    handlers: RoomRealtimeHandlers,
  ): RoomRealtimeSession;
}

interface RealtimeMessage {
  readonly body: string;
}

interface RealtimeSubscription {
  unsubscribe(): void;
}

export interface RealtimeStompClient {
  connectHeaders: Record<string, string>;
  activate(): void;
  deactivate(): Promise<void>;
  publish(params: {
    body: string;
    destination: string;
    headers?: Record<string, string>;
  }): void;
  subscribe(
    destination: string,
    callback: (message: RealtimeMessage) => void,
  ): RealtimeSubscription;
}

export interface RealtimeStompConfiguration {
  beforeConnect(client: RealtimeStompClient): Promise<void>;
  brokerURL: string;
  heartbeatIncoming: number;
  heartbeatOutgoing: number;
  maxReconnectDelay: number;
  onConnect(): void;
  onStompError(): void;
  onWebSocketClose(): void;
  onWebSocketError(): void;
  reconnectDelay: number;
  reconnectTimeMode: ReconnectionTimeMode;
}

export type RealtimeStompClientFactory = (
  configuration: RealtimeStompConfiguration,
) => RealtimeStompClient;

type CsrfCredentialProvider = (
  signal?: AbortSignal,
) => Promise<CsrfCredential>;

type UuidFactory = () => string;

export class StompRoomRealtimeGateway
  implements RoomRealtimeGateway
{
  private currentSession: InternalRealtimeSession | null = null;
  private readonly clientFactory: RealtimeStompClientFactory;
  private readonly csrfCredentialProvider: CsrfCredentialProvider;
  private readonly locationProvider: () => Pick<
    Location,
    "host" | "protocol"
  >;
  private readonly uuidFactory: UuidFactory;

  constructor(
    csrfCredentialProvider: CsrfCredentialProvider,
    clientFactory: RealtimeStompClientFactory =
      createStompClient,
    uuidFactory: UuidFactory = () =>
      globalThis.crypto.randomUUID(),
    locationProvider: () => Pick<
      Location,
      "host" | "protocol"
    > = () => globalThis.location,
  ) {
    this.csrfCredentialProvider = csrfCredentialProvider;
    this.clientFactory = clientFactory;
    this.uuidFactory = uuidFactory;
    this.locationProvider = locationProvider;
  }

  open(
    roomCode: string,
    handlers: RoomRealtimeHandlers,
  ): RoomRealtimeSession {
    const normalizedCode = normalizeRoomCode(roomCode);
    if (!isValidRoomCode(normalizedCode)) {
      throw new ApiError({
        code: "VALIDATION_FAILED",
        detail: "방 코드 6자리를 다시 확인해 주세요.",
        status: 400,
        title: "방 코드 확인",
      });
    }

    const previousSession = this.currentSession;
    let closed = false;
    let closePromise: Promise<void> | null = null;
    let connected = false;
    let connectedOnce = false;
    let subscriptions: RealtimeSubscription[] = [];
    const abortController = new AbortController();

    const notifyStatus = (status: RealtimeConnectionStatus) => {
      if (!closed) {
        handlers.onStatusChange(status);
      }
    };
    const notifyTransportError = (detail: string) => {
      if (!closed) {
        handlers.onTransportError(detail);
      }
    };
    const clearSubscriptions = () => {
      for (const subscription of subscriptions) {
        try {
          subscription.unsubscribe();
        } catch {
          // 이미 닫힌 socket의 subscription은 server에서 정리한다.
        }
      }
      subscriptions = [];
    };

    const client = this.clientFactory({
      beforeConnect: async (stompClient) => {
        notifyStatus(connectedOnce ? "reconnecting" : "connecting");
        try {
          const credential = await this.csrfCredentialProvider(
            abortController.signal,
          );
          stompClient.connectHeaders = {
            [credential.headerName]: credential.token,
          };
        } catch (error) {
          if (closed && abortController.signal.aborted) {
            return;
          }
          notifyTransportError(safeConnectionDetail(error));
          throw error;
        }
      },
      brokerURL: createWebSocketUrl(this.locationProvider()),
      heartbeatIncoming: HEARTBEAT_MILLISECONDS,
      heartbeatOutgoing: HEARTBEAT_MILLISECONDS,
      maxReconnectDelay: MAX_RECONNECT_DELAY_MILLISECONDS,
      onConnect: () => {
        if (closed) {
          return;
        }
        clearSubscriptions();
        try {
          subscriptions = [
            client.subscribe(GAME_EVENTS_DESTINATION, (message) => {
              try {
                handlers.onEvent(
                  parseRoomRealtimeEvent(message.body),
                );
              } catch {
                notifyTransportError(
                  "실시간 방 정보를 확인하지 못했습니다. 다시 연결해 주세요.",
                );
              }
            }),
            client.subscribe(ERRORS_DESTINATION, (message) => {
              try {
                handlers.onRealtimeError(
                  parseRealtimeError(message.body),
                );
              } catch {
                notifyTransportError(
                  "실시간 오류 응답을 확인하지 못했습니다. 다시 연결해 주세요.",
                );
              }
            }),
          ];
          connected = true;
          publishCommand("resume", 0, {});
          connectedOnce = true;
          notifyStatus("connected");
        } catch {
          notifyTransportError(
            "실시간 방 연결을 준비하지 못했습니다. 다시 시도해 주세요.",
          );
        }
      },
      onStompError: () => {
        connected = false;
        notifyTransportError(
          "실시간 방 연결이 거부되었습니다. 로그인 상태를 확인해 주세요.",
        );
      },
      onWebSocketClose: () => {
        connected = false;
        subscriptions = [];
        notifyStatus("reconnecting");
      },
      onWebSocketError: () => {
        connected = false;
        notifyTransportError(
          "실시간 서버에 연결하지 못했습니다. 네트워크 상태를 확인해 주세요.",
        );
      },
      reconnectDelay: INITIAL_RECONNECT_DELAY_MILLISECONDS,
      reconnectTimeMode: ReconnectionTimeMode.EXPONENTIAL,
    });

    const publishCommand = (
      action:
        | "answer"
        | "ask"
        | "guess"
        | "rematch-ready"
        | "resume"
        | "select-pokemon",
      expectedStateVersion: number,
      payload: Record<string, unknown>,
    ): string => {
      if (closed || !connected) {
        throw realtimeUnavailableError();
      }
      requireStateVersion(expectedStateVersion);
      const commandId = this.uuidFactory();
      client.publish({
        body: JSON.stringify({
          commandId,
          expectedStateVersion,
          payload,
        }),
        destination: `/app/rooms/${normalizedCode}/${action}`,
        headers: {
          "content-type": "application/json",
        },
      });
      return commandId;
    };

    let session: InternalRealtimeSession;
    session = {
      answerQuestion: (answer, expectedStateVersion) => {
        if (
          answer !== "YES" &&
          answer !== "NO" &&
          answer !== "UNKNOWN"
        ) {
          throw commandValidationError();
        }
        return publishCommand("answer", expectedStateVersion, {
          answer,
        });
      },
      askQuestion: (question, expectedStateVersion) => {
        const normalizedQuestion = question.trim().normalize("NFC");
        if (
          normalizedQuestion.length === 0 ||
          normalizedQuestion.length > 200
        ) {
          throw commandValidationError();
        }
        return publishCommand("ask", expectedStateVersion, {
          question: normalizedQuestion,
        });
      },
      changeRematchReady: (ready, expectedStateVersion) => {
        return publishCommand(
          "rematch-ready",
          expectedStateVersion,
          { ready },
        );
      },
      close: () => {
        if (closePromise) {
          return closePromise;
        }
        closed = true;
        connected = false;
        abortController.abort();
        clearSubscriptions();
        closePromise = (async () => {
          try {
            await client.deactivate();
          } catch {
            // 닫는 중인 연결은 재시도하지 않는다.
          } finally {
            if (this.currentSession === session) {
              this.currentSession = null;
            }
          }
        })();
        return closePromise;
      },
      guessPokemon: (nationalDexId, expectedStateVersion) => {
        requireNationalDexId(nationalDexId);
        return publishCommand("guess", expectedStateVersion, {
          nationalDexId,
        });
      },
      requestSnapshot: () => publishCommand("resume", 0, {}),
      selectPokemon: (
        nationalDexId,
        expectedStateVersion,
      ) => {
        requireNationalDexId(nationalDexId);
        return publishCommand(
          "select-pokemon",
          expectedStateVersion,
          { nationalDexId },
        );
      },
    };
    this.currentSession = session;

    void (async () => {
      if (previousSession) {
        await previousSession.close();
      }
      if (!closed) {
        notifyStatus("connecting");
        client.activate();
      }
    })().catch(() => {
      notifyTransportError(
        "이전 실시간 연결을 정리하지 못했습니다. 다시 시도해 주세요.",
      );
    });

    return session;
  }
}

interface InternalRealtimeSession extends RoomRealtimeSession {}

export function createWebSocketUrl(
  location: Pick<Location, "host" | "protocol">,
): string {
  const protocol =
    location.protocol === "https:"
      ? "wss:"
      : location.protocol === "http:"
        ? "ws:"
        : null;
  if (!protocol || location.host.length === 0) {
    throw new ApiError({
      code: "REALTIME_URL_UNAVAILABLE",
      detail: "실시간 연결 주소를 확인하지 못했습니다.",
      status: 0,
      title: "실시간 연결 실패",
    });
  }
  return `${protocol}//${location.host}/ws`;
}

function createStompClient(
  configuration: RealtimeStompConfiguration,
): RealtimeStompClient {
  let adapter: RealtimeStompClient;
  const stompConfiguration: StompConfig = {
    beforeConnect: () => configuration.beforeConnect(adapter),
    brokerURL: configuration.brokerURL,
    debug: () => undefined,
    heartbeatIncoming: configuration.heartbeatIncoming,
    heartbeatOutgoing: configuration.heartbeatOutgoing,
    maxReconnectDelay: configuration.maxReconnectDelay,
    onConnect: configuration.onConnect,
    onStompError: configuration.onStompError,
    onWebSocketClose: configuration.onWebSocketClose,
    onWebSocketError: configuration.onWebSocketError,
    reconnectDelay: configuration.reconnectDelay,
    reconnectTimeMode: configuration.reconnectTimeMode,
  };
  const client = new Client(stompConfiguration);
  adapter = {
    activate: () => {
      client.activate();
    },
    get connectHeaders() {
      return client.connectHeaders;
    },
    set connectHeaders(headers: Record<string, string>) {
      client.connectHeaders = headers;
    },
    deactivate: () => client.deactivate(),
    publish: (params) => {
      client.publish(params);
    },
    subscribe: (destination, callback) => {
      const subscription = client.subscribe(
        destination,
        (message) => {
          callback({ body: message.body });
        },
      );
      return {
        unsubscribe: () => {
          subscription.unsubscribe();
        },
      };
    },
  };
  return adapter;
}

function safeConnectionDetail(error: unknown): string {
  return error instanceof ApiError
    ? error.detail
    : "실시간 연결을 준비하지 못했습니다. 다시 시도해 주세요.";
}

function requireStateVersion(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw commandValidationError();
  }
}

function requireNationalDexId(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 1_025) {
    throw commandValidationError();
  }
}

function commandValidationError(): ApiError {
  return new ApiError({
    code: "VALIDATION_FAILED",
    detail: "게임 요청 내용을 다시 확인해 주세요.",
    status: 400,
    title: "게임 요청 확인",
  });
}

function realtimeUnavailableError(): ApiError {
  return new ApiError({
    code: "REALTIME_NOT_CONNECTED",
    detail:
      "실시간 연결을 확인하고 있어요. 연결된 뒤 다시 시도해 주세요.",
    status: 0,
    title: "실시간 연결 확인",
  });
}

export function createRoomRealtimeGateway(
  client: HttpClient,
): RoomRealtimeGateway {
  return new StompRoomRealtimeGateway((signal) =>
    client.getCsrfCredential(signal),
  );
}

export const roomRealtimeGateway =
  createRoomRealtimeGateway(httpClient);
