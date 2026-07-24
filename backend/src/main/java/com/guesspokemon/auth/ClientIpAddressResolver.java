package com.guesspokemon.auth;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.stereotype.Component;

@Component
public class ClientIpAddressResolver {

    private static final String UNKNOWN_ADDRESS = "unknown";

    public String resolve(HttpServletRequest request) {
        String remoteAddress = request.getRemoteAddr();
        if (remoteAddress == null || remoteAddress.isBlank()) {
            return UNKNOWN_ADDRESS;
        }
        return remoteAddress.strip();
    }
}
