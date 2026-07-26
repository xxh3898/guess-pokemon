package com.guesspokemon.room;

import java.security.SecureRandom;
import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration(proxyBeanMethods = false)
@EnableScheduling
public class RoomConfiguration {

    @Bean
    Clock roomClock() {
        return Clock.systemUTC();
    }

    @Bean
    RoomCodeGenerator roomCodeGenerator() {
        return new RoomCodeGenerator(new SecureRandom());
    }

    @Bean
    RoleAssignmentDecider roleAssignmentDecider() {
        return new RoleAssignmentDecider(new SecureRandom());
    }

    @Bean
    RoomRegistry roomRegistry(
            RoomCodeGenerator roomCodeGenerator,
            Clock roomClock) {
        return new RoomRegistry(
                roomCodeGenerator,
                roomClock,
                RoomRegistry.WAITING_EXPIRY,
                RoomRegistry.EXPIRED_CODE_RETENTION,
                RoomRegistry.MAX_ACTIVE_ROOMS,
                RoomRegistry.MAX_CODE_ALLOCATION_ATTEMPTS,
                RoomRegistry.MAX_EXPIRED_CODE_TOMBSTONES);
    }
}
