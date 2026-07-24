package com.guesspokemon.history;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GameParticipantRecordRepository
        extends JpaRepository<
                GameParticipantRecord,
                GameParticipantId> {

    List<GameParticipantRecord> findAllByIdGameId(UUID gameId);
}
