package com.guesspokemon.auth;

import static com.guesspokemon.common.error.ApiErrorCode.INVALID_CREDENTIALS;
import static com.guesspokemon.common.error.ApiErrorCode.LOGIN_RATE_LIMITED;
import static com.guesspokemon.common.error.ApiErrorCode.USER_DISABLED;

import com.guesspokemon.auth.AuthDtos.UserSummary;
import com.guesspokemon.common.error.ApiException;
import com.guesspokemon.security.AuthenticatedUser;
import com.guesspokemon.user.UserInputNormalizer;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.DisabledException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.context.SecurityContextHolderStrategy;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.stereotype.Service;

@Service
public class AuthService {

    private final AuthenticationManager authenticationManager;
    private final SecurityContextRepository securityContextRepository;
    private final SessionAuthenticationStrategy sessionAuthenticationStrategy;
    private final UserInputNormalizer userInputNormalizer;
    private final AuthAttemptLimiter authAttemptLimiter;
    private final SecurityContextHolderStrategy securityContextHolderStrategy;

    public AuthService(
            AuthenticationManager authenticationManager,
            SecurityContextRepository securityContextRepository,
            SessionAuthenticationStrategy sessionAuthenticationStrategy,
            UserInputNormalizer userInputNormalizer,
            AuthAttemptLimiter authAttemptLimiter) {
        this.authenticationManager = authenticationManager;
        this.securityContextRepository = securityContextRepository;
        this.sessionAuthenticationStrategy = sessionAuthenticationStrategy;
        this.userInputNormalizer = userInputNormalizer;
        this.authAttemptLimiter = authAttemptLimiter;
        this.securityContextHolderStrategy =
                SecurityContextHolder.getContextHolderStrategy();
    }

    public UserSummary login(
            String loginIdInput,
            String password,
            String clientIp,
            HttpServletRequest request,
            HttpServletResponse response) {
        if (!authAttemptLimiter.tryAcquireLoginAttempt(clientIp)) {
            throw new ApiException(LOGIN_RATE_LIMITED);
        }

        String loginIdKey = normalizeLoginIdForAuthentication(loginIdInput);
        if (authAttemptLimiter.isLoginIdBlocked(loginIdKey)) {
            throw new ApiException(LOGIN_RATE_LIMITED);
        }

        Authentication authentication;
        try {
            authentication =
                    authenticationManager.authenticate(
                            UsernamePasswordAuthenticationToken
                                    .unauthenticated(
                                            loginIdKey,
                                            password));
        } catch (DisabledException exception) {
            throw new ApiException(USER_DISABLED, exception);
        } catch (AuthenticationException exception) {
            authAttemptLimiter.recordLoginFailure(loginIdKey);
            throw new ApiException(INVALID_CREDENTIALS, exception);
        }

        sessionAuthenticationStrategy.onAuthentication(
                authentication,
                request,
                response);
        SecurityContext securityContext =
                securityContextHolderStrategy.createEmptyContext();
        securityContext.setAuthentication(authentication);
        securityContextHolderStrategy.setContext(securityContext);
        securityContextRepository.saveContext(
                securityContext,
                request,
                response);
        authAttemptLimiter.resetLoginFailures(loginIdKey);

        return toUserSummary(authentication);
    }

    public UserSummary currentUser(Authentication authentication) {
        return toUserSummary(authentication);
    }

    private String normalizeLoginIdForAuthentication(String loginIdInput) {
        try {
            return userInputNormalizer.normalizeLoginId(loginIdInput);
        } catch (ApiException exception) {
            throw new ApiException(INVALID_CREDENTIALS, exception);
        }
    }

    private UserSummary toUserSummary(Authentication authentication) {
        if (!(authentication.getPrincipal()
                instanceof AuthenticatedUser authenticatedUser)) {
            throw new IllegalStateException(
                    "Unsupported authenticated principal");
        }
        return new UserSummary(
                authenticatedUser.id(),
                authenticatedUser.loginId(),
                authenticatedUser.nickname());
    }
}
