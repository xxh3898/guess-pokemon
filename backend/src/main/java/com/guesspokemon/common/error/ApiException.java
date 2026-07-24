package com.guesspokemon.common.error;

public class ApiException extends RuntimeException {

    private final ApiErrorCode errorCode;

    public ApiException(ApiErrorCode errorCode) {
        super(errorCode.detail());
        this.errorCode = errorCode;
    }

    public ApiException(ApiErrorCode errorCode, Throwable cause) {
        super(errorCode.detail(), cause);
        this.errorCode = errorCode;
    }

    public ApiErrorCode errorCode() {
        return errorCode;
    }
}
