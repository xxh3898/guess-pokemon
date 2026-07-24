package com.guesspokemon.security;

import static org.springframework.messaging.simp.SimpMessageType.MESSAGE;
import static org.springframework.messaging.simp.SimpMessageType.SUBSCRIBE;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.Message;
import org.springframework.security.authorization.AuthorizationManager;
import org.springframework.security.config.annotation.web.socket.EnableWebSocketSecurity;
import org.springframework.security.messaging.access.intercept.MessageMatcherDelegatingAuthorizationManager;

@Configuration(proxyBeanMethods = false)
@EnableWebSocketSecurity
class WebSocketSecurityConfig {

    @Bean
    AuthorizationManager<Message<?>>
            messageAuthorizationManager(
                    MessageMatcherDelegatingAuthorizationManager
                                    .Builder
                            messages) {
        messages.nullDestMatcher()
                .authenticated()
                .simpDestMatchers("/app/rooms/**")
                .hasRole("USER")
                .simpSubscribeDestMatchers(
                        "/user/queue/game-events",
                        "/user/queue/errors")
                .hasRole("USER")
                .simpTypeMatchers(MESSAGE, SUBSCRIBE)
                .denyAll()
                .anyMessage()
                .denyAll();
        return messages.build();
    }
}
