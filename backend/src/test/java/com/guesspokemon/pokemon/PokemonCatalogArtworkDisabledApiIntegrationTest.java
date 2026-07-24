package com.guesspokemon.pokemon;

import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(
        properties = "pokemon.catalog.artwork-enabled=false")
@AutoConfigureMockMvc
@Import(PostgreSqlTestContainerConfiguration.class)
class PokemonCatalogArtworkDisabledApiIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    @WithMockUser(username = "catalog-member")
    void should_hideArtworkUrl_when_globalKillSwitchIsDisabled()
            throws Exception {
        mockMvc.perform(get("/api/v1/pokemon-species/25"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.artworkEnabled").value(false))
                .andExpect(jsonPath("$.artworkUrl", nullValue()));
    }
}
