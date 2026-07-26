package com.guesspokemon.room;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.random.RandomGenerator;
import org.junit.jupiter.api.Test;

class RoleAssignmentDeciderTest {

    @Test
    void should_returnRandomDecision_when_assignmentConflicts() {
        RoleAssignmentDecider hostWins =
                new RoleAssignmentDecider(
                        new FixedBooleanRandomGenerator(true));
        RoleAssignmentDecider guestWins =
                new RoleAssignmentDecider(
                        new FixedBooleanRandomGenerator(false));

        assertTrue(hostWins.assignHostToPreferredRole());
        assertFalse(guestWins.assignHostToPreferredRole());
    }

    private static final class FixedBooleanRandomGenerator
            implements RandomGenerator {

        private final boolean value;

        private FixedBooleanRandomGenerator(boolean value) {
            this.value = value;
        }

        @Override
        public long nextLong() {
            return value ? 1L : 0L;
        }

        @Override
        public boolean nextBoolean() {
            return value;
        }
    }
}
