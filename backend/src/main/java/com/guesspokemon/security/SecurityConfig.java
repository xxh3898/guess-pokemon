package com.guesspokemon.security;

import static com.guesspokemon.common.error.ApiErrorCode.ACCESS_DENIED;
import static com.guesspokemon.common.error.ApiErrorCode.AUTHENTICATION_REQUIRED;
import static com.guesspokemon.common.error.ApiErrorCode.CSRF_INVALID;

import com.guesspokemon.common.error.ApiException;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.ProviderManager;
import org.springframework.security.authentication.dao.DaoAuthenticationProvider;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.logout.CookieClearingLogoutHandler;
import org.springframework.security.web.authentication.logout.LogoutHandler;
import org.springframework.security.web.authentication.logout.SecurityContextLogoutHandler;
import org.springframework.security.web.authentication.session.ChangeSessionIdAuthenticationStrategy;
import org.springframework.security.web.authentication.session.SessionAuthenticationStrategy;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.security.web.csrf.CsrfException;
import org.springframework.security.web.csrf.HttpSessionCsrfTokenRepository;
import org.springframework.session.web.http.CookieSerializer;
import org.springframework.session.web.http.DefaultCookieSerializer;
import org.springframework.web.servlet.HandlerExceptionResolver;

@Configuration(proxyBeanMethods = false)
public class SecurityConfig {

    @Bean
    PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    @Bean
    AuthenticationManager authenticationManager(
            AppUserDetailsService appUserDetailsService,
            PasswordEncoder passwordEncoder) {
        DaoAuthenticationProvider authenticationProvider =
                new DaoAuthenticationProvider(appUserDetailsService);
        authenticationProvider.setPasswordEncoder(passwordEncoder);
        return new ProviderManager(authenticationProvider);
    }

    @Bean
    SecurityContextRepository securityContextRepository() {
        return new HttpSessionSecurityContextRepository();
    }

    @Bean
    SessionAuthenticationStrategy sessionAuthenticationStrategy() {
        return new ChangeSessionIdAuthenticationStrategy();
    }

    @Bean
    HttpSessionCsrfTokenRepository csrfTokenRepository() {
        HttpSessionCsrfTokenRepository repository =
                new HttpSessionCsrfTokenRepository();
        repository.setHeaderName("X-XSRF-TOKEN");
        return repository;
    }

    @Bean
    CookieSerializer cookieSerializer(
            @Value("${server.servlet.session.cookie.http-only:true}")
                    boolean httpOnly,
            @Value("${server.servlet.session.cookie.same-site:Lax}")
                    String sameSite,
            @Value("${server.servlet.session.cookie.secure:false}")
                    boolean secure) {
        DefaultCookieSerializer cookieSerializer =
                new DefaultCookieSerializer();
        cookieSerializer.setCookieName("SESSION");
        cookieSerializer.setUseHttpOnlyCookie(httpOnly);
        cookieSerializer.setSameSite(sameSite);
        cookieSerializer.setUseSecureCookie(secure);
        return cookieSerializer;
    }

    @Bean
    LogoutHandler logoutHandler() {
        SecurityContextLogoutHandler securityContextLogoutHandler =
                new SecurityContextLogoutHandler();
        CookieClearingLogoutHandler cookieClearingLogoutHandler =
                new CookieClearingLogoutHandler("SESSION");
        return (request, response, authentication) -> {
            securityContextLogoutHandler.logout(
                    request,
                    response,
                    authentication);
            cookieClearingLogoutHandler.logout(
                    request,
                    response,
                    authentication);
            SecurityContextHolder.clearContext();
        };
    }

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            HttpSessionCsrfTokenRepository csrfTokenRepository,
            SecurityContextRepository securityContextRepository,
            SessionAuthenticationStrategy sessionAuthenticationStrategy,
            @Qualifier("handlerExceptionResolver")
                    HandlerExceptionResolver handlerExceptionResolver)
            throws Exception {
        http.csrf(
                        csrf ->
                                csrf.csrfTokenRepository(
                                        csrfTokenRepository))
                .securityContext(
                        securityContext ->
                                securityContext
                                        .requireExplicitSave(true)
                                        .securityContextRepository(
                                                securityContextRepository))
                .sessionManagement(
                        session ->
                                session.sessionAuthenticationStrategy(
                                        sessionAuthenticationStrategy))
                .authorizeHttpRequests(
                        authorization ->
                                authorization
                                        .requestMatchers(
                                                HttpMethod.GET,
                                                "/api/v1/auth/csrf",
                                                "/actuator/health/liveness",
                                                "/actuator/health/readiness")
                                        .permitAll()
                                        .requestMatchers(
                                                HttpMethod.POST,
                                                "/api/v1/auth/signup",
                                                "/api/v1/auth/login")
                                        .anonymous()
                                        .requestMatchers("/api/**")
                                        .authenticated()
                                        .anyRequest()
                                        .permitAll())
                .exceptionHandling(
                        exceptions ->
                                exceptions
                                        .authenticationEntryPoint(
                                                (request, response, exception) ->
                                                        handlerExceptionResolver
                                                                .resolveException(
                                                                        request,
                                                                        response,
                                                                        null,
                                                                        new ApiException(
                                                                                AUTHENTICATION_REQUIRED,
                                                                                exception)))
                                        .accessDeniedHandler(
                                                (request, response, exception) ->
                                                        handlerExceptionResolver
                                                                .resolveException(
                                                                        request,
                                                                        response,
                                                                        null,
                                                                        new ApiException(
                                                                                exception
                                                                                                instanceof CsrfException
                                                                                        ? CSRF_INVALID
                                                                                        : ACCESS_DENIED,
                                                                                exception))))
                .requestCache(requestCache -> requestCache.disable())
                .formLogin(formLogin -> formLogin.disable())
                .httpBasic(httpBasic -> httpBasic.disable())
                .logout(logout -> logout.disable());
        return http.build();
    }
}
