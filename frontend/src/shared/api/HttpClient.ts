export type ApiPath = `/api/${string}`;

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type SessionExpiredListener = () => void;

export interface CsrfCredential {
  readonly headerName: string;
  readonly token: string;
}

interface RequestOptions {
  body?: unknown;
  method: "DELETE" | "GET" | "POST";
  signal?: AbortSignal;
}

interface ApiErrorOptions {
  code: string;
  detail: string;
  retryAfterSeconds?: number;
  status: number;
  title: string;
  traceId?: string;
}

const NETWORK_ERROR_DETAIL =
  "서버에 연결하지 못했습니다. " +
  "네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
const INVALID_RESPONSE_DETAIL =
  "서버 응답을 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.";

export class ApiError extends Error {
  readonly code: string;
  readonly detail: string;
  readonly retryAfterSeconds: number | null;
  readonly status: number;
  readonly title: string;
  readonly traceId: string | null;

  constructor(options: ApiErrorOptions) {
    super(options.detail);
    this.name = "ApiError";
    this.code = options.code;
    this.detail = options.detail;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.status = options.status;
    this.title = options.title;
    this.traceId = options.traceId ?? null;
  }

  static invalidResponse(): ApiError {
    return new ApiError({
      code: "INVALID_RESPONSE",
      detail: INVALID_RESPONSE_DETAIL,
      status: 0,
      title: "응답 확인 실패",
    });
  }
}

export class HttpClient {
  private readonly fetcher: Fetcher;
  private readonly sessionExpiredListeners = new Set<SessionExpiredListener>();
  private csrfHeader: CsrfCredential | null = null;
  private csrfRequest: Promise<CsrfCredential> | null = null;

  constructor(fetcher?: Fetcher) {
    this.fetcher =
      fetcher ?? ((input, init) => globalThis.fetch(input, init));
  }

  get(path: ApiPath, signal?: AbortSignal): Promise<unknown> {
    return this.request(path, { method: "GET", signal }, true);
  }

  delete(path: ApiPath, signal?: AbortSignal): Promise<unknown> {
    return this.request(path, { method: "DELETE", signal }, true);
  }

  post(
    path: ApiPath,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.request(path, { body, method: "POST", signal }, true);
  }

  getCsrfCredential(
    signal?: AbortSignal,
  ): Promise<CsrfCredential> {
    return this.getCsrfHeader(signal);
  }

  clearSessionSecurity(): void {
    this.csrfHeader = null;
    this.csrfRequest = null;
  }

  subscribeSessionExpired(listener: SessionExpiredListener): () => void {
    this.sessionExpiredListeners.add(listener);
    return () => {
      this.sessionExpiredListeners.delete(listener);
    };
  }

  private async request(
    path: ApiPath,
    options: RequestOptions,
    canRetryCsrf: boolean,
  ): Promise<unknown> {
    try {
      const headers = new Headers({
        Accept: "application/json",
      });

      if (options.body !== undefined) {
        headers.set("Content-Type", "application/json");
      }

      if (options.method !== "GET") {
        const csrfHeader = await this.getCsrfHeader(options.signal);
        headers.set(csrfHeader.headerName, csrfHeader.token);
      }

      const response = await this.fetcher(path, {
        body:
          options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
        cache: "no-store",
        credentials: "same-origin",
        headers,
        method: options.method,
        signal: options.signal,
      });
      const payload = await parseResponsePayload(response);

      if (!response.ok) {
        throw createApiError(response, payload);
      }

      return payload;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const apiError = toApiError(error);
      if (apiError.code === "CSRF_INVALID" && canRetryCsrf) {
        this.clearSessionSecurity();
        return this.request(path, options, false);
      }

      if (apiError.code === "AUTHENTICATION_REQUIRED") {
        this.clearSessionSecurity();
        for (const listener of this.sessionExpiredListeners) {
          listener();
        }
      }
      throw apiError;
    }
  }

  private async getCsrfHeader(
    signal?: AbortSignal,
  ): Promise<CsrfCredential> {
    if (this.csrfHeader) {
      return this.csrfHeader;
    }
    if (this.csrfRequest) {
      return this.csrfRequest;
    }

    this.csrfRequest = this.fetchCsrfHeader(signal);
    try {
      this.csrfHeader = await this.csrfRequest;
      return this.csrfHeader;
    } finally {
      this.csrfRequest = null;
    }
  }

  private async fetchCsrfHeader(
    signal?: AbortSignal,
  ): Promise<CsrfCredential> {
    let response: Response;
    try {
      response = await this.fetcher("/api/v1/auth/csrf", {
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
        },
        method: "GET",
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      throw toApiError(error);
    }

    const payload = await parseResponsePayload(response);
    if (!response.ok) {
      throw createApiError(response, payload);
    }
    if (!isRecord(payload)) {
      throw ApiError.invalidResponse();
    }

    const headerName = readString(payload, "headerName");
    const token = readString(payload, "token");
    if (!headerName || !token) {
      throw ApiError.invalidResponse();
    }
    return { headerName, token };
  }
}

export const httpClient = new HttpClient();

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }
  return new ApiError({
    code: "NETWORK_ERROR",
    detail: NETWORK_ERROR_DETAIL,
    status: 0,
    title: "연결 실패",
  });
}

async function parseResponsePayload(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const body = await response.text();
  if (body.length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function createApiError(response: Response, payload: unknown): ApiError {
  const problem = isRecord(payload) ? payload : {};
  const retryAfterSeconds = parseRetryAfter(
    response.headers.get("Retry-After"),
  );

  return new ApiError({
    code: readString(problem, "code") ?? `HTTP_${response.status}`,
    detail: readString(problem, "detail") ?? INVALID_RESPONSE_DETAIL,
    retryAfterSeconds:
      retryAfterSeconds === null ? undefined : retryAfterSeconds,
    status: response.status,
    title: readString(problem, "title") ?? "요청 처리 실패",
    traceId: readString(problem, "traceId") ?? undefined,
  });
}

function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) {
    return null;
  }
  return Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.length > 0
    ? candidate
    : null;
}
