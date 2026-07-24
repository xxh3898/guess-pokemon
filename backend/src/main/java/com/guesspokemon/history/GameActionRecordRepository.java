package com.guesspokemon.history;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GameActionRecordRepository
        extends JpaRepository<GameActionRecord, UUID> {

    Optional<GameActionRecord>
            findByGameIdAndSequenceNumber(
                    UUID gameId,
                    Short sequenceNumber);

    boolean existsByCommandId(UUID commandId);
}
