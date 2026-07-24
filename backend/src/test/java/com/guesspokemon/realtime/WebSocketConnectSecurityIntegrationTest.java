package com.guesspokemon.realtime;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import com.guesspokemon.user.UserRegistrationService;
import java.net.CookieManager;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(PostgreSqlTestContainerConfiguration.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class WebSocketConnectSecurityIntegrationTest {

    private static final String PASSWORD = "Valid-password-123!";
    private final JsonMapper jsonMapper =
            JsonMapper.builder()
                    .findAndAddModules()
                    .build();

    @LocalServerPort
    private int port;

    @Autowired
    private UserRegistrationService userRegistrationService;

    @Test
    void should_connectWithSessionAndCsrf_when_credentialsAreValid()
            throws Exception {
        AuthenticatedSession authenticated =
                loginAuthenticatedSession();
        WebSocketStompClient stompClient =
                new WebSocketStompClient(
                        new StandardWebSocketClient());

        StompSession session =
                connect(
                        stompClient,
                        authenticated,
                        true);

        assertTrue(session.isConnected());
        session.disconnect();
        stompClient.stop();
    }

    @Test
    void should_rejectConnect_when_csrfHeaderIsMissing()
            throws Exception {
        AuthenticatedSession authenticated =
                loginAuthenticatedSession();
        WebSocketStompClient stompClient =
                new WebSocketStompClient(
                        new StandardWebSocketClient());

        assertThrows(
                ExecutionException.class,
                () ->
                        connect(
                                stompClient,
                                authenticated,
                                false));
        stompClient.stop();
    }

    private StompSession connect(
            WebSocketStompClient stompClient,
            AuthenticatedSession authenticated,
            boolean includeCsrf)
            throws Exception {
        WebSocketHttpHeaders handshakeHeaders =
                new WebSocketHttpHeaders();
        handshakeHeaders.add(
                HttpHeaders.COOKIE,
                "SESSION=" + authenticated.sessionId());
        StompHeaders connectHeaders = new StompHeaders();
        if (includeCsrf) {
            connectHeaders.add(
                    authenticated.csrfHeaderName(),
                    authenticated.csrfToken());
        }
        return stompClient
                .connectAsync(
                        URI.create(
                                "ws://localhost:"
                                        + port
                                        + WebSocketConfig.ENDPOINT),
                        handshakeHeaders,
                        connectHeaders,
                        new StompSessionHandlerAdapter() {
                        })
                .get(5, TimeUnit.SECONDS);
    }

    private AuthenticatedSession loginAuthenticatedSession()
            throws Exception {
        String suffix =
                UUID.randomUUID()
                        .toString()
                        .replace("-", "")
                        .substring(0, 8);
        String loginId = "ws_" + suffix;
        userRegistrationService.register(
                loginId,
                PASSWORD,
                "연결" + suffix);
        CookieManager cookieManager = new CookieManager();
        HttpClient httpClient =
                HttpClient.newBuilder()
                        .cookieHandler(cookieManager)
                        .connectTimeout(Duration.ofSeconds(5))
                        .build();
        CsrfCredentials anonymousCsrf =
                requestCsrf(httpClient);
        HttpResponse<String> loginResponse =
                httpClient.send(
                        HttpRequest.newBuilder(
                                        URI.create(
                                                "http://localhost:"
                                                        + port
                                                        + "/api/v1/auth/login"))
                                .header(
                                        "Content-Type",
                                        "application/json")
                                .header(
                                        anonymousCsrf.headerName(),
                                        anonymousCsrf.token())
                                .POST(
                                        HttpRequest.BodyPublishers
                                                .ofString(
                                                        """
                                                        {
                                                          "loginId": "%s",
                                                          "password": "%s"
                                                        }
                                                        """
                                                                .formatted(
                                                                        loginId,
                                                                        PASSWORD)))
                                .build(),
                        HttpResponse.BodyHandlers.ofString());
        if (loginResponse.statusCode() != 200) {
            throw new IllegalStateException(
                    "test login 실패 status="
                            + loginResponse.statusCode());
        }
        CsrfCredentials authenticatedCsrf =
                requestCsrf(httpClient);
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
                sessionId,
                authenticatedCsrf.headerName(),
                authenticatedCsrf.token());
    }

    private CsrfCredentials requestCsrf(
            HttpClient httpClient)
            throws Exception {
        HttpResponse<String> response =
                httpClient.send(
                        HttpRequest.newBuilder(
                                        URI.create(
                                                "http://localhost:"
                                                        + port
                                                        + "/api/v1/auth/csrf"))
                                .GET()
                                .build(),
                        HttpResponse.BodyHandlers.ofString());
        JsonNode body =
                jsonMapper.readTree(response.body());
        return new CsrfCredentials(
                body.get("headerName").stringValue(),
                body.get("token").stringValue());
    }

    private record CsrfCredentials(
            String headerName,
            String token) {
    }

    private record AuthenticatedSession(
            String sessionId,
            String csrfHeaderName,
            String csrfToken) {
    }
}
