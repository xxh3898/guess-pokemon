package com.guesspokemon.realtime;

import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.messaging.SessionDisconnectEvent;

@Component
class WebSocketDisconnectListener {

    private final RoomConnectionService roomConnectionService;

    WebSocketDisconnectListener(
            RoomConnectionService roomConnectionService) {
        this.roomConnectionService = roomConnectionService;
    }

    @EventListener
    void onSessionDisconnect(
            SessionDisconnectEvent event) {
        roomConnectionService.disconnect(
                event.getSessionId());
    }
}
