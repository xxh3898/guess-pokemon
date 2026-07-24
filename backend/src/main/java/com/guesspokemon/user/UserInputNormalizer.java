package com.guesspokemon.user;

import static com.guesspokemon.common.error.ApiErrorCode.VALIDATION_FAILED;

import com.guesspokemon.common.error.ApiException;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

@Component
public class UserInputNormalizer {

    private static final Pattern LOGIN_ID_PATTERN =
            Pattern.compile("^[a-z0-9_]{4,30}$");
    private static final int MIN_NICKNAME_CODE_POINTS = 2;
    private static final int MAX_NICKNAME_CODE_POINTS = 16;
    private static final int MAX_NICKNAME_KEY_LENGTH = 32;
    private static final int MIN_PASSWORD_BYTES = 8;
    private static final int MAX_PASSWORD_BYTES = 72;

    public String normalizeLoginId(String input) {
        if (input == null) {
            throw new ApiException(VALIDATION_FAILED);
        }

        String normalized = input.strip().toLowerCase(Locale.ROOT);
        if (!LOGIN_ID_PATTERN.matcher(normalized).matches()) {
            throw new ApiException(VALIDATION_FAILED);
        }
        return normalized;
    }

    public NormalizedNickname normalizeNickname(String input) {
        if (input == null) {
            throw new ApiException(VALIDATION_FAILED);
        }

        String display =
                Normalizer.normalize(input.strip(), Normalizer.Form.NFC);
        int codePointLength =
                display.codePointCount(0, display.length());
        if (codePointLength < MIN_NICKNAME_CODE_POINTS
                || codePointLength > MAX_NICKNAME_CODE_POINTS
                || containsForbiddenNicknameCharacter(display)) {
            throw new ApiException(VALIDATION_FAILED);
        }

        String key =
                Normalizer.normalize(display, Normalizer.Form.NFKC)
                        .toLowerCase(Locale.ROOT);
        if (key.length() > MAX_NICKNAME_KEY_LENGTH) {
            throw new ApiException(VALIDATION_FAILED);
        }
        return new NormalizedNickname(display, key);
    }

    public void validateSignupPassword(String password) {
        if (password == null) {
            throw new ApiException(VALIDATION_FAILED);
        }

        int byteLength = password.getBytes(StandardCharsets.UTF_8).length;
        if (byteLength < MIN_PASSWORD_BYTES || byteLength > MAX_PASSWORD_BYTES) {
            throw new ApiException(VALIDATION_FAILED);
        }
    }

    private boolean containsForbiddenNicknameCharacter(String nickname) {
        if (nickname.indexOf('<') >= 0 || nickname.indexOf('>') >= 0) {
            return true;
        }
        return nickname.codePoints()
                .anyMatch(
                        codePoint ->
                                Character.isISOControl(codePoint)
                                        || Character.getType(codePoint)
                                                == Character.FORMAT);
    }

    public record NormalizedNickname(String display, String key) {
    }
}
