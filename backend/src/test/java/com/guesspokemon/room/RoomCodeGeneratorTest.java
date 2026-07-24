package com.guesspokemon.room;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Random;
import org.junit.jupiter.api.Test;

class RoomCodeGeneratorTest {

    private final RoomCodeGenerator roomCodeGenerator =
            new RoomCodeGenerator(new Random(3898));

    @Test
    void should_generateAllowedSixCharacterCode_when_requested() {
        for (int attempt = 0; attempt < 1_000; attempt++) {
            String roomCode = roomCodeGenerator.generate();

            assertEquals(RoomCodeGenerator.CODE_LENGTH, roomCode.length());
            assertTrue(RoomCodeGenerator.isAllowedCode(roomCode));
            assertFalse(roomCode.matches(".*[IO01].*"));
        }
    }

    @Test
    void should_rejectCode_when_lengthOrCharacterIsInvalid() {
        assertFalse(RoomCodeGenerator.isAllowedCode("ABC12"));
        assertFalse(RoomCodeGenerator.isAllowedCode("ABC01I"));
        assertFalse(RoomCodeGenerator.isAllowedCode("abc234"));
        assertTrue(RoomCodeGenerator.isAllowedCode("ABC234"));
    }
}
