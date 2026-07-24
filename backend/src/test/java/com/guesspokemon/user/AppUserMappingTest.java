package com.guesspokemon.user;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Import(PostgreSqlTestContainerConfiguration.class)
@Transactional
class AppUserMappingTest {

    @Autowired
    private AppUserRepository appUserRepository;

    @Autowired
    private JdbcClient jdbcClient;

    @Test
    void should_persistUser_when_mappingMatchesMigration() {
        AppUser appUser =
                appUserRepository.saveAndFlush(
                        newUser("trainer_red", "red"));

        AppUser loaded =
                appUserRepository.findById(appUser.getId()).orElseThrow();

        assertEquals("trainer_red", loaded.getLoginIdKey());
        assertEquals(AppUserStatus.ACTIVE, loaded.getStatus());
        assertTrue(loaded.getPasswordHash().startsWith("{bcrypt}"));
    }

    @Test
    void should_rejectDuplicateLoginId_when_uniqueConstraintIsViolated() {
        appUserRepository.saveAndFlush(
                newUser("trainer_red", "red"));

        assertThrows(
                DataIntegrityViolationException.class,
                () ->
                        appUserRepository.saveAndFlush(
                                newUser("trainer_red", "blue")));
    }

    @Test
    void should_rejectUnknownStatus_when_checkConstraintIsViolated() {
        assertThrows(
                DataIntegrityViolationException.class,
                () ->
                        jdbcClient
                                .sql(
                                        """
                                        INSERT INTO app_user (
                                            id,
                                            login_id,
                                            login_id_key,
                                            nickname,
                                            nickname_key,
                                            password_hash,
                                            status,
                                            created_at,
                                            updated_at
                                        ) VALUES (
                                            gen_random_uuid(),
                                            'trainer_red',
                                            'trainer_red',
                                            '레드',
                                            'red',
                                            '{bcrypt}test',
                                            'UNKNOWN',
                                            CURRENT_TIMESTAMP,
                                            CURRENT_TIMESTAMP
                                        )
                                        """)
                                .update());
    }

    private AppUser newUser(String loginId, String nicknameKey) {
        return AppUser.create(
                loginId,
                loginId,
                nicknameKey,
                nicknameKey,
                "{bcrypt}test",
                Instant.parse("2026-07-25T00:00:00Z"));
    }
}
