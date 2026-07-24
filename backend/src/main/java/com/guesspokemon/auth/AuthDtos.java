package com.guesspokemon.auth;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.UUID;

public final class AuthDtos {

    private AuthDtos() {
    }

    public static final class SignupRequest {

        @NotBlank
        @Size(max = 100)
        private String loginId;

        @NotBlank
        @Size(max = 200)
        private String password;

        @NotBlank
        @Size(max = 100)
        private String nickname;

        public SignupRequest() {
        }

        public String getLoginId() {
            return loginId;
        }

        public String getPassword() {
            return password;
        }

        public String getNickname() {
            return nickname;
        }
    }

    public static final class LoginRequest {

        @NotBlank
        @Size(max = 100)
        private String loginId;

        @NotBlank
        @Size(max = 200)
        private String password;

        public LoginRequest() {
        }

        public String getLoginId() {
            return loginId;
        }

        public String getPassword() {
            return password;
        }
    }

    public record UserSummary(UUID id, String loginId, String nickname) {
    }

    public record AuthResponse(UserSummary user) {
    }

    public record CurrentUserResponse(
            UserSummary user,
            String activeRoomCode) {
    }

    public record CsrfResponse(
            String headerName,
            String parameterName,
            String token) {
    }
}
