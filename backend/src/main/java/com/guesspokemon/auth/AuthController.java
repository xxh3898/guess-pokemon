package com.guesspokemon.auth;

import static com.guesspokemon.common.error.ApiErrorCode.SIGNUP_RATE_LIMITED;

import com.guesspokemon.auth.AuthDtos.AuthResponse;
import com.guesspokemon.auth.AuthDtos.CsrfResponse;
import com.guesspokemon.auth.AuthDtos.CurrentUserResponse;
import com.guesspokemon.auth.AuthDtos.LoginRequest;
import com.guesspokemon.auth.AuthDtos.SignupRequest;
import com.guesspokemon.auth.AuthDtos.UserSummary;
import com.guesspokemon.common.error.ApiException;
import com.guesspokemon.room.RoomRegistry;
import com.guesspokemon.user.AppUser;
import com.guesspokemon.user.UserRegistrationService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.web.authentication.logout.LogoutHandler;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final UserRegistrationService userRegistrationService;
    private final AuthService authService;
    private final AuthAttemptLimiter authAttemptLimiter;
    private final ClientIpAddressResolver clientIpAddressResolver;
    private final LogoutHandler logoutHandler;
    private final RoomRegistry roomRegistry;

    public AuthController(
            UserRegistrationService userRegistrationService,
            AuthService authService,
            AuthAttemptLimiter authAttemptLimiter,
            ClientIpAddressResolver clientIpAddressResolver,
            LogoutHandler logoutHandler,
            RoomRegistry roomRegistry) {
        this.userRegistrationService = userRegistrationService;
        this.authService = authService;
        this.authAttemptLimiter = authAttemptLimiter;
        this.clientIpAddressResolver = clientIpAddressResolver;
        this.logoutHandler = logoutHandler;
        this.roomRegistry = roomRegistry;
    }

    @GetMapping("/csrf")
    CsrfResponse csrf(CsrfToken csrfToken) {
        return new CsrfResponse(
                csrfToken.getHeaderName(),
                csrfToken.getParameterName(),
                csrfToken.getToken());
    }

    @PostMapping("/signup")
    ResponseEntity<AuthResponse> signup(
            @Valid @RequestBody SignupRequest signupRequest,
            HttpServletRequest request) {
        String clientIp = clientIpAddressResolver.resolve(request);
        if (!authAttemptLimiter.tryAcquireSignupAttempt(clientIp)) {
            throw new ApiException(SIGNUP_RATE_LIMITED);
        }

        AppUser appUser =
                userRegistrationService.register(
                        signupRequest.getLoginId(),
                        signupRequest.getPassword(),
                        signupRequest.getNickname());
        UserSummary userSummary =
                new UserSummary(
                        appUser.getId(),
                        appUser.getLoginId(),
                        appUser.getNickname());
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(new AuthResponse(userSummary));
    }

    @PostMapping("/login")
    AuthResponse login(
            @Valid @RequestBody LoginRequest loginRequest,
            HttpServletRequest request,
            HttpServletResponse response) {
        UserSummary userSummary =
                authService.login(
                        loginRequest.getLoginId(),
                        loginRequest.getPassword(),
                        clientIpAddressResolver.resolve(request),
                        request,
                        response);
        return new AuthResponse(userSummary);
    }

    @PostMapping("/logout")
    ResponseEntity<Void> logout(
            HttpServletRequest request,
            HttpServletResponse response,
            Authentication authentication) {
        logoutHandler.logout(request, response, authentication);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me")
    CurrentUserResponse currentUser(Authentication authentication) {
        UserSummary userSummary = authService.currentUser(authentication);
        return new CurrentUserResponse(
                userSummary,
                roomRegistry
                        .findActiveRoomCode(userSummary.id())
                        .orElse(null));
    }
}
