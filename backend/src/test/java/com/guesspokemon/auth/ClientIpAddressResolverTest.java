package com.guesspokemon.auth;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

class ClientIpAddressResolverTest {

    private final ClientIpAddressResolver resolver =
            new ClientIpAddressResolver();

    @Test
    void should_returnServletRemoteAddress_when_proxyAlreadyNormalizedRequest() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("203.0.113.25");
        request.addHeader("X-Forwarded-For", "198.51.100.99");

        assertEquals("203.0.113.25", resolver.resolve(request));
    }

    @Test
    void should_returnUnknownAddress_when_remoteAddressIsBlank() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr(" ");

        assertEquals("unknown", resolver.resolve(request));
    }
}
