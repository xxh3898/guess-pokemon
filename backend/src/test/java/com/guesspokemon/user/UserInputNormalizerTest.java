package com.guesspokemon.user;

import static com.guesspokemon.common.error.ApiErrorCode.VALIDATION_FAILED;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.guesspokemon.common.error.ApiException;
import org.junit.jupiter.api.Test;

class UserInputNormalizerTest {

    private final UserInputNormalizer normalizer =
            new UserInputNormalizer();

    @Test
    void should_normalizeLoginId_when_caseAndOuterWhitespaceDiffer() {
        String normalized = normalizer.normalizeLoginId("  Trainer_RED  ");

        assertEquals("trainer_red", normalized);
    }

    @Test
    void should_rejectLoginId_when_formatIsInvalid() {
        ApiException exception =
                assertThrows(
                        ApiException.class,
                        () -> normalizer.normalizeLoginId("red-trainer"));

        assertEquals(VALIDATION_FAILED, exception.errorCode());
    }

    @Test
    void should_createSameNicknameKey_when_compatibilityCharactersDiffer() {
        UserInputNormalizer.NormalizedNickname ascii =
                normalizer.normalizeNickname("Ash");
        UserInputNormalizer.NormalizedNickname fullWidth =
                normalizer.normalizeNickname("Ａｓｈ");

        assertEquals("ash", ascii.key());
        assertEquals(ascii.key(), fullWidth.key());
        assertEquals("Ａｓｈ", fullWidth.display());
    }

    @Test
    void should_rejectNickname_when_htmlDelimiterExists() {
        ApiException exception =
                assertThrows(
                        ApiException.class,
                        () -> normalizer.normalizeNickname("<레드>"));

        assertEquals(VALIDATION_FAILED, exception.errorCode());
    }

    @Test
    void should_acceptPassword_when_utf8LengthIsSeventyTwoBytes() {
        normalizer.validateSignupPassword("가".repeat(24));
    }

    @Test
    void should_rejectPassword_when_utf8LengthExceedsSeventyTwoBytes() {
        ApiException exception =
                assertThrows(
                        ApiException.class,
                        () ->
                                normalizer.validateSignupPassword(
                                        "가".repeat(25)));

        assertEquals(VALIDATION_FAILED, exception.errorCode());
    }
}
