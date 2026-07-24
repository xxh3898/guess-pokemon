package com.guesspokemon.realtime;

import java.util.UUID;

final class RealtimeCommandException
        extends RuntimeException {

    private final UUID commandId;
    private final Long latestStateVersion;

    RealtimeCommandException(
            UUID commandId,
            Long latestStateVersion,
            RuntimeException cause) {
        super(cause);
        this.commandId = commandId;
        this.latestStateVersion = latestStateVersion;
    }

    UUID commandId() {
        return commandId;
    }

    Long latestStateVersion() {
        return latestStateVersion;
    }
}
