package com.guesspokemon.history;

import com.guesspokemon.game.GameTypes.GameActionType;
import com.guesspokemon.game.GameTypes.GameAnswer;
import com.guesspokemon.game.GameTypes.GameEndReason;
import com.guesspokemon.game.GameTypes.GameResult;
import com.guesspokemon.game.GameTypes.GameRole;
import com.guesspokemon.game.GameTypes.GameStatus;
import com.guesspokemon.pokemon.PokemonDtos.PokemonSummary;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class GameHistoryDtos {

    private GameHistoryDtos() {
    }

    public record GamePage(
            List<GameListItem> content,
            int page,
            int size,
            long totalElements,
            int totalPages) {

        public GamePage {
            content = List.copyOf(content);
        }
    }

    public record GameListItem(
            UUID gameId,
            Instant startedAt,
            Instant endedAt,
            GameRole myRole,
            GameResult myResult,
            OpponentSummary opponent,
            PokemonSummary answerPokemon,
            GameEndReason endReason,
            int actionCount) {
    }

    public record OpponentSummary(
            UUID id,
            String nickname) {
    }

    public record GameDetail(
            UUID gameId,
            GameStatus status,
            Instant startedAt,
            Instant endedAt,
            PokemonSummary answerPokemon,
            GameEndReason endReason,
            int actionCount,
            List<GameParticipant> participants,
            List<GameActionItem> actions) {

        public GameDetail {
            participants = List.copyOf(participants);
            actions = List.copyOf(actions);
        }
    }

    public record GameParticipant(
            UUID userId,
            String nickname,
            GameRole role,
            GameResult result) {
    }

    public record GameActionItem(
            int sequenceNo,
            GameActionType type,
            String question,
            GameAnswer answer,
            PokemonSummary guessedPokemon,
            Boolean correct,
            Instant createdAt,
            Instant answeredAt) {
    }
}
