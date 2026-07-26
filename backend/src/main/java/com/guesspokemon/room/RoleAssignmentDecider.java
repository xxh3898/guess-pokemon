package com.guesspokemon.room;

import java.util.Objects;
import java.util.random.RandomGenerator;

final class RoleAssignmentDecider {

    private final RandomGenerator random;

    RoleAssignmentDecider(RandomGenerator random) {
        this.random = Objects.requireNonNull(random);
    }

    boolean assignHostToPreferredRole() {
        return random.nextBoolean();
    }
}
