package com.guesspokemon.auth;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.Ticker;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.stereotype.Component;

@Component
public class AuthAttemptLimiter {

    static final Duration WINDOW = Duration.ofMinutes(10);
    static final long MAXIMUM_KEYS = 10_000;
    static final int LOGIN_FAILURE_LIMIT_PER_ID = 5;
    static final int LOGIN_ATTEMPT_LIMIT_PER_IP = 30;
    static final int SIGNUP_ATTEMPT_LIMIT_PER_IP = 5;

    private final Cache<String, AtomicInteger> loginFailuresById;
    private final Cache<String, AtomicInteger> loginAttemptsByIp;
    private final Cache<String, AtomicInteger> signupAttemptsByIp;
    private final int loginFailureLimitPerId;
    private final int loginAttemptLimitPerIp;
    private final int signupAttemptLimitPerIp;

    public AuthAttemptLimiter() {
        this(
                Ticker.systemTicker(),
                WINDOW,
                MAXIMUM_KEYS,
                LOGIN_FAILURE_LIMIT_PER_ID,
                LOGIN_ATTEMPT_LIMIT_PER_IP,
                SIGNUP_ATTEMPT_LIMIT_PER_IP);
    }

    AuthAttemptLimiter(
            Ticker ticker,
            Duration window,
            long maximumKeys,
            int loginFailureLimitPerId,
            int loginAttemptLimitPerIp,
            int signupAttemptLimitPerIp) {
        loginFailuresById = createCache(ticker, window, maximumKeys);
        loginAttemptsByIp = createCache(ticker, window, maximumKeys);
        signupAttemptsByIp = createCache(ticker, window, maximumKeys);
        this.loginFailureLimitPerId = loginFailureLimitPerId;
        this.loginAttemptLimitPerIp = loginAttemptLimitPerIp;
        this.signupAttemptLimitPerIp = signupAttemptLimitPerIp;
    }

    public boolean tryAcquireLoginAttempt(String clientIp) {
        return incrementWithinLimit(
                loginAttemptsByIp,
                clientIp,
                loginAttemptLimitPerIp);
    }

    public boolean tryAcquireSignupAttempt(String clientIp) {
        return incrementWithinLimit(
                signupAttemptsByIp,
                clientIp,
                signupAttemptLimitPerIp);
    }

    public boolean isLoginIdBlocked(String loginIdKey) {
        AtomicInteger failures = loginFailuresById.getIfPresent(loginIdKey);
        return failures != null
                && failures.get() >= loginFailureLimitPerId;
    }

    public void recordLoginFailure(String loginIdKey) {
        AtomicInteger failures =
                loginFailuresById.get(
                        loginIdKey,
                        ignored -> new AtomicInteger());
        failures.updateAndGet(
                current -> Math.min(current + 1, loginFailureLimitPerId));
    }

    public void resetLoginFailures(String loginIdKey) {
        loginFailuresById.invalidate(loginIdKey);
    }

    private Cache<String, AtomicInteger> createCache(
            Ticker ticker,
            Duration window,
            long maximumKeys) {
        return Caffeine.newBuilder()
                .ticker(ticker)
                .maximumSize(maximumKeys)
                .expireAfterWrite(window)
                .build();
    }

    private boolean incrementWithinLimit(
            Cache<String, AtomicInteger> cache,
            String key,
            int limit) {
        AtomicInteger attempts =
                cache.get(key, ignored -> new AtomicInteger());
        int current =
                attempts.updateAndGet(
                        previous ->
                                previous >= limit
                                        ? limit + 1
                                        : previous + 1);
        return current <= limit;
    }
}
