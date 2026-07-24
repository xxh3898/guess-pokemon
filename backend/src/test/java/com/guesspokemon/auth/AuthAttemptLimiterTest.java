package com.guesspokemon.auth;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.github.benmanes.caffeine.cache.Ticker;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

class AuthAttemptLimiterTest {

    private static final Duration WINDOW = Duration.ofMinutes(10);
    private static final long MAXIMUM_KEYS = 100;
    private static final int LOGIN_ID_LIMIT = 5;
    private static final int LOGIN_IP_LIMIT = 30;
    private static final int SIGNUP_IP_LIMIT = 5;

    private final MutableTicker ticker = new MutableTicker();
    private final AuthAttemptLimiter limiter =
            new AuthAttemptLimiter(
                    ticker,
                    WINDOW,
                    MAXIMUM_KEYS,
                    LOGIN_ID_LIMIT,
                    LOGIN_IP_LIMIT,
                    SIGNUP_IP_LIMIT);

    @Test
    void should_blockLoginId_when_fiveFailuresAreRecorded() {
        for (int attempt = 0; attempt < LOGIN_ID_LIMIT; attempt++) {
            assertFalse(limiter.isLoginIdBlocked("trainer_red"));
            limiter.recordLoginFailure("trainer_red");
        }

        assertTrue(limiter.isLoginIdBlocked("trainer_red"));
    }

    @Test
    void should_allowLoginId_when_successResetsFailures() {
        for (int attempt = 0; attempt < LOGIN_ID_LIMIT; attempt++) {
            limiter.recordLoginFailure("trainer_red");
        }

        limiter.resetLoginFailures("trainer_red");

        assertFalse(limiter.isLoginIdBlocked("trainer_red"));
    }

    @Test
    void should_blockLoginIp_when_thirtyAttemptsAreConsumed() {
        for (int attempt = 0; attempt < LOGIN_IP_LIMIT; attempt++) {
            assertTrue(limiter.tryAcquireLoginAttempt("192.0.2.10"));
        }

        assertFalse(limiter.tryAcquireLoginAttempt("192.0.2.10"));
    }

    @Test
    void should_blockSignupIp_when_fiveAttemptsAreConsumed() {
        for (int attempt = 0; attempt < SIGNUP_IP_LIMIT; attempt++) {
            assertTrue(limiter.tryAcquireSignupAttempt("192.0.2.20"));
        }

        assertFalse(limiter.tryAcquireSignupAttempt("192.0.2.20"));
    }

    @Test
    void should_openNewWindow_when_tenMinutesPass() {
        for (int attempt = 0; attempt < SIGNUP_IP_LIMIT; attempt++) {
            assertTrue(limiter.tryAcquireSignupAttempt("192.0.2.30"));
        }
        assertFalse(limiter.tryAcquireSignupAttempt("192.0.2.30"));

        ticker.advance(WINDOW);

        assertTrue(limiter.tryAcquireSignupAttempt("192.0.2.30"));
    }

    private static final class MutableTicker implements Ticker {

        private final AtomicLong nanos = new AtomicLong();

        @Override
        public long read() {
            return nanos.get();
        }

        void advance(Duration duration) {
            nanos.addAndGet(duration.toNanos());
        }
    }
}
