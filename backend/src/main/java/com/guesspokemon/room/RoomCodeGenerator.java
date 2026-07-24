package com.guesspokemon.room;

import java.util.Objects;
import java.util.random.RandomGenerator;

public final class RoomCodeGenerator {

    static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    static final int CODE_LENGTH = 6;

    private final RandomGenerator randomGenerator;

    RoomCodeGenerator(RandomGenerator randomGenerator) {
        this.randomGenerator = Objects.requireNonNull(randomGenerator);
    }

    String generate() {
        StringBuilder code = new StringBuilder(CODE_LENGTH);
        for (int index = 0; index < CODE_LENGTH; index++) {
            code.append(
                    ALPHABET.charAt(
                            randomGenerator.nextInt(ALPHABET.length())));
        }
        return code.toString();
    }

    static boolean isAllowedCode(String code) {
        if (code == null || code.length() != CODE_LENGTH) {
            return false;
        }
        return code.chars()
                .allMatch(character -> ALPHABET.indexOf(character) >= 0);
    }
}
