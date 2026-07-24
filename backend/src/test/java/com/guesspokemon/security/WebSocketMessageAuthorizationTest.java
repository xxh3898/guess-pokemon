package com.guesspokemon.security;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.messaging.Message;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.messaging.simp.SimpMessageType;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.messaging.access.intercept.MessageMatcherDelegatingAuthorizationManager;

class WebSocketMessageAuthorizationTest {

    private AuthorizationManager<Message<?>> authorizationManager;
    private Authentication member;
    private Authentication anonymous;

    @BeforeEach
    void setUp() {
        authorizationManager =
                new WebSocketSecurityConfig()
                        .messageAuthorizationManager(
                                MessageMatcherDelegatingAuthorizationManager
                                        .builder());
        member =
                UsernamePasswordAuthenticationToken
                        .authenticated(
                                "member",
                                "",
                                List.of(
                                        new SimpleGrantedAuthority(
                                                "ROLE_USER")));
        anonymous =
                new AnonymousAuthenticationToken(
                        "test-key",
                        "anonymous",
                        List.of(
                                new SimpleGrantedAuthority(
                                        "ROLE_ANONYMOUS")));
    }

    @Test
    void should_allowOnlyApplicationCommands_when_memberSendsMessage() {
        assertTrue(
                isGranted(
                        member,
                        message(
                                SimpMessageType.MESSAGE,
                                "/app/rooms/ABC234/ask")));
        assertFalse(
                isGranted(
                        member,
                        message(
                                SimpMessageType.MESSAGE,
                                "/queue/game-events")));
    }

    @Test
    void should_allowOnlyPrivateQueues_when_memberSubscribes() {
        assertTrue(
                isGranted(
                        member,
                        message(
                                SimpMessageType.SUBSCRIBE,
                                "/user/queue/game-events")));
        assertTrue(
                isGranted(
                        member,
                        message(
                                SimpMessageType.SUBSCRIBE,
                                "/user/queue/errors")));
        assertFalse(
                isGranted(
                        member,
                        message(
                                SimpMessageType.SUBSCRIBE,
                                "/topic/rooms/ABC234")));
    }

    @Test
    void should_rejectConnect_when_userIsAnonymous() {
        assertTrue(
                isGranted(
                        member,
                        message(
                                SimpMessageType.CONNECT,
                                null)));
        assertFalse(
                isGranted(
                        anonymous,
                        message(
                                SimpMessageType.CONNECT,
                                null)));
    }

    private boolean isGranted(
            Authentication authentication,
            Message<?> message) {
        return authorizationManager
                .authorize(
                        () -> authentication,
                        message)
                .isGranted();
    }

    private Message<byte[]> message(
            SimpMessageType messageType,
            String destination) {
        SimpMessageHeaderAccessor headers =
                SimpMessageHeaderAccessor.create(
                        messageType);
        if (destination != null) {
            headers.setDestination(destination);
        }
        headers.setLeaveMutable(false);
        return MessageBuilder.createMessage(
                new byte[0],
                headers.getMessageHeaders());
    }
}
