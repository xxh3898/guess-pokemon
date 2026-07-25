package com.guesspokemon.realtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import com.guesspokemon.user.AppUser;
import com.guesspokemon.user.UserRegistrationService;
import java.lang.reflect.Type;
import java.net.CookieManager;
import java.net.HttpCookie;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest(
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(PostgreSqlTestContainerConfiguration.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RealtimeCommandIntegrationTest {

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
    void should_routeRoleSpecificEventsAndErrors_when_membersSendCommands()
            throws Exception {
        AuthenticatedSession host =
                login("host");
        AuthenticatedSession guest =
                login("guest");
        AuthenticatedSession outsider =
                login("outsider");
        ClientConnection hostSocket = connect(host);
        ClientConnection guestSocket = connect(guest);
        ClientConnection outsiderSocket = connect(outsider);
        try {
            String roomCode =
                    createRoom(host);
            joinRoom(guest, roomCode);
            send(
                    hostSocket.session(),
                    "/app/rooms/"
                            + roomCode
                            + "/resume",
                    commandJson(
                            UUID.randomUUID(),
                            0,
                            "{}"));
            send(
                    guestSocket.session(),
                    "/app/rooms/"
                            + roomCode
                            + "/resume",
                    commandJson(
                            UUID.randomUUID(),
                            0,
                            "{}"));
            awaitEvent(
                    hostSocket.events(),
                    "ROOM_SNAPSHOT");
            awaitEvent(
                    guestSocket.events(),
                    "ROOM_SNAPSHOT");

            send(
                    hostSocket.session(),
                    "/app/rooms/"
                            + roomCode
                            + "/select-pokemon",
                    commandJson(
                            UUID.randomUUID(),
                            2,
                            """
                            {"nationalDexId":25}
                            """));
            JsonNode selectorRound =
                    awaitEvent(
                            hostSocket.events(),
                            "ROUND_STARTED");
            JsonNode questionerRound =
                    awaitEvent(
                            guestSocket.events(),
                            "ROUND_STARTED");

            assertTrue(
                    selectorRound
                            .get("payload")
                            .has("selectedPokemon"));
            assertFalse(
                    questionerRound
                            .get("payload")
                            .has("selectedPokemon"));
            assertFalse(
                    questionerRound
                            .toString()
                            .contains("피카츄"));

            send(
                    hostSocket.session(),
                    "/app/rooms/"
                            + roomCode
                            + "/ask",
                    commandJson(
                            UUID.randomUUID(),
                            3,
                            """
                            {"question":"날개가 있나요?"}
                            """));
            JsonNode roleError =
                    awaitMessage(
                            hostSocket.errors());
            assertEquals(
                    "INVALID_ROLE",
                    roleError.get("code").stringValue());

            send(
                    outsiderSocket.session(),
                    "/app/rooms/"
                            + roomCode
                            + "/ask",
                    commandJson(
                            UUID.randomUUID(),
                            3,
                            """
                            {"question":"전기 타입인가요?"}
                            """));
            JsonNode membershipError =
                    awaitMessage(
                            outsiderSocket.errors());
            assertEquals(
                    "ROOM_MEMBERSHIP_REQUIRED",
                    membershipError
                            .get("code")
                            .stringValue());

            send(
                    guestSocket.session(),
                    "/app/rooms/"
                            + roomCode
                            + "/ask",
                    commandJson(
                            UUID.randomUUID(),
                            1,
                            """
                            {"question":"전기 타입인가요?"}
                            """));
            JsonNode staleError =
                    awaitMessage(
                            guestSocket.errors());
            assertEquals(
                    "STALE_ROOM_STATE",
                    staleError.get("code").stringValue());
            assertEquals(
                    3,
                    staleError
                            .get("latestStateVersion")
                            .asLong());

            UUID askCommandId = UUID.randomUUID();
            send(
                    guestSocket.session(),
                    "/app/rooms/"
                            + roomCode
                            + "/ask",
                    commandJson(
                            askCommandId,
                            3,
                            """
                            {"question":"전기 타입인가요?"}
                            """));
            JsonNode questionAsked =
                    awaitEvent(
                            guestSocket.events(),
                            "QUESTION_ASKED");
            assertEquals(
                    4,
                    questionAsked
                            .get("stateVersion")
                            .asLong());

            send(
                    guestSocket.session(),
                    "/app/rooms/"
                            + roomCode
                            + "/ask",
                    commandJson(
                            askCommandId,
                            4,
                            """
                            {"question":"전기 타입인가요?"}
                            """));
            JsonNode duplicateError =
                    awaitMessage(
                            guestSocket.errors());
            assertEquals(
                    "DUPLICATE_COMMAND",
                    duplicateError
                            .get("code")
                            .stringValue());

            send(
                    guestSocket.session(),
                    "/app/rooms/"
                            + roomCode
                            + "/ask",
                    commandJson(
                            UUID.randomUUID(),
                            4,
                            """
                            {"question":" "}
                            """));
            JsonNode validationError =
                    awaitMessage(
                            guestSocket.errors());
            assertEquals(
                    "VALIDATION_FAILED",
                    validationError
                            .get("code")
                            .stringValue());

            send(
                    hostSocket.session(),
                    "/app/rooms/"
                            + roomCode
                            + "/answer",
                    commandJson(
                            UUID.randomUUID(),
                            4,
                            """
                            {
                              "answer":"YES",
                              "comment":"  노란색 전기 포켓몬이에요.  "
                            }
                            """));
            JsonNode selectorAnswered =
                    awaitEvent(
                            hostSocket.events(),
                            "QUESTION_ANSWERED");
            JsonNode questionerAnswered =
                    awaitEvent(
                            guestSocket.events(),
                            "QUESTION_ANSWERED");

            assertEquals(
                    5,
                    selectorAnswered
                            .get("stateVersion")
                            .asLong());
            assertEquals(
                    "노란색 전기 포켓몬이에요.",
                    selectorAnswered
                            .get("payload")
                            .get("comment")
                            .stringValue());
            assertEquals(
                    "노란색 전기 포켓몬이에요.",
                    questionerAnswered
                            .get("payload")
                            .get("comment")
                            .stringValue());
        } finally {
            disconnect(hostSocket);
            disconnect(guestSocket);
            disconnect(outsiderSocket);
        }
    }

    @Test
    void should_publishPostLeaveSnapshotToHostOnly_when_guestLeavesWaitingRoom()
            throws Exception {
        AuthenticatedSession host =
                login("leavehost");
        AuthenticatedSession guest =
                login("leaveguest");
        ClientConnection hostSocket = connect(host);
        ClientConnection guestSocket = connect(guest);
        try {
            String roomCode = createRoom(host);
            joinRoom(guest, roomCode);
            hostSocket.events().clear();
            guestSocket.events().clear();

            HttpResponse<String> response =
                    leaveRoom(guest, roomCode);

            assertEquals(204, response.statusCode());
            JsonNode snapshot =
                    awaitEvent(
                            hostSocket.events(),
                            "ROOM_SNAPSHOT");
            assertEquals(
                    "WAITING_FOR_OPPONENT",
                    snapshot.get("payload")
                            .get("status")
                            .stringValue());
            assertEquals(
                    3,
                    snapshot.get("stateVersion").asLong());
            assertTrue(
                    snapshot.get("payload")
                            .get("opponent")
                            .isNull());
            assertTrue(
                    guestSocket.events()
                            .poll(
                                    300,
                                    TimeUnit.MILLISECONDS)
                            == null);
        } finally {
            disconnect(hostSocket);
            disconnect(guestSocket);
        }
    }

    @Test
    void should_publishRoomClosedToGuestOnly_when_hostLeavesWaitingRoom()
            throws Exception {
        AuthenticatedSession host =
                login("closehost");
        AuthenticatedSession guest =
                login("closeguest");
        ClientConnection hostSocket = connect(host);
        ClientConnection guestSocket = connect(guest);
        try {
            String roomCode = createRoom(host);
            joinRoom(guest, roomCode);
            hostSocket.events().clear();
            guestSocket.events().clear();

            HttpResponse<String> response =
                    leaveRoom(host, roomCode);

            assertEquals(204, response.statusCode());
            JsonNode roomClosed =
                    awaitEvent(
                            guestSocket.events(),
                            "ROOM_CLOSED");
            assertEquals(
                    "HOST_LEFT",
                    roomClosed.get("payload")
                            .get("reason")
                            .stringValue());
            assertEquals(
                    host.userId().toString(),
                    roomClosed.get("payload")
                            .get("leftUserId")
                            .stringValue());
            assertTrue(
                    hostSocket.events()
                            .poll(
                                    300,
                                    TimeUnit.MILLISECONDS)
                            == null);
        } finally {
            disconnect(hostSocket);
            disconnect(guestSocket);
        }
    }

    private ClientConnection connect(
            AuthenticatedSession authenticated)
            throws Exception {
        WebSocketStompClient client =
                new WebSocketStompClient(
                        new StandardWebSocketClient());
        WebSocketHttpHeaders handshakeHeaders =
                new WebSocketHttpHeaders();
        handshakeHeaders.add(
                HttpHeaders.COOKIE,
                "SESSION=" + authenticated.sessionId());
        StompHeaders connectHeaders = new StompHeaders();
        connectHeaders.add(
                authenticated.csrfHeaderName(),
                authenticated.csrfToken());
        StompSession session =
                client.connectAsync(
                                URI.create(
                                        "ws://localhost:"
                                                + port
                                                + WebSocketConfig.ENDPOINT),
                                handshakeHeaders,
                                connectHeaders,
                                new StompSessionHandlerAdapter() {
                                })
                        .get(5, TimeUnit.SECONDS);
        BlockingQueue<JsonNode> events =
                new LinkedBlockingQueue<>();
        BlockingQueue<JsonNode> errors =
                new LinkedBlockingQueue<>();
        subscribe(
                session,
                "/user/queue/game-events",
                events);
        subscribe(
                session,
                "/user/queue/errors",
                errors);
        return new ClientConnection(
                client,
                session,
                events,
                errors);
    }

    private void subscribe(
            StompSession session,
            String destination,
            BlockingQueue<JsonNode> messages) {
        session.subscribe(
                destination,
                new JsonFrameHandler(messages));
    }

    private void send(
            StompSession session,
            String destination,
            String json) {
        StompHeaders headers = new StompHeaders();
        headers.setDestination(destination);
        headers.setContentType(MediaType.APPLICATION_JSON);
        session.send(
                headers,
                json.getBytes(StandardCharsets.UTF_8));
    }

    private JsonNode awaitEvent(
            BlockingQueue<JsonNode> events,
            String eventType)
            throws InterruptedException {
        long deadline = System.nanoTime()
                + TimeUnit.SECONDS.toNanos(5);
        while (System.nanoTime() < deadline) {
            JsonNode event =
                    events.poll(
                            250,
                            TimeUnit.MILLISECONDS);
            if (event != null
                    && eventType.equals(
                            event.get("eventType")
                                    .stringValue())) {
                return event;
            }
        }
        throw new AssertionError(
                "event를 받지 못했습니다: " + eventType);
    }

    private JsonNode awaitMessage(
            BlockingQueue<JsonNode> messages)
            throws InterruptedException {
        JsonNode message =
                messages.poll(5, TimeUnit.SECONDS);
        if (message == null) {
            throw new AssertionError(
                    "STOMP message를 받지 못했습니다.");
        }
        return message;
    }

    private String createRoom(
            AuthenticatedSession authenticated)
            throws Exception {
        HttpResponse<String> response =
                sendRest(
                        authenticated,
                        "/api/v1/rooms",
                        HttpRequest.BodyPublishers
                                .noBody());
        assertEquals(201, response.statusCode());
        return jsonMapper
                .readTree(response.body())
                .get("roomCode")
                .stringValue();
    }

    private void joinRoom(
            AuthenticatedSession authenticated,
            String roomCode)
            throws Exception {
        HttpResponse<String> response =
                sendRest(
                        authenticated,
                        "/api/v1/rooms/"
                                + roomCode
                                + "/join",
                        HttpRequest.BodyPublishers
                                .noBody());
        assertEquals(200, response.statusCode());
    }

    private HttpResponse<String> leaveRoom(
            AuthenticatedSession authenticated,
            String roomCode)
            throws Exception {
        return authenticated.httpClient()
                .send(
                        HttpRequest.newBuilder(
                                        URI.create(
                                                "http://localhost:"
                                                        + port
                                                        + "/api/v1/rooms/"
                                                        + roomCode
                                                        + "/members/me"))
                                .header(
                                        authenticated
                                                .csrfHeaderName(),
                                        authenticated
                                                .csrfToken())
                                .DELETE()
                                .build(),
                        HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> sendRest(
            AuthenticatedSession authenticated,
            String path,
            HttpRequest.BodyPublisher body)
            throws Exception {
        return authenticated.httpClient()
                .send(
                        HttpRequest.newBuilder(
                                        URI.create(
                                                "http://localhost:"
                                                        + port
                                                        + path))
                                .header(
                                        authenticated
                                                .csrfHeaderName(),
                                        authenticated
                                                .csrfToken())
                                .POST(body)
                                .build(),
                        HttpResponse.BodyHandlers.ofString());
    }

    private AuthenticatedSession login(String prefix)
            throws Exception {
        String suffix =
                UUID.randomUUID()
                        .toString()
                        .replace("-", "")
                        .substring(0, 8);
        String loginId = prefix + "_" + suffix;
        AppUser user =
                userRegistrationService.register(
                        loginId,
                        PASSWORD,
                        prefix.substring(0, 1) + suffix);
        CookieManager cookieManager = new CookieManager();
        HttpClient httpClient =
                HttpClient.newBuilder()
                        .cookieHandler(cookieManager)
                        .connectTimeout(Duration.ofSeconds(5))
                        .build();
        CsrfCredentials anonymousCsrf =
                requestCsrf(httpClient);
        HttpResponse<String> response =
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
        assertEquals(200, response.statusCode());
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
                httpClient,
                user.getId(),
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

    private String commandJson(
            UUID commandId,
            long expectedStateVersion,
            String payload) {
        return """
                {
                  "commandId": "%s",
                  "expectedStateVersion": %d,
                  "payload": %s
                }
                """
                .formatted(
                        commandId,
                        expectedStateVersion,
                        payload);
    }

    private void disconnect(
            ClientConnection connection) {
        if (connection.session().isConnected()) {
            connection.session().disconnect();
        }
        connection.client().stop();
    }

    private final class JsonFrameHandler
            implements StompFrameHandler {

        private final BlockingQueue<JsonNode> messages;

        private JsonFrameHandler(
                BlockingQueue<JsonNode> messages) {
            this.messages = messages;
        }

        @Override
        public Type getPayloadType(
                StompHeaders headers) {
            return byte[].class;
        }

        @Override
        public void handleFrame(
                StompHeaders headers,
                Object payload) {
            messages.add(
                    jsonMapper.readTree(
                            (byte[]) payload));
        }
    }

    private record CsrfCredentials(
            String headerName,
            String token) {
    }

    private record AuthenticatedSession(
            HttpClient httpClient,
            UUID userId,
            String sessionId,
            String csrfHeaderName,
            String csrfToken) {
    }

    private record ClientConnection(
            WebSocketStompClient client,
            StompSession session,
            BlockingQueue<JsonNode> events,
            BlockingQueue<JsonNode> errors) {
    }
}
