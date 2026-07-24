package com.guesspokemon.user;

import static com.guesspokemon.common.error.ApiErrorCode.LOGIN_ID_ALREADY_EXISTS;
import static com.guesspokemon.common.error.ApiErrorCode.NICKNAME_ALREADY_EXISTS;

import com.guesspokemon.common.error.ApiException;
import java.time.Instant;
import org.hibernate.exception.ConstraintViolationException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class UserRegistrationService {

    static final String LOGIN_ID_UNIQUE_CONSTRAINT =
            "uk_app_user_login_id_key";
    static final String NICKNAME_UNIQUE_CONSTRAINT =
            "uk_app_user_nickname_key";

    private final AppUserRepository appUserRepository;
    private final UserInputNormalizer userInputNormalizer;
    private final PasswordEncoder passwordEncoder;

    public UserRegistrationService(
            AppUserRepository appUserRepository,
            UserInputNormalizer userInputNormalizer,
            PasswordEncoder passwordEncoder) {
        this.appUserRepository = appUserRepository;
        this.userInputNormalizer = userInputNormalizer;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public AppUser register(
            String loginIdInput,
            String password,
            String nicknameInput) {
        String loginIdKey =
                userInputNormalizer.normalizeLoginId(loginIdInput);
        UserInputNormalizer.NormalizedNickname normalizedNickname =
                userInputNormalizer.normalizeNickname(nicknameInput);
        userInputNormalizer.validateSignupPassword(password);

        if (appUserRepository.existsByLoginIdKey(loginIdKey)) {
            throw new ApiException(LOGIN_ID_ALREADY_EXISTS);
        }
        if (appUserRepository.existsByNicknameKey(normalizedNickname.key())) {
            throw new ApiException(NICKNAME_ALREADY_EXISTS);
        }

        AppUser appUser =
                AppUser.create(
                        loginIdKey,
                        loginIdKey,
                        normalizedNickname.display(),
                        normalizedNickname.key(),
                        passwordEncoder.encode(password),
                        Instant.now());
        try {
            return appUserRepository.saveAndFlush(appUser);
        } catch (DataIntegrityViolationException exception) {
            throw mapUniqueConstraint(exception);
        }
    }

    private RuntimeException mapUniqueConstraint(
            DataIntegrityViolationException exception) {
        String constraintName = findConstraintName(exception);
        if (LOGIN_ID_UNIQUE_CONSTRAINT.equalsIgnoreCase(constraintName)) {
            return new ApiException(LOGIN_ID_ALREADY_EXISTS, exception);
        }
        if (NICKNAME_UNIQUE_CONSTRAINT.equalsIgnoreCase(constraintName)) {
            return new ApiException(NICKNAME_ALREADY_EXISTS, exception);
        }
        return exception;
    }

    private String findConstraintName(Throwable throwable) {
        Throwable current = throwable;
        while (current != null) {
            if (current instanceof ConstraintViolationException constraintViolation) {
                return constraintViolation.getConstraintName();
            }
            current = current.getCause();
        }
        return null;
    }
}
