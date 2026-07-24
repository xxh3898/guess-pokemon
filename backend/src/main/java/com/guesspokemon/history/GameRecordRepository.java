package com.guesspokemon.history;

import com.guesspokemon.game.GameTypes.GameStatus;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface GameRecordRepository
        extends JpaRepository<GameRecord, UUID> {

    List<GameRecord> findAllByStatus(GameStatus status);
}
