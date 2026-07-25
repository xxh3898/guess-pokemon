package com.guesspokemon;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.http.HttpHeaders;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class QuickTunnelConnectivityTest {

    private static final String QUICK_TUNNEL_URL =
            "QUICK_TUNNEL_URL";
    private static final String LOCAL_NGINX_URL =
            "LOCAL_NGINX_URL";
    private static final String PASSWORD =
            "Smoke-password-123!";
    private static final Duration REQUEST_TIMEOUT =
            Duration.ofSeconds(15);

    private final JsonMapper jsonMapper =
            JsonMapper.builder()
                    .findAndAddModules()
                    .build();

    @Test
    @EnabledIfEnvironmentVariable(
            named = QUICK_TUNNEL_URL,
            matches = "https://.+\\.trycloudflare\\.com")
    void should_verifyHttpsRestCookieAndWebSocket_when_quickTunnelIsAvailable()
            throws Exception {
        URI baseUri =
                requireQuickTunnelUri(
                        System.getenv(QUICK_TUNNEL_URL));
        verifyConnectivity(baseUri, true);
    }

    @Test
    @EnabledIfEnvironmentVariable(
            named = LOCAL_NGINX_URL,
            matches = "http://(?:127\\.0\\.0\\.1|localhost|host\\.docker\\.internal):[0-9]+")
    void should_verifyHttpRestCookieAndWebSocket_when_localNginxIsAvailable()
            throws Exception {
        URI baseUri =
                requireLocalNginxUri(
                        System.getenv(LOCAL_NGINX_URL));
        verifyConnectivity(baseUri, false);
    }

    private void verifyConnectivity(
            URI baseUri,
            boolean expectSecureTransport)
            throws Exception {
        HttpResponse<String> landingResponse =
                anonymousClient()
                        .send(
                                get(baseUri.resolve("/")),
                                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, landingResponse.statusCode());
        assertSecurityHeaders(
                landingResponse,
                expectSecureTransport);

        HttpResponse<String> spaRouteResponse =
                anonymousClient()
                        .send(
                                get(baseUri.resolve("/history")),
                                HttpResponse.BodyHandlers.ofString());
        assertEquals(200, spaRouteResponse.statusCode());

        AuthenticatedSession host =
                signupAndLogin(
                        baseUri,
                        "host",
                        expectSecureTransport);
        AuthenticatedSession guest =
                signupAndLogin(
                        baseUri,
                        "guest",
                        expectSecureTransport);
        assertNotEquals(host.sessionId(), guest.sessionId());

        String roomCode = createRoom(baseUri, host);
        joinRoom(baseUri, roomCode, guest);

        WebSocketStompClient hostStompClient =
                new WebSocketStompClient(
                        new StandardWebSocketClient());
        WebSocketStompClient guestStompClient =
                new WebSocketStompClient(
                        new StandardWebSocketClient());
        try {
            StompSession hostSocket =
                    connect(baseUri, host, hostStompClient);
            StompSession guestSocket =
                    connect(baseUri, guest, guestStompClient);
            assertTrue(hostSocket.isConnected());
            assertTrue(guestSocket.isConnected());
            guestSocket.disconnect();
            hostSocket.disconnect();
        } finally {
            guestStompClient.stop();
            hostStompClient.stop();
        }
    }

    private AuthenticatedSession signupAndLogin(
            URI baseUri,
            String role,
            boolean expectSecureCookie)
            throws Exception {
        String suffix =
                UUID.randomUUID()
                        .toString()
                        .replace("-", "")
                        .substring(0, 8);
        String loginId = role + "_" + suffix;
        CookieManager cookieManager =
                new CookieManager(
                        null,
                        CookiePolicy.ACCEPT_ORIGINAL_SERVER);
        HttpClient httpClient =
                HttpClient.newBuilder()
                        .cookieHandler(cookieManager)
                        .connectTimeout(REQUEST_TIMEOUT)
                        .build();

        CsrfCredentials anonymousCsrf =
                requestCsrf(baseUri, httpClient);
        HttpResponse<String> signupResponse =
                sendJson(
                        baseUri.resolve("/api/v1/auth/signup"),
                        httpClient,
                        anonymousCsrf,
                        Map.of(
                                "loginId",
                                loginId,
                                "nickname",
                                "터널" + suffix,
                                "password",
                                PASSWORD));
        assertEquals(201, signupResponse.statusCode());

        HttpResponse<String> loginResponse =
                sendJson(
                        baseUri.resolve("/api/v1/auth/login"),
                        httpClient,
                        anonymousCsrf,
                        Map.of(
                                "loginId",
                                loginId,
                                "password",
                                PASSWORD));
        assertEquals(200, loginResponse.statusCode());
        assertSessionCookie(
                loginResponse,
                expectSecureCookie);

        CsrfCredentials authenticatedCsrf =
                requestCsrf(baseUri, httpClient);
        HttpResponse<String> currentUserResponse =
                httpClient.send(
                        get(baseUri.resolve("/api/v1/auth/me")),
                        HttpResponse.BodyHandlers.ofString());
        assertEquals(200, currentUserResponse.statusCode());

        String sessionId =
                cookieManager.getCookieStore()
                        .getCookies()
                        .stream()
                        .filter(
                                cookie ->
                                        cookie.getName()
                                                .equals("SESSION"))
                        .map(HttpCookie::getValue)
                        .findFirst()
                        .orElseThrow();
        return new AuthenticatedSession(
                httpClient,
                sessionId,
                authenticatedCsrf);
    }

    private String createRoom(
            URI baseUri,
            AuthenticatedSession session)
            throws Exception {
        HttpResponse<String> response =
                sendWithoutBody(
                        baseUri.resolve("/api/v1/rooms"),
                        session);
        assertEquals(201, response.statusCode());
        JsonNode body = jsonMapper.readTree(response.body());
        return body.get("roomCode").stringValue();
    }

    private void joinRoom(
            URI baseUri,
            String roomCode,
            AuthenticatedSession session)
            throws Exception {
        HttpResponse<String> response =
                sendWithoutBody(
                        baseUri.resolve(
                                "/api/v1/rooms/"
                                        + roomCode
                                        + "/join"),
                        session);
        assertEquals(200, response.statusCode());
    }

    private StompSession connect(
            URI baseUri,
            AuthenticatedSession session,
            WebSocketStompClient stompClient)
            throws Exception {
        WebSocketHttpHeaders handshakeHeaders =
                new WebSocketHttpHeaders();
        handshakeHeaders.add(
                HttpHeaders.COOKIE,
                "SESSION=" + session.sessionId());
        handshakeHeaders.add(
                HttpHeaders.ORIGIN,
                baseUri.toString());

        StompHeaders connectHeaders = new StompHeaders();
        connectHeaders.add(
                session.csrf().headerName(),
                session.csrf().token());

        URI webSocketUri =
                new URI(
                        "https".equals(baseUri.getScheme())
                                ? "wss"
                                : "ws",
                        null,
                        baseUri.getHost(),
                        baseUri.getPort(),
                        "/ws",
                        null,
                        null);
        return stompClient
                .connectAsync(
                        webSocketUri,
                        handshakeHeaders,
                        connectHeaders,
                        new StompSessionHandlerAdapter() {
                        })
                .get(15, TimeUnit.SECONDS);
    }

    private CsrfCredentials requestCsrf(
            URI baseUri,
            HttpClient httpClient)
            throws Exception {
        HttpResponse<String> response =
                httpClient.send(
                        get(
                                baseUri.resolve(
                                        "/api/v1/auth/csrf")),
                        HttpResponse.BodyHandlers.ofString());
        assertEquals(200, response.statusCode());
        JsonNode body = jsonMapper.readTree(response.body());
        return new CsrfCredentials(
                body.get("headerName").stringValue(),
                body.get("token").stringValue());
    }

    private HttpResponse<String> sendJson(
            URI uri,
            HttpClient httpClient,
            CsrfCredentials csrf,
            Map<String, String> body)
            throws Exception {
        return httpClient.send(
                HttpRequest.newBuilder(uri)
                        .timeout(REQUEST_TIMEOUT)
                        .header(
                                HttpHeaders.ACCEPT,
                                "application/json")
                        .header(
                                HttpHeaders.CONTENT_TYPE,
                                "application/json")
                        .header(
                                csrf.headerName(),
                                csrf.token())
                        .POST(
                                HttpRequest.BodyPublishers
                                        .ofString(
                                                jsonMapper
                                                        .writeValueAsString(
                                                                body)))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> sendWithoutBody(
            URI uri,
            AuthenticatedSession session)
            throws Exception {
        return session.httpClient()
                .send(
                        HttpRequest.newBuilder(uri)
                                .timeout(REQUEST_TIMEOUT)
                                .header(
                                        HttpHeaders.ACCEPT,
                                        "application/json")
                                .header(
                                        session.csrf()
                                                .headerName(),
                                        session.csrf()
                                                .token())
                                .POST(
                                        HttpRequest.BodyPublishers
                                                .noBody())
                                .build(),
                        HttpResponse.BodyHandlers.ofString());
    }

    private HttpRequest get(URI uri) {
        return HttpRequest.newBuilder(uri)
                .timeout(REQUEST_TIMEOUT)
                .header(HttpHeaders.ACCEPT, "text/html, application/json")
                .GET()
                .build();
    }

    private HttpClient anonymousClient() {
        return HttpClient.newBuilder()
                .connectTimeout(REQUEST_TIMEOUT)
                .followRedirects(
                        HttpClient.Redirect.NORMAL)
                .build();
    }

    private URI requireQuickTunnelUri(String value) {
        URI uri = URI.create(value);
        if (!"https".equals(uri.getScheme())
                || uri.getHost() == null
                || !uri.getHost()
                        .endsWith(".trycloudflare.com")
                || uri.getPort() != -1
                || uri.getUserInfo() != null
                || uri.getQuery() != null
                || uri.getFragment() != null) {
            throw new IllegalArgumentException(
                    "QUICK_TUNNEL_URL은 HTTPS trycloudflare.com 주소여야 합니다.");
        }
        return URI.create(
                "https://" + uri.getHost());
    }

    private URI requireLocalNginxUri(String value) {
        URI uri = URI.create(value);
        if (!"http".equals(uri.getScheme())
                || !isAllowedLocalHost(uri.getHost())
                || uri.getPort() < 1024
                || uri.getPort() > 65_535
                || uri.getUserInfo() != null
                || uri.getQuery() != null
                || uri.getFragment() != null) {
            throw new IllegalArgumentException(
                    "LOCAL_NGINX_URL은 loopback HTTP 주소여야 합니다.");
        }
        return URI.create(
                "http://"
                        + uri.getHost()
                        + ":"
                        + uri.getPort());
    }

    private boolean isAllowedLocalHost(String host) {
        return "127.0.0.1".equals(host)
                || "localhost".equals(host)
                || "host.docker.internal".equals(host);
    }

    private void assertSecurityHeaders(
            HttpResponse<String> response,
            boolean expectHsts) {
        if (expectHsts) {
            assertEquals(
                    "max-age=31536000",
                    response.headers()
                            .firstValue(
                                    "Strict-Transport-Security")
                            .orElseThrow());
        } else {
            assertTrue(
                    response.headers()
                            .firstValue(
                                    "Strict-Transport-Security")
                            .isEmpty());
        }
        assertEquals(
                "camera=(), microphone=(), geolocation=()",
                response.headers()
                        .firstValue("Permissions-Policy")
                        .orElseThrow());
        assertEquals(
                "nosniff",
                response.headers()
                        .firstValue("X-Content-Type-Options")
                        .orElseThrow());
    }

    private void assertSessionCookie(
            HttpResponse<String> response,
            boolean expectSecure) {
        List<String> setCookies =
                response.headers().allValues("Set-Cookie");
        String sessionCookie =
                setCookies.stream()
                        .filter(
                                value ->
                                        value.startsWith("SESSION="))
                        .findFirst()
                        .orElseThrow();
        String lowerCaseCookie =
                sessionCookie.toLowerCase();
        if (expectSecure) {
            assertTrue(
                    lowerCaseCookie.contains("; secure"));
        } else {
            assertFalse(
                    lowerCaseCookie.contains("; secure"));
        }
        assertTrue(lowerCaseCookie.contains("; httponly"));
        assertTrue(lowerCaseCookie.contains("; samesite=lax"));
    }

    private record CsrfCredentials(
            String headerName,
            String token) {
    }

    private record AuthenticatedSession(
            HttpClient httpClient,
            String sessionId,
            CsrfCredentials csrf) {
    }
}
