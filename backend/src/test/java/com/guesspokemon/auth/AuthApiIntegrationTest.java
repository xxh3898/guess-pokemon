package com.guesspokemon.auth;

import static com.guesspokemon.room.RoomDtos.RoomRole.QUESTIONER;
import static com.guesspokemon.room.RoomDtos.RoomRole.SELECTOR;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.nullValue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.cookie;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import com.guesspokemon.room.RoomApplicationService;
import com.guesspokemon.room.RoomDtos.RoomSnapshot;
import com.guesspokemon.user.AppUser;
import com.guesspokemon.user.AppUserRepository;
import com.guesspokemon.user.UserRegistrationService;
import com.jayway.jsonpath.JsonPath;
import jakarta.servlet.http.Cookie;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest
@AutoConfigureMockMvc
@Import(PostgreSqlTestContainerConfiguration.class)
class AuthApiIntegrationTest {

    private static final String VALID_PASSWORD = "valid-password-123";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private AppUserRepository appUserRepository;

    @Autowired
    private UserRegistrationService userRegistrationService;

    @Autowired
    private RoomApplicationService roomApplicationService;

    @Autowired
    private JdbcClient jdbcClient;

    @BeforeEach
    void setUp() {
        jdbcClient.sql("DELETE FROM spring_session_attributes").update();
        jdbcClient.sql("DELETE FROM spring_session").update();
        jdbcClient.sql("DELETE FROM game_action").update();
        jdbcClient.sql("DELETE FROM game_participant").update();
        jdbcClient.sql("DELETE FROM game").update();
        appUserRepository.deleteAll();
    }

    @Test
    void should_returnCsrfToken_when_anonymousUserRequestsToken()
            throws Exception {
        mockMvc.perform(get("/api/v1/auth/csrf"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.headerName").value("X-XSRF-TOKEN"))
                .andExpect(jsonPath("$.parameterName").value("_csrf"))
                .andExpect(jsonPath("$.token").isNotEmpty())
                .andExpect(cookie().exists("SESSION"))
                .andExpect(cookie().httpOnly("SESSION", true))
                .andExpect(
                        header()
                                .string(
                                        "Set-Cookie",
                                        containsString("SameSite=Lax")));
    }

    @Test
    void should_createInactiveSessionUser_when_signupSucceeds()
            throws Exception {
        CsrfSession csrfSession = csrfSession("192.0.2.1");

        mockMvc.perform(
                        jsonPost(
                                "/api/v1/auth/signup",
                                csrfSession,
                                "192.0.2.1",
                                signupJson(
                                        "  Trainer_RED  ",
                                        VALID_PASSWORD,
                                        " 레드 ")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.user.loginId").value("trainer_red"))
                .andExpect(jsonPath("$.user.nickname").value("레드"));

        AppUser saved =
                appUserRepository
                        .findByLoginIdKey("trainer_red")
                        .orElseThrow();
        assertTrue(saved.getPasswordHash().startsWith("{bcrypt}"));
        assertNotEquals(VALID_PASSWORD, saved.getPasswordHash());

        mockMvc.perform(
                        get("/api/v1/auth/me")
                                .cookie(csrfSession.cookie())
                                .with(
                                        request ->
                                                withRemoteAddress(
                                                        request,
                                                        "192.0.2.1")))
                .andExpect(status().isUnauthorized())
                .andExpect(
                        jsonPath("$.code")
                                .value("AUTHENTICATION_REQUIRED"));
    }

    @Test
    void should_rejectSignup_when_loginIdIsInvalid() throws Exception {
        CsrfSession csrfSession = csrfSession("192.0.2.2");

        mockMvc.perform(
                        jsonPost(
                                "/api/v1/auth/signup",
                                csrfSession,
                                "192.0.2.2",
                                signupJson(
                                        "red-trainer",
                                        VALID_PASSWORD,
                                        "레드")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void should_identifyDuplicateField_when_signupUsesExistingValues()
            throws Exception {
        userRegistrationService.register(
                "trainer_red",
                VALID_PASSWORD,
                "RED");
        CsrfSession csrfSession = csrfSession("192.0.2.3");

        mockMvc.perform(
                        jsonPost(
                                "/api/v1/auth/signup",
                                csrfSession,
                                "192.0.2.3",
                                signupJson(
                                        " TRAINER_RED ",
                                        VALID_PASSWORD,
                                        "그린")))
                .andExpect(status().isConflict())
                .andExpect(
                        jsonPath("$.code")
                                .value("LOGIN_ID_ALREADY_EXISTS"));

        mockMvc.perform(
                        jsonPost(
                                "/api/v1/auth/signup",
                                csrfSession,
                                "192.0.2.3",
                                signupJson(
                                        "trainer_blue",
                                        VALID_PASSWORD,
                                        "ＲＥＤ")))
                .andExpect(status().isConflict())
                .andExpect(
                        jsonPath("$.code")
                                .value("NICKNAME_ALREADY_EXISTS"));
    }

    @Test
    void should_rateLimitSignup_when_ipExceedsFiveAttempts()
            throws Exception {
        String clientIp = "192.0.2.4";
        CsrfSession csrfSession = csrfSession(clientIp);

        for (int attempt = 0; attempt < 5; attempt++) {
            mockMvc.perform(
                            jsonPost(
                                    "/api/v1/auth/signup",
                                    csrfSession,
                                    clientIp,
                                    signupJson(
                                            "trainer_" + attempt,
                                            VALID_PASSWORD,
                                            "훈련가" + attempt)))
                    .andExpect(status().isCreated());
        }

        mockMvc.perform(
                        jsonPost(
                                "/api/v1/auth/signup",
                                csrfSession,
                                clientIp,
                                signupJson(
                                        "trainer_6",
                                        VALID_PASSWORD,
                                        "훈련가6")))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("SIGNUP_RATE_LIMITED"))
                .andExpect(header().string("Retry-After", "600"));
    }

    @Test
    void should_persistAuthenticatedSession_when_loginSucceeds()
            throws Exception {
        AppUser appUser =
                userRegistrationService.register(
                        "session_red",
                        VALID_PASSWORD,
                        "레드");
        String clientIp = "192.0.2.5";
        CsrfSession csrfSession = csrfSession(clientIp);
        String previousSessionId = csrfSession.cookie().getValue();

        MvcResult loginResult =
                mockMvc.perform(
                                jsonPost(
                                        "/api/v1/auth/login",
                                        csrfSession,
                                        clientIp,
                                        loginJson(
                                                "session_red",
                                                VALID_PASSWORD)))
                        .andExpect(status().isOk())
                        .andExpect(
                                jsonPath("$.user.id")
                                        .value(appUser.getId().toString()))
                        .andReturn();

        Cookie authenticatedCookie =
                loginResult.getResponse().getCookie("SESSION");
        assertNotNull(authenticatedCookie);
        assertNotEquals(
                previousSessionId,
                authenticatedCookie.getValue());

        mockMvc.perform(
                        get("/api/v1/auth/me")
                                .cookie(authenticatedCookie)
                                .with(
                                        request ->
                                                withRemoteAddress(
                                                        request,
                                                        clientIp)))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.user.loginId")
                                .value("session_red"))
                .andExpect(jsonPath("$.activeRoomCode", nullValue()));

        Long storedSessionCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM spring_session
                                WHERE principal_name = :principalName
                                """)
                        .param(
                                "principalName",
                                appUser.getId().toString())
                        .query(Long.class)
                        .single();
        assertEquals(1L, storedSessionCount);

        Integer maxInactiveInterval =
                jdbcClient
                        .sql(
                                """
                                SELECT max_inactive_interval
                                FROM spring_session
                                WHERE principal_name = :principalName
                                """)
                        .param(
                                "principalName",
                                appUser.getId().toString())
                        .query(Integer.class)
                        .single();
        assertEquals(1_800, maxInactiveInterval);

        byte[] securityContextBytes =
                jdbcClient
                        .sql(
                                """
                                SELECT attributes.attribute_bytes
                                FROM spring_session_attributes attributes
                                JOIN spring_session session
                                  ON session.primary_id =
                                     attributes.session_primary_id
                                WHERE session.principal_name = :principalName
                                  AND attributes.attribute_name =
                                      'SPRING_SECURITY_CONTEXT'
                                """)
                        .param(
                                "principalName",
                                appUser.getId().toString())
                        .query(byte[].class)
                        .single();
        String serializedSecurityContext =
                new String(
                        securityContextBytes,
                        StandardCharsets.ISO_8859_1);
        assertFalse(serializedSecurityContext.contains(VALID_PASSWORD));
        assertFalse(
                serializedSecurityContext.contains(
                        appUser.getPasswordHash()));
    }

    @Test
    void should_returnSameError_when_loginIdOrPasswordIsInvalid()
            throws Exception {
        userRegistrationService.register(
                "credential_red",
                VALID_PASSWORD,
                "레드");
        CsrfSession csrfSession = csrfSession("192.0.2.6");

        mockMvc.perform(
                        jsonPost(
                                "/api/v1/auth/login",
                                csrfSession,
                                "192.0.2.6",
                                loginJson(
                                        "credential_red",
                                        "wrong-password")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));

        mockMvc.perform(
                        jsonPost(
                                "/api/v1/auth/login",
                                csrfSession,
                                "192.0.2.6",
                                loginJson(
                                        "trainer_none",
                                        "wrong-password")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
    }

    @Test
    void should_rejectLogin_when_userIsDisabled() throws Exception {
        AppUser appUser =
                userRegistrationService.register(
                        "disabled_red",
                        VALID_PASSWORD,
                        "레드");
        jdbcClient
                .sql(
                        """
                        UPDATE app_user
                        SET status = 'DISABLED',
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = :userId
                        """)
                .param("userId", appUser.getId())
                .update();
        CsrfSession csrfSession = csrfSession("192.0.2.7");

        mockMvc.perform(
                        jsonPost(
                                "/api/v1/auth/login",
                                csrfSession,
                                "192.0.2.7",
                                loginJson(
                                        "disabled_red",
                                        VALID_PASSWORD)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("USER_DISABLED"));
    }

    @Test
    void should_returnInvalidCredentials_when_loginPasswordExceedsBcryptLimit()
            throws Exception {
        userRegistrationService.register(
                "long_password",
                VALID_PASSWORD,
                "장문");
        CsrfSession csrfSession = csrfSession("192.0.2.70");

        mockMvc.perform(
                        jsonPost(
                                "/api/v1/auth/login",
                                csrfSession,
                                "192.0.2.70",
                                loginJson(
                                        "long_password",
                                        "가".repeat(25))))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("INVALID_CREDENTIALS"));
    }

    @Test
    void should_rateLimitLoginId_when_fivePasswordsAreInvalid()
            throws Exception {
        userRegistrationService.register(
                "limited_red",
                VALID_PASSWORD,
                "레드");
        CsrfSession csrfSession = csrfSession("192.0.2.8");

        for (int attempt = 0; attempt < 5; attempt++) {
            mockMvc.perform(
                            jsonPost(
                                    "/api/v1/auth/login",
                                    csrfSession,
                                    "198.51.100." + attempt,
                                    loginJson(
                                            "limited_red",
                                            "wrong-password")))
                    .andExpect(status().isUnauthorized());
        }

        mockMvc.perform(
                        jsonPost(
                                "/api/v1/auth/login",
                                csrfSession,
                                "198.51.100.10",
                                loginJson(
                                        "limited_red",
                                        VALID_PASSWORD)))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("LOGIN_RATE_LIMITED"));
    }

    @Test
    void should_rateLimitLoginIp_when_thirtyAttemptsAreConsumed()
            throws Exception {
        String clientIp = "192.0.2.9";
        CsrfSession csrfSession = csrfSession(clientIp);

        for (int attempt = 0; attempt < 30; attempt++) {
            mockMvc.perform(
                            jsonPost(
                                    "/api/v1/auth/login",
                                    csrfSession,
                                    clientIp,
                                    loginJson(
                                            "missing_" + attempt,
                                            "wrong-password")))
                    .andExpect(status().isUnauthorized());
        }

        mockMvc.perform(
                        jsonPost(
                                "/api/v1/auth/login",
                                csrfSession,
                                clientIp,
                                loginJson(
                                        "missing_31",
                                        "wrong-password")))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.code").value("LOGIN_RATE_LIMITED"));
    }

    @Test
    void should_removeSession_when_authenticatedUserLogsOut()
            throws Exception {
        AppUser appUser =
                userRegistrationService.register(
                        "logout_red",
                        VALID_PASSWORD,
                        "레드");
        String clientIp = "192.0.2.10";
        CsrfSession csrfSession = csrfSession(clientIp);
        MvcResult loginResult =
                mockMvc.perform(
                                jsonPost(
                                        "/api/v1/auth/login",
                                        csrfSession,
                                        clientIp,
                                        loginJson(
                                                "logout_red",
                                                VALID_PASSWORD)))
                        .andExpect(status().isOk())
                        .andReturn();
        Cookie authenticatedCookie =
                loginResult.getResponse().getCookie("SESSION");
        assertNotNull(authenticatedCookie);

        mockMvc.perform(
                        post("/api/v1/auth/logout")
                                .cookie(authenticatedCookie)
                                .header(
                                        "X-XSRF-TOKEN",
                                        csrfSession.token())
                                .with(
                                        request ->
                                                withRemoteAddress(
                                                        request,
                                                        clientIp)))
                .andExpect(status().isNoContent())
                .andExpect(cookie().maxAge("SESSION", 0));

        Long storedSessionCount =
                jdbcClient
                        .sql(
                                """
                                SELECT COUNT(*)
                                FROM spring_session
                                WHERE principal_name = :principalName
                                """)
                        .param(
                                "principalName",
                                appUser.getId().toString())
                        .query(Long.class)
                        .single();
        assertEquals(0L, storedSessionCount);
    }

    @Test
    void should_keepSession_when_authenticatedUserLogsOutDuringActiveGame()
            throws Exception {
        AppUser appUser =
                userRegistrationService.register(
                        "active_game_red",
                        VALID_PASSWORD,
                        "게임레드");
        AppUser guest =
                userRegistrationService.register(
                        "active_game_green",
                        VALID_PASSWORD,
                        "게임그린");
        String clientIp = "192.0.2.13";
        CsrfSession csrfSession = csrfSession(clientIp);
        MvcResult loginResult =
                mockMvc.perform(
                                jsonPost(
                                        "/api/v1/auth/login",
                                        csrfSession,
                                        clientIp,
                                        loginJson(
                                                "active_game_red",
                                                VALID_PASSWORD)))
                        .andExpect(status().isOk())
                        .andReturn();
        Cookie authenticatedCookie =
                loginResult.getResponse().getCookie("SESSION");
        assertNotNull(authenticatedCookie);

        RoomSnapshot created =
                roomApplicationService.create(
                        appUser.getId(),
                        appUser.getNickname());
        roomApplicationService.join(
                created.roomCode(),
                guest.getId(),
                guest.getNickname());
        roomApplicationService.changeRolePreference(
                created.roomCode(),
                appUser.getId(),
                UUID.randomUUID(),
                2,
                SELECTOR);
        roomApplicationService.changeRolePreference(
                created.roomCode(),
                guest.getId(),
                UUID.randomUUID(),
                3,
                QUESTIONER);
        roomApplicationService.selectPokemon(
                created.roomCode(),
                appUser.getId(),
                UUID.randomUUID(),
                4,
                25);

        try {
            mockMvc.perform(
                            post("/api/v1/auth/logout")
                                    .cookie(authenticatedCookie)
                                    .header(
                                            "X-XSRF-TOKEN",
                                            csrfSession.token())
                                    .with(
                                            request ->
                                                    withRemoteAddress(
                                                            request,
                                                            clientIp)))
                    .andExpect(status().isConflict())
                    .andExpect(
                            jsonPath("$.code")
                                    .value(
                                            "ACTIVE_GAME_MUST_BE_LEFT_FIRST"));

            mockMvc.perform(
                            get("/api/v1/auth/me")
                                    .cookie(authenticatedCookie)
                                    .with(
                                            request ->
                                                    withRemoteAddress(
                                                            request,
                                                            clientIp)))
                    .andExpect(status().isOk())
                    .andExpect(
                            jsonPath("$.user.id")
                                    .value(appUser.getId().toString()))
                    .andExpect(
                            jsonPath("$.activeRoomCode")
                                    .value(created.roomCode()));

            Long storedSessionCount =
                    jdbcClient
                            .sql(
                                    """
                                    SELECT COUNT(*)
                                    FROM spring_session
                                    WHERE principal_name = :principalName
                                    """)
                            .param(
                                    "principalName",
                                    appUser.getId().toString())
                            .query(Long.class)
                            .single();
            assertEquals(1L, storedSessionCount);
        } finally {
            roomApplicationService.leave(
                    created.roomCode(),
                    appUser.getId());
        }
    }

    @Test
    void should_rejectSignup_when_userIsAlreadyAuthenticated()
            throws Exception {
        userRegistrationService.register(
                "member_red",
                VALID_PASSWORD,
                "회원");
        String clientIp = "192.0.2.11";
        CsrfSession csrfSession = csrfSession(clientIp);
        MvcResult loginResult =
                mockMvc.perform(
                                jsonPost(
                                        "/api/v1/auth/login",
                                        csrfSession,
                                        clientIp,
                                        loginJson(
                                                "member_red",
                                                VALID_PASSWORD)))
                        .andExpect(status().isOk())
                        .andReturn();
        Cookie authenticatedCookie =
                loginResult.getResponse().getCookie("SESSION");
        assertNotNull(authenticatedCookie);

        mockMvc.perform(
                        post("/api/v1/auth/signup")
                                .cookie(authenticatedCookie)
                                .header(
                                        "X-XSRF-TOKEN",
                                        csrfSession.token())
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        signupJson(
                                                "member_blue",
                                                VALID_PASSWORD,
                                                "다른회원"))
                                .with(
                                        request ->
                                                withRemoteAddress(
                                                        request,
                                                        clientIp)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCESS_DENIED"));
    }

    @Test
    void should_rejectRequest_when_csrfTokenIsMissing() throws Exception {
        mockMvc.perform(
                        post("/api/v1/auth/signup")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content(
                                        signupJson(
                                                "trainer_red",
                                                VALID_PASSWORD,
                                                "레드")))
                .andExpect(status().isForbidden())
                .andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
                .andExpect(jsonPath("$.code").value("CSRF_INVALID"));
    }

    @Test
    void should_rejectProtectedApi_when_userIsAnonymous()
            throws Exception {
        mockMvc.perform(post("/api/v1/rooms"))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_INVALID"));

        mockMvc.perform(get("/api/v1/auth/me"))
                .andExpect(status().isUnauthorized())
                .andExpect(
                        jsonPath("$.code")
                                .value("AUTHENTICATION_REQUIRED"));
    }

    @Test
    void should_returnNotFound_when_authenticatedUserRequestsUnknownApi()
            throws Exception {
        userRegistrationService.register(
                "unknown_path",
                VALID_PASSWORD,
                "경로검증");
        String clientIp = "192.0.2.12";
        CsrfSession csrfSession = csrfSession(clientIp);
        MvcResult loginResult =
                mockMvc.perform(
                                jsonPost(
                                        "/api/v1/auth/login",
                                        csrfSession,
                                        clientIp,
                                        loginJson(
                                                "unknown_path",
                                                VALID_PASSWORD)))
                        .andExpect(status().isOk())
                        .andReturn();
        Cookie authenticatedCookie =
                loginResult.getResponse().getCookie("SESSION");
        assertNotNull(authenticatedCookie);

        mockMvc.perform(
                        get("/api/v1/unknown")
                                .cookie(authenticatedCookie)
                                .with(
                                        request ->
                                                withRemoteAddress(
                                                        request,
                                                        clientIp)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RESOURCE_NOT_FOUND"));
    }

    private CsrfSession csrfSession(String clientIp) throws Exception {
        MvcResult result =
                mockMvc.perform(
                                get("/api/v1/auth/csrf")
                                        .with(
                                                request ->
                                                        withRemoteAddress(
                                                                request,
                                                                clientIp)))
                        .andExpect(status().isOk())
                        .andReturn();
        String token =
                JsonPath.read(
                        result.getResponse().getContentAsString(),
                        "$.token");
        Cookie cookie = result.getResponse().getCookie("SESSION");
        assertNotNull(cookie);
        return new CsrfSession(cookie, token);
    }

    private MockHttpServletRequestBuilder jsonPost(
            String path,
            CsrfSession csrfSession,
            String clientIp,
            String body) {
        return post(path)
                .cookie(csrfSession.cookie())
                .header("X-XSRF-TOKEN", csrfSession.token())
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .with(
                        request ->
                                withRemoteAddress(request, clientIp));
    }

    private org.springframework.mock.web.MockHttpServletRequest
            withRemoteAddress(
                    org.springframework.mock.web.MockHttpServletRequest request,
                    String clientIp) {
        request.setRemoteAddr(clientIp);
        return request;
    }

    private String signupJson(
            String loginId,
            String password,
            String nickname) {
        return """
                {
                  "loginId": "%s",
                  "password": "%s",
                  "nickname": "%s"
                }
                """
                .formatted(loginId, password, nickname);
    }

    private String loginJson(String loginId, String password) {
        return """
                {
                  "loginId": "%s",
                  "password": "%s"
                }
                """
                .formatted(loginId, password);
    }

    private record CsrfSession(Cookie cookie, String token) {
    }
}
