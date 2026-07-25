package com.guesspokemon.history;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface GameParticipantRecordRepository
        extends JpaRepository<
                GameParticipantRecord,
                GameParticipantId> {

    List<GameParticipantRecord> findAllByIdGameId(UUID gameId);

    @Query(
            value =
                    """
                    SELECT
                        participant.user_id AS user_id,
                        app_user.nickname AS nickname,
                        participant.role AS role,
                        participant.result AS result
                    FROM game_participant participant
                    JOIN app_user
                      ON app_user.id = participant.user_id
                    WHERE participant.game_id = :gameId
                    ORDER BY
                        CASE
                            WHEN participant.user_id = :currentUserId
                                THEN 0
                            ELSE 1
                        END,
                        participant.user_id
                    """,
            nativeQuery = true)
    List<GameParticipantRow> findHistoryParticipants(
            @Param("gameId") UUID gameId,
            @Param("currentUserId") UUID currentUserId);

    interface GameParticipantRow {

        UUID getUserId();

        String getNickname();

        String getRole();

        String getResult();
    }
}
