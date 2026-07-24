package com.guesspokemon.security;

import com.guesspokemon.common.error.ApiException;
import com.guesspokemon.user.AppUser;
import com.guesspokemon.user.AppUserRepository;
import com.guesspokemon.user.UserInputNormalizer;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AppUserDetailsService implements UserDetailsService {

    private final AppUserRepository appUserRepository;
    private final UserInputNormalizer userInputNormalizer;

    public AppUserDetailsService(
            AppUserRepository appUserRepository,
            UserInputNormalizer userInputNormalizer) {
        this.appUserRepository = appUserRepository;
        this.userInputNormalizer = userInputNormalizer;
    }

    @Override
    @Transactional(readOnly = true)
    public UserDetails loadUserByUsername(String username) {
        String loginIdKey;
        try {
            loginIdKey = userInputNormalizer.normalizeLoginId(username);
        } catch (ApiException exception) {
            throw new UsernameNotFoundException("User not found");
        }

        AppUser appUser =
                appUserRepository
                        .findByLoginIdKey(loginIdKey)
                        .orElseThrow(
                                () -> new UsernameNotFoundException("User not found"));
        return AuthenticatedUser.from(appUser);
    }
}
