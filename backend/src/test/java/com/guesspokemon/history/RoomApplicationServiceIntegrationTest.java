package com.guesspokemon.history;

import static com.guesspokemon.game.GameRuleException.GameRuleError.STALE_ROOM_STATE;
import static com.guesspokemon.game.GameTypes.GameAnswer.YES;
import static com.guesspokemon.game.GameTypes.GameEndReason.BOTH_DISCONNECTED;
import static com.guesspokemon.game.GameTypes.GameEndReason.PLAYER_LEFT;
import static com.guesspokemon.game.GameTypes.GameEndReason.RECONNECT_TIMEOUT;
import static com.guesspokemon.game.GameTypes.GameStatus.ABORTED;
import static com.guesspokemon.game.GameTypes.GameStatus.COMPLETED;
import static com.guesspokemon.room.RoomDtos.RoomRole.QUESTIONER;
import static com.guesspokemon.room.RoomDtos.RoomRole.SELECTOR;
import static com.guesspokemon.room.RoomDtos.RoomStatus.PAUSED;
import static com.guesspokemon.room.RoomDtos.RoomStatus.PLAYING;
import static com.guesspokemon.room.RoomDtos.RoomStatus.RESULT;
import static com.guesspokemon.room.RoomDtos.RoomStatus.WAITING_FOR_SELECTION;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import com.guesspokemon.game.GameRuleException;
import com.guesspokemon.room.RoomApplicationService;
import com.guesspokemon.room.RoomApplicationService.CommandOutcome;
import com.guesspokemon.room.RoomApplicationService.ConnectionOutcome;
import com.guesspokemon.room.RoomApplicationService.LeaveOutcome;
import com.guesspokemon.room.RoomApplicationService.RolePreferenceOutcome;
import com.guesspokemon.room.RoomApplicationService.TimeoutOutcome;
import com.guesspokemon.room.RoomDtos.QuestionerGameSnapshot;
import com.guesspokemon.room.RoomDtos.ResultGameSnapshot;
import com.guesspokemon.room.RoomDtos.RoomSnapshot;
import com.guesspokemon.room.RoomDtos.SelectorGameSnapshot;
import com.guesspokemon.user.AppUser;
import com.guesspokemon.user.AppUserRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.test.annotation.DirtiesContext;

@SpringBootTest
@Import(PostgreSqlTestContainerConfiguration.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class RoomApplicationServiceIntegrationTest {

    private static final int PIKACHU_ID = 25;
    private static final Instant USER_CREATED_AT =
            Instant.parse("2026-07-25T05:00:00Z");

    @Autowired
    private RoomApplicationService roomApplicationService;

    @Autowired
    private AppUserRepository appUserRepository;

    @Autowired
    private GameRecordRepository gameRecordRepository;

    @Autowired
    private JdbcClient jdbcClient;

    @BeforeEach
    void setUp() {
        cleanDatabase();
    }

    @AfterEach
    void cleanUp() {
        cleanDatabase();
    }

    @Test
    void should_playAndChooseRoles_when_playersStartNextRound() {
        TestRoom testRoom = createJoinedRoom("play");
        assignFirstRoundRoles(testRoom);

        CommandOutcome started =
                roomApplicationService.selectPokemon(
                        testRoom.roomCode(),
                        testRoom.host().getId(),
                        UUID.randomUUID(),
                        4,
                        PIKACHU_ID);
        RoomSnapshot selectorSnapshot =
                started.snapshots()
                        .get(testRoom.host().getId());
        RoomSnapshot questionerSnapshot =
                started.snapshots()
                        .get(testRoom.guest().getId());

        assertEquals(PLAYING, selectorSnapshot.status());
        assertInstanceOf(
                SelectorGameSnapshot.class,
                selectorSnapshot.game());
        assertInstanceOf(
                QuestionerGameSnapshot.class,
                questionerSnapshot.game());

        roomApplicationService.askQuestion(
                testRoom.roomCode(),
                testRoom.guest().getId(),
                UUID.randomUUID(),
                5,
                "전기 타입인가요?");
        CommandOutcome answered =
                roomApplicationService.answerQuestion(
                        testRoom.roomCode(),
                        testRoom.host().getId(),
                        UUID.randomUUID(),
                        6,
                        YES,
                        "  전기 타입이 맞아요.  ");
        assertEquals(
                "전기 타입이 맞아요.",
                answered
                        .snapshots()
                        .get(testRoom.guest().getId())
                        .game()
                        .actions()
                        .getFirst()
                        .comment());
        CommandOutcome ended =
                roomApplicationService.guessPokemon(
                        testRoom.roomCode(),
                        testRoom.guest().getId(),
                        UUID.randomUUID(),
                        7,
                        PIKACHU_ID);

        assertTrue(ended.gameEnded());
        RoomSnapshot result =
                ended.snapshots()
                        .get(testRoom.guest().getId());
        assertEquals(RESULT, result.status());
        ResultGameSnapshot resultGame =
                assertInstanceOf(
                        ResultGameSnapshot.class,
                        result.game());
        assertEquals(COMPLETED, resultGame.status());
        assertEquals(
                testRoom.guest().getId(),
                resultGame.winnerUserId());
        assertEquals(
                "피카츄",
                resultGame.answerPokemon().koreanName());

        RolePreferenceOutcome hostPreference =
                roomApplicationService
                        .changeRolePreference(
                                testRoom.roomCode(),
                                testRoom.host().getId(),
                                UUID.randomUUID(),
                                8,
                                QUESTIONER);
        RolePreferenceOutcome guestPreference =
                roomApplicationService
                        .changeRolePreference(
                                testRoom.roomCode(),
                                testRoom.guest().getId(),
                                UUID.randomUUID(),
                                9,
                                SELECTOR);

        assertFalse(hostPreference.rolesAssigned());
        assertTrue(guestPreference.rolesAssigned());
        RoomSnapshot nextRound =
                guestPreference.snapshots()
                        .get(testRoom.host().getId());
        assertEquals(WAITING_FOR_SELECTION, nextRound.status());
        assertEquals(2, nextRound.roundNumber());
        assertEquals(QUESTIONER, nextRound.me().role());
        assertEquals(SELECTOR, nextRound.opponent().role());
        assertNull(nextRound.game());
    }

    @Test
    void should_resumeThenForfeit_when_reconnectDeadlineExpires() {
        TestRoom testRoom = createStartedRoom("timeout");

        ConnectionOutcome disconnected =
                roomApplicationService.disconnect(
                        testRoom.roomCode(),
                        testRoom.guest().getId());
        assertEquals(
                PAUSED,
                disconnected.snapshots()
                        .get(testRoom.host().getId())
                        .status());

        ConnectionOutcome resumed =
                roomApplicationService.resume(
                        testRoom.roomCode(),
                        testRoom.guest().getId());
        assertEquals(
                PLAYING,
                resumed.snapshots()
                        .get(testRoom.host().getId())
                        .status());

        GameRuleException stale =
                assertThrows(
                        GameRuleException.class,
                        () ->
                                roomApplicationService
                                        .askQuestion(
                                                testRoom.roomCode(),
                                                testRoom.guest().getId(),
                                                UUID.randomUUID(),
                                                3,
                                                "날개가 있나요?"));
        assertEquals(STALE_ROOM_STATE, stale.error());

        ConnectionOutcome disconnectedAgain =
                roomApplicationService.disconnect(
                        testRoom.roomCode(),
                        testRoom.guest().getId());
        TimeoutOutcome timedOut =
                roomApplicationService
                        .reconnectTimedOut(
                                testRoom.roomCode(),
                                testRoom.guest().getId(),
                                disconnectedAgain
                                        .change()
                                        .reconnectToken(),
                                disconnectedAgain
                                        .change()
                                        .reconnectDeadline());

        assertTrue(timedOut.completed());
        assertEquals(RECONNECT_TIMEOUT, timedOut.endReason());
        ResultGameSnapshot result =
                assertInstanceOf(
                        ResultGameSnapshot.class,
                        timedOut.snapshots()
                                .get(testRoom.host().getId())
                                .game());
        assertEquals(
                testRoom.host().getId(),
                result.winnerUserId());
        assertEquals(
                RECONNECT_TIMEOUT,
                gameRecordRepository
                        .findById(result.gameId())
                        .orElseThrow()
                        .getEndReason());
    }

    @Test
    void should_abortWithoutWinner_when_bothPlayersStayDisconnected() {
        TestRoom testRoom = createStartedRoom("both");
        ConnectionOutcome hostDisconnected =
                roomApplicationService.disconnect(
                        testRoom.roomCode(),
                        testRoom.host().getId());
        roomApplicationService.disconnect(
                testRoom.roomCode(),
                testRoom.guest().getId());

        TimeoutOutcome timedOut =
                roomApplicationService
                        .reconnectTimedOut(
                                testRoom.roomCode(),
                                testRoom.host().getId(),
                                hostDisconnected
                                        .change()
                                        .reconnectToken(),
                                hostDisconnected
                                        .change()
                                        .reconnectDeadline());

        ResultGameSnapshot result =
                assertInstanceOf(
                        ResultGameSnapshot.class,
                        timedOut.snapshots()
                                .get(testRoom.host().getId())
                                .game());
        assertEquals(BOTH_DISCONNECTED, timedOut.endReason());
        assertEquals(ABORTED, result.status());
        assertNull(result.winnerUserId());
        assertNull(result.loserUserId());
    }

    @Test
    void should_closeRoomAndPersistLoss_when_playerLeavesActiveGame() {
        TestRoom testRoom = createStartedRoom("leave");

        LeaveOutcome outcome =
                roomApplicationService.leave(
                        testRoom.roomCode(),
                        testRoom.guest().getId());

        assertTrue(outcome.gameEnded());
        assertTrue(outcome.roomClosed());
        ResultGameSnapshot result =
                assertInstanceOf(
                        ResultGameSnapshot.class,
                        outcome.snapshots()
                                .get(testRoom.host().getId())
                                .game());
        assertEquals(PLAYER_LEFT, result.endReason());
        assertEquals(
                testRoom.host().getId(),
                result.winnerUserId());
        assertEquals(
                PLAYER_LEFT,
                gameRecordRepository
                        .findById(result.gameId())
                        .orElseThrow()
                        .getEndReason());
    }

    private TestRoom createStartedRoom(String prefix) {
        TestRoom testRoom = createJoinedRoom(prefix);
        assignFirstRoundRoles(testRoom);
        roomApplicationService.selectPokemon(
                testRoom.roomCode(),
                testRoom.host().getId(),
                UUID.randomUUID(),
                4,
                PIKACHU_ID);
        return testRoom;
    }

    private void assignFirstRoundRoles(TestRoom testRoom) {
        roomApplicationService.changeRolePreference(
                testRoom.roomCode(),
                testRoom.host().getId(),
                UUID.randomUUID(),
                2,
                SELECTOR);
        roomApplicationService.changeRolePreference(
                testRoom.roomCode(),
                testRoom.guest().getId(),
                UUID.randomUUID(),
                3,
                QUESTIONER);
    }

    private TestRoom createJoinedRoom(String prefix) {
        AppUser host = saveUser(prefix + "_h");
        AppUser guest = saveUser(prefix + "_g");
        RoomSnapshot created =
                roomApplicationService.create(
                        host.getId(),
                        host.getNickname());
        roomApplicationService.join(
                created.roomCode(),
                guest.getId(),
                guest.getNickname());
        return new TestRoom(
                created.roomCode(),
                host,
                guest);
    }

    private AppUser saveUser(String prefix) {
        String suffix =
                UUID.randomUUID()
                        .toString()
                        .replace("-", "")
                        .substring(0, 8);
        String loginId = prefix + "_" + suffix;
        String nickname =
                prefix.substring(0, 1) + suffix;
        return appUserRepository.saveAndFlush(
                AppUser.create(
                        loginId,
                        loginId,
                        nickname,
                        nickname,
                        "test-password-hash",
                        USER_CREATED_AT));
    }

    private void cleanDatabase() {
        jdbcClient.sql("DELETE FROM game_action").update();
        jdbcClient.sql("DELETE FROM game_participant").update();
        jdbcClient.sql("DELETE FROM game").update();
        jdbcClient.sql("DELETE FROM app_user").update();
    }

    private record TestRoom(
            String roomCode,
            AppUser host,
            AppUser guest) {
    }
}
