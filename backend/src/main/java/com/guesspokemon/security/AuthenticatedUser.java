package com.guesspokemon.security;

import com.guesspokemon.user.AppUser;
import com.guesspokemon.user.AppUserStatus;
import java.io.Serial;
import java.io.Serializable;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.CredentialsContainer;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

public final class AuthenticatedUser
        implements UserDetails, CredentialsContainer, Serializable {

    @Serial
    private static final long serialVersionUID = 1L;

    private static final List<GrantedAuthority> AUTHORITIES =
            List.of(new SimpleGrantedAuthority("ROLE_USER"));

    private final UUID id;
    private final String loginId;
    private final String nickname;
    private final boolean enabled;
    private transient String passwordHash;

    private AuthenticatedUser(
            UUID id,
            String loginId,
            String nickname,
            String passwordHash,
            boolean enabled) {
        this.id = id;
        this.loginId = loginId;
        this.nickname = nickname;
        this.passwordHash = passwordHash;
        this.enabled = enabled;
    }

    public static AuthenticatedUser from(AppUser appUser) {
        return new AuthenticatedUser(
                appUser.getId(),
                appUser.getLoginId(),
                appUser.getNickname(),
                appUser.getPasswordHash(),
                appUser.getStatus() == AppUserStatus.ACTIVE);
    }

    public UUID id() {
        return id;
    }

    public String loginId() {
        return loginId;
    }

    public String nickname() {
        return nickname;
    }

    @Override
    public Collection<? extends GrantedAuthority> getAuthorities() {
        return AUTHORITIES;
    }

    @Override
    public String getPassword() {
        return passwordHash;
    }

    @Override
    public String getUsername() {
        return id.toString();
    }

    @Override
    public boolean isEnabled() {
        return enabled;
    }

    @Override
    public void eraseCredentials() {
        passwordHash = null;
    }
}
