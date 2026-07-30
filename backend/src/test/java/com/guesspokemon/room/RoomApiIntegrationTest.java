package com.guesspokemon.room;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import com.guesspokemon.security.AuthenticatedUser;
import com.guesspokemon.user.AppUser;
import com.jayway.jsonpath.JsonPath;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.RequestPostProcessor;

@SpringBootTest
@AutoConfigureMockMvc
@Import(PostgreSqlTestContainerConfiguration.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RoomApiIntegrationTest {

    private static final AtomicInteger USER_SEQUENCE =
            new AtomicInteger();

    @Autowired
    private MockMvc mockMvc;

    @Test
    void should_createRoomAndExposeActiveCode_when_memberRequestsRoom()
            throws Exception {
        AuthenticatedUser host = user("레드");

        MvcResult result =
                mockMvc.perform(
                                post("/api/v1/rooms")
                                        .with(authenticated(host))
                                        .with(csrf()))
                        .andExpect(status().isCreated())
                        .andExpect(
                                header()
                                        .string(
                                                "Cache-Control",
                                                containsString("no-store")))
                        .andExpect(
                                jsonPath("$.roomCode")
                                        .value(
                                                org.hamcrest.Matchers
                                                        .matchesPattern(
                                                                "[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}")))
                        .andExpect(
                                jsonPath("$.status")
                                        .value("WAITING_FOR_OPPONENT"))
                        .andExpect(jsonPath("$.stateVersion").value(1))
                        .andExpect(jsonPath("$.roundNumber").value(1))
                        .andExpect(
                                jsonPath("$.me.userId")
                                        .value(host.id().toString()))
                        .andExpect(
                                jsonPath("$.me.role")
                                        .value(nullValue()))
                        .andExpect(
                                jsonPath("$.me.connected").value(true))
                        .andExpect(jsonPath("$.opponent", nullValue()))
                        .andExpect(jsonPath("$.game", nullValue()))
                        .andExpect(
                                jsonPath("$.roleSelection", nullValue()))
                        .andExpect(
                                jsonPath("$.roleAssignment", nullValue()))
                        .andReturn();
        String roomCode =
                JsonPath.read(
                        result.getResponse().getContentAsString(),
                        "$.roomCode");
        assertNotNull(roomCode);

        mockMvc.perform(
                        get("/api/v1/auth/me")
                                .with(authenticated(host)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activeRoomCode").value(roomCode));
    }

    @Test
    void should_joinAndReturnRoleSelectionSnapshots_when_guestUsesCode()
            throws Exception {
        AuthenticatedUser host = user("레드");
        AuthenticatedUser guest = user("그린");
        String roomCode = createRoom(host);

        mockMvc.perform(
                        post(
                                        "/api/v1/rooms/{roomCode}/join",
                                        roomCode.toLowerCase(Locale.ROOT))
                                .with(authenticated(guest))
                                .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(
                        header()
                                .string(
                                        "Cache-Control",
                                        containsString("no-store")))
                .andExpect(
                        jsonPath("$.status")
                                .value("WAITING_FOR_ROLE_SELECTION"))
                .andExpect(jsonPath("$.stateVersion").value(2))
                .andExpect(jsonPath("$.me.userId").value(guest.id().toString()))
                .andExpect(jsonPath("$.me.role").value(nullValue()))
                .andExpect(
                        jsonPath("$.opponent.userId")
                                .value(host.id().toString()))
                .andExpect(
                        jsonPath("$.opponent.role").value(nullValue()))
                .andExpect(
                        jsonPath("$.roleSelection.preferredRole")
                                .value(nullValue()))
                .andExpect(
                        jsonPath("$.roleSelection.opponentSelected")
                                .value(false))
                .andExpect(jsonPath("$.selectedPokemon").doesNotExist());

        mockMvc.perform(
                        get("/api/v1/rooms/{roomCode}", roomCode)
                                .with(authenticated(host)))
                .andExpect(status().isOk())
                .andExpect(
                        header()
                                .string(
                                        "Cache-Control",
                                        containsString("no-store")))
                .andExpect(jsonPath("$.me.role").value(nullValue()))
                .andExpect(
                        jsonPath("$.opponent.role")
                                .value(nullValue()));
    }

    @Test
    void should_releaseMemberships_when_guestAndHostLeaveWaitingRoom()
            throws Exception {
        AuthenticatedUser host = user("레드");
        AuthenticatedUser guest = user("그린");
        String roomCode = createRoom(host);
        joinRoom(roomCode, guest);

        mockMvc.perform(
                        delete(
                                        "/api/v1/rooms/{roomCode}/members/me",
                                        roomCode)
                                .with(authenticated(guest))
                                .with(csrf()))
                .andExpect(status().isNoContent())
                .andExpect(
                        header()
                                .string(
                                        "Cache-Control",
                                        containsString("no-store")));

        mockMvc.perform(
                        get("/api/v1/auth/me")
                                .with(authenticated(guest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activeRoomCode", nullValue()));
        mockMvc.perform(
                        get("/api/v1/rooms/{roomCode}", roomCode)
                                .with(authenticated(host)))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.status")
                                .value("WAITING_FOR_OPPONENT"))
                .andExpect(jsonPath("$.stateVersion").value(3))
                .andExpect(jsonPath("$.opponent", nullValue()));

        joinRoom(roomCode, guest);
        mockMvc.perform(
                        delete(
                                        "/api/v1/rooms/{roomCode}/members/me",
                                        roomCode)
                                .with(authenticated(host))
                                .with(csrf()))
                .andExpect(status().isNoContent());

        mockMvc.perform(
                        get("/api/v1/auth/me")
                                .with(authenticated(host)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activeRoomCode", nullValue()));
        mockMvc.perform(
                        get("/api/v1/auth/me")
                                .with(authenticated(guest)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.activeRoomCode", nullValue()));
    }

    @Test
    void should_listOnlyJoinableRooms_when_authenticatedMemberRequestsLobby()
            throws Exception {
        AuthenticatedUser firstHost = user("목록레드");
        AuthenticatedUser secondHost = user("목록그린");
        AuthenticatedUser fullRoomHost = user("목록블루");
        AuthenticatedUser fullRoomGuest = user("목록옐로");
        AuthenticatedUser viewer = user("목록조회자");
        String firstRoomCode = createRoom(firstHost);
        String secondRoomCode = createRoom(secondHost);
        String fullRoomCode = createRoom(fullRoomHost);
        joinRoom(fullRoomCode, fullRoomGuest);

        MvcResult result =
                mockMvc.perform(
                                get("/api/v1/rooms")
                                        .with(authenticated(viewer)))
                        .andExpect(status().isOk())
                        .andExpect(
                                header()
                                        .string(
                                                "Cache-Control",
                                                containsString("no-store")))
                        .andReturn();
        List<Map<String, Object>> rooms =
                JsonPath.read(
                        result.getResponse().getContentAsString(),
                        "$.rooms");

        assertTrue(rooms.size() <= 50);
        assertEquals(
                Set.of("roomCode", "hostNickname", "mode"),
                findRoomSummary(rooms, "목록레드").keySet());
        assertEquals(
                firstRoomCode,
                findRoomSummary(rooms, "목록레드").get("roomCode"));
        assertEquals(
                secondRoomCode,
                findRoomSummary(rooms, "목록그린").get("roomCode"));
        assertEquals(
                "TWENTY_QUESTIONS",
                findRoomSummary(rooms, "목록레드").get("mode"));
        assertFalse(
                rooms.stream()
                        .anyMatch(
                                room ->
                                        "목록블루"
                                                .equals(
                                                        room.get(
                                                                "hostNickname"))));
    }

    @Test
    void should_returnStableErrors_when_joinRulesAreViolated()
            throws Exception {
        AuthenticatedUser host = user("레드");
        AuthenticatedUser guest = user("그린");
        AuthenticatedUser outsider = user("블루");
        String roomCode = createRoom(host);

        mockMvc.perform(
                        post(
                                        "/api/v1/rooms/{roomCode}/join",
                                        roomCode)
                                .with(authenticated(host))
                                .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(
                        jsonPath("$.code")
                                .value("CANNOT_JOIN_OWN_ROOM"));

        joinRoom(roomCode, guest);

        mockMvc.perform(
                        post(
                                        "/api/v1/rooms/{roomCode}/join",
                                        roomCode)
                                .with(authenticated(outsider))
                                .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ROOM_FULL"));

        String outsiderRoom = createRoom(outsider);
        mockMvc.perform(
                        post(
                                        "/api/v1/rooms/{roomCode}/join",
                                        roomCode)
                                .with(authenticated(outsider))
                                .with(csrf()))
                .andExpect(status().isConflict())
                .andExpect(
                        jsonPath("$.code")
                                .value("USER_ALREADY_IN_ACTIVE_ROOM"));
        assertNotNull(outsiderRoom);
    }

    @Test
    void should_rejectRoomAccess_when_codeOrMembershipIsInvalid()
            throws Exception {
        AuthenticatedUser host = user("레드");
        AuthenticatedUser outsider = user("블루");
        String roomCode = createRoom(host);

        mockMvc.perform(
                        post("/api/v1/rooms/{roomCode}/join", "ABC01I")
                                .with(authenticated(outsider))
                                .with(csrf()))
                .andExpect(status().isBadRequest())
                .andExpect(
                        jsonPath("$.code")
                                .value("VALIDATION_FAILED"));

        mockMvc.perform(
                        post("/api/v1/rooms/{roomCode}/join", "ZZZ999")
                                .with(authenticated(outsider))
                                .with(csrf()))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("ROOM_NOT_FOUND"));

        mockMvc.perform(
                        get("/api/v1/rooms/{roomCode}", roomCode)
                                .with(authenticated(outsider)))
                .andExpect(status().isForbidden())
                .andExpect(
                        jsonPath("$.code")
                                .value("ROOM_MEMBERSHIP_REQUIRED"));
    }

    @Test
    void should_requireAuthenticationAndCsrf_when_roomApiIsCalled()
            throws Exception {
        AuthenticatedUser user = user("레드");

        mockMvc.perform(post("/api/v1/rooms").with(csrf()))
                .andExpect(status().isUnauthorized())
                .andExpect(
                        jsonPath("$.code")
                                .value("AUTHENTICATION_REQUIRED"));
        mockMvc.perform(
                        post("/api/v1/rooms")
                                .with(authenticated(user)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_INVALID"));
        mockMvc.perform(get("/api/v1/rooms/ABC234"))
                .andExpect(status().isUnauthorized())
                .andExpect(
                        jsonPath("$.code")
                                .value("AUTHENTICATION_REQUIRED"));
        mockMvc.perform(get("/api/v1/rooms"))
                .andExpect(status().isUnauthorized())
                .andExpect(
                        jsonPath("$.code")
                                .value("AUTHENTICATION_REQUIRED"));
    }

    private String createRoom(AuthenticatedUser user) throws Exception {
        MvcResult result =
                mockMvc.perform(
                                post("/api/v1/rooms")
                                        .with(authenticated(user))
                                        .with(csrf()))
                        .andExpect(status().isCreated())
                        .andReturn();
        return JsonPath.read(
                result.getResponse().getContentAsString(),
                "$.roomCode");
    }

    private void joinRoom(
            String roomCode,
            AuthenticatedUser user)
            throws Exception {
        mockMvc.perform(
                        post(
                                        "/api/v1/rooms/{roomCode}/join",
                                        roomCode)
                                .with(authenticated(user))
                                .with(csrf()))
                .andExpect(status().isOk());
    }

    private AuthenticatedUser user(String nickname) {
        int suffix = USER_SEQUENCE.incrementAndGet();
        String loginId = "room_user_" + suffix;
        return AuthenticatedUser.from(
                AppUser.create(
                        loginId,
                        loginId,
                        nickname,
                        nickname,
                        "{noop}test-only-password",
                        Instant.parse("2026-07-25T00:00:00Z")));
    }

    private Map<String, Object> findRoomSummary(
            List<Map<String, Object>> rooms,
            String hostNickname) {
        return rooms.stream()
                .filter(
                        room ->
                                hostNickname.equals(
                                        room.get("hostNickname")))
                .findFirst()
                .orElseThrow();
    }

    private RequestPostProcessor authenticated(
            AuthenticatedUser authenticatedUser) {
        return authentication(
                UsernamePasswordAuthenticationToken.authenticated(
                        authenticatedUser,
                        null,
                        authenticatedUser.getAuthorities()));
    }
}
