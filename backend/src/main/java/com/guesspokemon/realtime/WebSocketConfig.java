package com.guesspokemon.realtime;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.TaskScheduler;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;

@Configuration(proxyBeanMethods = false)
@EnableWebSocketMessageBroker
class WebSocketConfig
        implements WebSocketMessageBrokerConfigurer {

    static final String ENDPOINT = "/ws";
    static final String GAME_EVENT_QUEUE =
            "/queue/game-events";
    static final String ERROR_QUEUE = "/queue/errors";
    private static final long HEARTBEAT_MILLISECONDS =
            10_000L;

    private final TaskScheduler taskScheduler;

    WebSocketConfig(
            @Qualifier("realtimeTaskScheduler")
                    TaskScheduler taskScheduler) {
        this.taskScheduler = taskScheduler;
    }

    @Override
    public void configureMessageBroker(
            MessageBrokerRegistry registry) {
        registry.setApplicationDestinationPrefixes("/app");
        registry.setUserDestinationPrefix("/user");
        registry.enableSimpleBroker("/queue")
                .setTaskScheduler(taskScheduler)
                .setHeartbeatValue(
                        new long[] {
                            HEARTBEAT_MILLISECONDS,
                            HEARTBEAT_MILLISECONDS
                        });
        registry.setPreservePublishOrder(true);
    }

    @Override
    public void registerStompEndpoints(
            StompEndpointRegistry registry) {
        registry.addEndpoint(ENDPOINT);
    }
}
