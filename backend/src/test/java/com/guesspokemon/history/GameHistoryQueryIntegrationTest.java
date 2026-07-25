package com.guesspokemon.history;

import static com.guesspokemon.game.GameTypes.GameEndReason.PLAYER_LEFT;
import static com.guesspokemon.game.GameTypes.GameAnswer.NO;
import static com.guesspokemon.game.GameTypes.GameResult.LOSS;
import static com.guesspokemon.game.GameTypes.GameResult.WIN;
import static com.guesspokemon.game.GameTypes.GameStatus.COMPLETED;
import static org.junit.jupiter.api.Assertions.assertEquals;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import com.guesspokemon.history.GameHistoryDtos.GameDetail;
import com.guesspokemon.history.GameHistoryDtos.GamePage;
import com.guesspokemon.user.AppUser;
import com.guesspokemon.user.AppUserRepository;
import jakarta.persistence.EntityManagerFactory;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest(
        properties =
                "spring.jpa.properties.hibernate.generate_statistics=true")
@Import(PostgreSqlTestContainerConfiguration.class)
@Transactional
class GameHistoryQueryIntegrationTest {

    private static final Instant BASE_TIME =
            Instant.parse("2026-07-25T07:00:00Z");

    @Autowired
    private GameHistoryService gameHistoryService;

    @Autowired
    private JdbcClient jdbcClient;

    @Autowired
    private AppUserRepository appUserRepository;

    @Autowired
    private EntityManagerFactory entityManagerFactory;

    private GameHistoryTestFixture fixture;

    @BeforeEach
    void setUp() {
        fixture =
                new GameHistoryTestFixture(
                        jdbcClient,
                        appUserRepository);
    }

    @Test
    void should_keepTwoQueries_when_historyPageContainsTwentyRows() {
        AppUser current =
                fixture.saveUser(
                        "history_query_list_current",
                        "쿼리레드");
        AppUser opponent =
                fixture.saveUser(
                        "history_query_list_opponent",
                        "쿼리그린");
        for (int index = 0; index < 21; index++) {
            Instant startedAt =
                    BASE_TIME.plusSeconds(index * 120L);
            fixture.insertEndedGame(
                    GameHistoryTestFixture.id(
                            "query-list-" + index),
                    current.getId(),
                    opponent.getId(),
                    COMPLETED,
                    PLAYER_LEFT,
                    WIN,
                    LOSS,
                    0,
                    startedAt,
                    startedAt.plusSeconds(60));
        }
        Statistics statistics = statistics();
        statistics.clear();

        GamePage page =
                gameHistoryService.list(
                        current.getId(),
                        null,
                        0,
                        20);

        assertEquals(20, page.content().size());
        assertEquals(21, page.totalElements());
        assertEquals(
                2,
                statistics.getPrepareStatementCount());
    }

    @Test
    void should_keepThreeQueries_when_detailHasActions() {
        AppUser current =
                fixture.saveUser(
                        "history_query_detail_current",
                        "상세쿼리레드");
        AppUser opponent =
                fixture.saveUser(
                        "history_query_detail_opponent",
                        "상세쿼리그린");
        UUID gameId =
                GameHistoryTestFixture.id(
                        "query-detail");
        fixture.insertEndedGame(
                gameId,
                current.getId(),
                opponent.getId(),
                COMPLETED,
                PLAYER_LEFT,
                WIN,
                LOSS,
                3,
                BASE_TIME,
                BASE_TIME.plusSeconds(60));
        fixture.insertAnsweredQuestion(
                gameId,
                opponent.getId(),
                1,
                "물 타입인가요?",
                NO,
                "물에서는 살지 않아요.",
                BASE_TIME.plusSeconds(10),
                BASE_TIME.plusSeconds(12));
        fixture.insertGuess(
                gameId,
                opponent.getId(),
                2,
                6,
                false,
                BASE_TIME.plusSeconds(30));
        fixture.insertGuess(
                gameId,
                opponent.getId(),
                3,
                25,
                false,
                BASE_TIME.plusSeconds(45));
        Statistics statistics = statistics();
        statistics.clear();

        GameDetail detail =
                gameHistoryService.findDetail(
                        current.getId(),
                        gameId);

        assertEquals(gameId, detail.gameId());
        assertEquals(3, detail.actions().size());
        assertEquals(
                "물에서는 살지 않아요.",
                detail.actions().getFirst().comment());
        assertEquals(
                3,
                statistics.getPrepareStatementCount());
    }

    @Test
    void should_orderByGameIdDescending_when_gamesHaveSameEndedAt() {
        AppUser current =
                fixture.saveUser(
                        "history_order_current",
                        "정렬레드");
        AppUser opponent =
                fixture.saveUser(
                        "history_order_opponent",
                        "정렬그린");
        UUID lowerGameId =
                UUID.fromString(
                        "11111111-1111-4111-8111-111111111111");
        UUID higherGameId =
                UUID.fromString(
                        "22222222-2222-4222-8222-222222222222");
        Instant endedAt = BASE_TIME.plusSeconds(600);
        fixture.insertEndedGame(
                lowerGameId,
                current.getId(),
                opponent.getId(),
                COMPLETED,
                PLAYER_LEFT,
                WIN,
                LOSS,
                0,
                BASE_TIME.plusSeconds(500),
                endedAt);
        fixture.insertEndedGame(
                higherGameId,
                current.getId(),
                opponent.getId(),
                COMPLETED,
                PLAYER_LEFT,
                WIN,
                LOSS,
                0,
                BASE_TIME.plusSeconds(500),
                endedAt);

        GamePage page =
                gameHistoryService.list(
                        current.getId(),
                        null,
                        0,
                        20);

        assertEquals(
                higherGameId,
                page.content().get(0).gameId());
        assertEquals(
                lowerGameId,
                page.content().get(1).gameId());
    }

    private Statistics statistics() {
        return entityManagerFactory
                .unwrap(SessionFactory.class)
                .getStatistics();
    }
}
