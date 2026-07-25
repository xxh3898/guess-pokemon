import {
  ApiError,
  HttpClient,
  httpClient,
} from "../../shared/api/HttpClient";

export interface UserSummary {
  id: string;
  loginId: string;
  nickname: string;
}

export interface CurrentUser {
  activeRoomCode: string | null;
  user: UserSummary;
}

export interface SignupRequest {
  loginId: string;
  nickname: string;
  password: string;
}

export interface LoginRequest {
  loginId: string;
  password: string;
}

export interface AuthGateway {
  clearSessionSecurity(): void;
  currentUser(signal?: AbortSignal): Promise<CurrentUser>;
  login(request: LoginRequest): Promise<UserSummary>;
  logout(): Promise<void>;
  signup(request: SignupRequest): Promise<UserSummary>;
  subscribeSessionExpired(listener: () => void): () => void;
}

export function createAuthGateway(client: HttpClient): AuthGateway {
  return {
    clearSessionSecurity() {
      client.clearSessionSecurity();
    },
    async currentUser(signal) {
      const payload = await client.get("/api/v1/auth/me", signal);
      return parseCurrentUser(payload);
    },
    async login(request) {
      const payload = await client.post("/api/v1/auth/login", request);
      const user = parseAuthResponse(payload);
      client.clearSessionSecurity();
      return user;
    },
    async logout() {
      await client.post("/api/v1/auth/logout");
    },
    async signup(request) {
      const payload = await client.post("/api/v1/auth/signup", request);
      return parseAuthResponse(payload);
    },
    subscribeSessionExpired(listener) {
      return client.subscribeSessionExpired(listener);
    },
  };
}

export const authGateway = createAuthGateway(httpClient);

function parseAuthResponse(payload: unknown): UserSummary {
  const response = requireRecord(payload);
  return parseUserSummary(response.user);
}

function parseCurrentUser(payload: unknown): CurrentUser {
  const response = requireRecord(payload);
  const activeRoomCode = response.activeRoomCode;
  if (
    activeRoomCode !== null &&
    typeof activeRoomCode !== "string"
  ) {
    throw ApiError.invalidResponse();
  }
  return {
    activeRoomCode,
    user: parseUserSummary(response.user),
  };
}

function parseUserSummary(payload: unknown): UserSummary {
  const user = requireRecord(payload);
  return {
    id: requireString(user, "id"),
    loginId: requireString(user, "loginId"),
    nickname: requireString(user, "nickname"),
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw ApiError.invalidResponse();
  }
  return value as Record<string, unknown>;
}

function requireString(
  value: Record<string, unknown>,
  key: string,
): string {
  const candidate = value[key];
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw ApiError.invalidResponse();
  }
  return candidate;
}
