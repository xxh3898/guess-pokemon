package com.guesspokemon.user;

import static com.guesspokemon.common.error.ApiErrorCode.LOGIN_ID_ALREADY_EXISTS;
import static com.guesspokemon.common.error.ApiErrorCode.NICKNAME_ALREADY_EXISTS;
import static org.junit.jupiter.api.Assertions.assertEquals;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import com.guesspokemon.common.error.ApiErrorCode;
import com.guesspokemon.common.error.ApiException;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;

@SpringBootTest
@Import(PostgreSqlTestContainerConfiguration.class)
class UserRegistrationServiceIntegrationTest {

    private static final String VALID_PASSWORD = "valid-password-123";

    @Autowired
    private UserRegistrationService userRegistrationService;

    @Autowired
    private AppUserRepository appUserRepository;

    @BeforeEach
    void setUp() {
        appUserRepository.deleteAll();
    }

    @Test
    void should_returnLoginIdConflict_when_concurrentSignupsUseSameLoginId()
            throws Exception {
        List<RegistrationResult> results =
                registerConcurrently(
                        new RegistrationInput(
                                "trainer_red",
                                "레드"),
                        new RegistrationInput(
                                "trainer_red",
                                "그린"));

        assertConcurrentResult(results, LOGIN_ID_ALREADY_EXISTS);
    }

    @Test
    void should_returnNicknameConflict_when_concurrentSignupsUseSameNickname()
            throws Exception {
        List<RegistrationResult> results =
                registerConcurrently(
                        new RegistrationInput(
                                "trainer_red",
                                "레드"),
                        new RegistrationInput(
                                "trainer_blue",
                                "레드"));

        assertConcurrentResult(results, NICKNAME_ALREADY_EXISTS);
    }

    private List<RegistrationResult> registerConcurrently(
            RegistrationInput first,
            RegistrationInput second)
            throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        try (ExecutorService executor = Executors.newFixedThreadPool(2)) {
            Future<RegistrationResult> firstResult =
                    executor.submit(() -> registerAfterSignal(start, first));
            Future<RegistrationResult> secondResult =
                    executor.submit(() -> registerAfterSignal(start, second));

            start.countDown();

            return List.of(firstResult.get(), secondResult.get());
        }
    }

    private RegistrationResult registerAfterSignal(
            CountDownLatch start,
            RegistrationInput input)
            throws InterruptedException {
        start.await();
        try {
            userRegistrationService.register(
                    input.loginId(),
                    VALID_PASSWORD,
                    input.nickname());
            return RegistrationResult.succeeded();
        } catch (ApiException exception) {
            return RegistrationResult.failed(exception.errorCode());
        }
    }

    private void assertConcurrentResult(
            List<RegistrationResult> results,
            ApiErrorCode expectedConflict) {
        long successCount =
                results.stream()
                        .filter(RegistrationResult::success)
                        .count();
        long expectedConflictCount =
                results.stream()
                        .filter(
                                result ->
                                        expectedConflict
                                                == result.errorCode())
                        .count();

        assertEquals(1L, successCount);
        assertEquals(1L, expectedConflictCount);
        assertEquals(1L, appUserRepository.count());
    }

    private record RegistrationInput(String loginId, String nickname) {
    }

    private record RegistrationResult(
            boolean success,
            ApiErrorCode errorCode) {

        static RegistrationResult succeeded() {
            return new RegistrationResult(true, null);
        }

        static RegistrationResult failed(ApiErrorCode errorCode) {
            return new RegistrationResult(false, errorCode);
        }
    }
}
