package com.guesspokemon.common.error;

import org.springframework.http.HttpStatus;

public enum ApiErrorCode {

    VALIDATION_FAILED(
            HttpStatus.BAD_REQUEST,
            "입력값 확인 필요",
            "요청 입력값을 확인해 주세요."),
    LOGIN_ID_ALREADY_EXISTS(
            HttpStatus.CONFLICT,
            "회원가입 실패",
            "이미 사용 중인 로그인 ID입니다."),
    NICKNAME_ALREADY_EXISTS(
            HttpStatus.CONFLICT,
            "회원가입 실패",
            "이미 사용 중인 닉네임입니다."),
    INVALID_CREDENTIALS(
            HttpStatus.UNAUTHORIZED,
            "로그인 실패",
            "로그인 ID 또는 비밀번호가 올바르지 않습니다."),
    USER_DISABLED(
            HttpStatus.FORBIDDEN,
            "로그인 실패",
            "사용할 수 없는 계정입니다."),
    AUTHENTICATION_REQUIRED(
            HttpStatus.UNAUTHORIZED,
            "로그인 필요",
            "로그인이 필요한 요청입니다."),
    ACCESS_DENIED(
            HttpStatus.FORBIDDEN,
            "접근 거부",
            "이 요청을 실행할 권한이 없습니다."),
    CSRF_INVALID(
            HttpStatus.FORBIDDEN,
            "요청 검증 실패",
            "CSRF token이 없거나 올바르지 않습니다."),
    RESOURCE_NOT_FOUND(
            HttpStatus.NOT_FOUND,
            "요청 경로 없음",
            "요청한 경로를 찾을 수 없습니다."),
    LOGIN_RATE_LIMITED(
            HttpStatus.TOO_MANY_REQUESTS,
            "로그인 요청 제한",
            "로그인 요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요."),
    SIGNUP_RATE_LIMITED(
            HttpStatus.TOO_MANY_REQUESTS,
            "회원가입 요청 제한",
            "회원가입 요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요."),
    POKEMON_NOT_FOUND(
            HttpStatus.NOT_FOUND,
            "포켓몬 없음",
            "요청한 포켓몬을 찾을 수 없습니다."),
    INTERNAL_ERROR(
            HttpStatus.INTERNAL_SERVER_ERROR,
            "서버 오류",
            "요청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요.");

    private final HttpStatus status;
    private final String title;
    private final String detail;

    ApiErrorCode(HttpStatus status, String title, String detail) {
        this.status = status;
        this.title = title;
        this.detail = detail;
    }

    public HttpStatus status() {
        return status;
    }

    public String title() {
        return title;
    }

    public String detail() {
        return detail;
    }
}
