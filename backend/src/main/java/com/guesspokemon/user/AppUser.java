package com.guesspokemon.user;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(
        name = "app_user",
        uniqueConstraints = {
            @UniqueConstraint(
                    name = "uk_app_user_login_id_key",
                    columnNames = "login_id_key"),
            @UniqueConstraint(
                    name = "uk_app_user_nickname_key",
                    columnNames = "nickname_key")
        })
public class AppUser {

    @Id
    @Column(nullable = false)
    private UUID id;

    @Column(name = "login_id", nullable = false, length = 30)
    private String loginId;

    @Column(name = "login_id_key", nullable = false, length = 30)
    private String loginIdKey;

    @Column(nullable = false, length = 16)
    private String nickname;

    @Column(name = "nickname_key", nullable = false, length = 32)
    private String nicknameKey;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private AppUserStatus status;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected AppUser() {
    }

    private AppUser(
            UUID id,
            String loginId,
            String loginIdKey,
            String nickname,
            String nicknameKey,
            String passwordHash,
            AppUserStatus status,
            Instant createdAt,
            Instant updatedAt) {
        this.id = id;
        this.loginId = loginId;
        this.loginIdKey = loginIdKey;
        this.nickname = nickname;
        this.nicknameKey = nicknameKey;
        this.passwordHash = passwordHash;
        this.status = status;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    public static AppUser create(
            String loginId,
            String loginIdKey,
            String nickname,
            String nicknameKey,
            String passwordHash,
            Instant createdAt) {
        return new AppUser(
                UUID.randomUUID(),
                loginId,
                loginIdKey,
                nickname,
                nicknameKey,
                passwordHash,
                AppUserStatus.ACTIVE,
                createdAt,
                createdAt);
    }

    public UUID getId() {
        return id;
    }

    public String getLoginId() {
        return loginId;
    }

    public String getLoginIdKey() {
        return loginIdKey;
    }

    public String getNickname() {
        return nickname;
    }

    public String getNicknameKey() {
        return nicknameKey;
    }

    public String getPasswordHash() {
        return passwordHash;
    }

    public AppUserStatus getStatus() {
        return status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
