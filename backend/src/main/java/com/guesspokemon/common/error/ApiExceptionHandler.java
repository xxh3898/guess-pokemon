package com.guesspokemon.common.error;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import java.net.URI;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ProblemDetail;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger LOGGER = LoggerFactory.getLogger(ApiExceptionHandler.class);
    private static final int TRACE_ID_LENGTH = 8;
    private static final int RATE_LIMIT_RETRY_AFTER_SECONDS = 600;

    @ExceptionHandler(ApiException.class)
    ResponseEntity<ProblemDetail> handleApiException(
            ApiException exception,
            HttpServletRequest request) {
        return createResponse(exception.errorCode(), request);
    }

    @ExceptionHandler({
        MethodArgumentNotValidException.class,
        ConstraintViolationException.class,
        HttpMessageNotReadableException.class
    })
    ResponseEntity<ProblemDetail> handleValidationException(
            Exception exception,
            HttpServletRequest request) {
        return createResponse(ApiErrorCode.VALIDATION_FAILED, request);
    }

    @ExceptionHandler(NoResourceFoundException.class)
    ResponseEntity<ProblemDetail> handleNoResourceFoundException(
            NoResourceFoundException exception,
            HttpServletRequest request) {
        return createResponse(ApiErrorCode.RESOURCE_NOT_FOUND, request);
    }

    @ExceptionHandler(Exception.class)
    ResponseEntity<ProblemDetail> handleUnexpectedException(
            Exception exception,
            HttpServletRequest request) {
        String traceId = newTraceId();
        LOGGER.error(
                "Unhandled API exception traceId={} exceptionType={}",
                traceId,
                exception.getClass().getName());
        return createResponse(ApiErrorCode.INTERNAL_ERROR, request, traceId);
    }

    private ResponseEntity<ProblemDetail> createResponse(
            ApiErrorCode errorCode,
            HttpServletRequest request) {
        return createResponse(errorCode, request, newTraceId());
    }

    private ResponseEntity<ProblemDetail> createResponse(
            ApiErrorCode errorCode,
            HttpServletRequest request,
            String traceId) {
        ProblemDetail problemDetail =
                ProblemDetail.forStatusAndDetail(errorCode.status(), errorCode.detail());
        problemDetail.setTitle(errorCode.title());
        problemDetail.setInstance(URI.create(request.getRequestURI()));
        problemDetail.setProperty("code", errorCode.name());
        problemDetail.setProperty("traceId", traceId);

        ResponseEntity.BodyBuilder responseBuilder =
                ResponseEntity.status(errorCode.status())
                        .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                        .cacheControl(CacheControl.noStore());
        if (errorCode.status().value() == 429) {
            responseBuilder.header(
                    "Retry-After",
                    Integer.toString(RATE_LIMIT_RETRY_AFTER_SECONDS));
        }
        return responseBuilder.body(problemDetail);
    }

    private String newTraceId() {
        return UUID.randomUUID().toString().substring(0, TRACE_ID_LENGTH);
    }
}
