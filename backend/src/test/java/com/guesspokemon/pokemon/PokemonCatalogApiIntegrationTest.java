package com.guesspokemon.pokemon;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.guesspokemon.PostgreSqlTestContainerConfiguration;
import java.text.Normalizer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@Import(PostgreSqlTestContainerConfiguration.class)
class PokemonCatalogApiIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcClient jdbcClient;

    @Test
    @WithMockUser(username = "catalog-member")
    void should_returnNationalDexPage_when_memberRequestsDefaultList()
            throws Exception {
        mockMvc.perform(get("/api/v1/pokemon-species"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(20))
                .andExpect(jsonPath("$.content[0].nationalDexId").value(1))
                .andExpect(jsonPath("$.content[0].koreanName").value("이상해씨"))
                .andExpect(jsonPath("$.content[0].generation").value(1))
                .andExpect(jsonPath("$.content[0].artworkEnabled").value(true))
                .andExpect(jsonPath("$.content[0].types[0]").value("GRASS"))
                .andExpect(jsonPath("$.content[0].types[1]").value("POISON"))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.totalElements").value(1025))
                .andExpect(jsonPath("$.totalPages").value(52));
    }

    @Test
    @WithMockUser(username = "catalog-member")
    void should_searchKoreanName_when_queryContainsPartialName()
            throws Exception {
        mockMvc.perform(
                        get("/api/v1/pokemon-species")
                                .queryParam("query", "  피카  "))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].nationalDexId").value(25))
                .andExpect(jsonPath("$.content[0].koreanName").value("피카츄"))
                .andExpect(jsonPath("$.content[0].types.length()").value(1))
                .andExpect(jsonPath("$.content[0].types[0]").value("ELECTRIC"));
    }

    @Test
    @WithMockUser(username = "catalog-member")
    void should_searchKoreanName_when_queryUsesDecomposedUnicode()
            throws Exception {
        String decomposedQuery =
                Normalizer.normalize("피카", Normalizer.Form.NFD);

        mockMvc.perform(
                        get("/api/v1/pokemon-species")
                                .queryParam("query", decomposedQuery))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].nationalDexId").value(25))
                .andExpect(jsonPath("$.content[0].koreanName").value("피카츄"));
    }

    @Test
    @WithMockUser(username = "catalog-member")
    void should_searchExactNationalDexId_when_queryContainsOnlyDigits()
            throws Exception {
        mockMvc.perform(
                        get("/api/v1/pokemon-species")
                                .queryParam("query", "0025"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].nationalDexId").value(25));
    }

    @Test
    @WithMockUser(username = "catalog-member")
    void should_filterAndPaginate_when_generationAndPageAreGiven()
            throws Exception {
        mockMvc.perform(
                        get("/api/v1/pokemon-species")
                                .queryParam("generation", "9")
                                .queryParam("page", "1")
                                .queryParam("size", "100"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(20))
                .andExpect(jsonPath("$.content[0].nationalDexId").value(1006))
                .andExpect(jsonPath("$.totalElements").value(120))
                .andExpect(jsonPath("$.totalPages").value(2));
    }

    @Test
    @WithMockUser(username = "catalog-member")
    void should_returnPokemonSummary_when_nationalDexIdExists()
            throws Exception {
        mockMvc.perform(get("/api/v1/pokemon-species/1025"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nationalDexId").value(1025))
                .andExpect(jsonPath("$.koreanName").value("복숭악동"))
                .andExpect(jsonPath("$.generation").value(9))
                .andExpect(jsonPath("$.artworkEnabled").value(true));
    }

    @Test
    @WithMockUser(username = "catalog-member")
    void should_returnNotFound_when_speciesDoesNotExist()
            throws Exception {
        mockMvc.perform(get("/api/v1/pokemon-species/2000"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("POKEMON_NOT_FOUND"));
    }

    @Test
    @WithMockUser(username = "catalog-member")
    void should_hideDisabledSpecies_when_rowKillSwitchIsOff()
            throws Exception {
        jdbcClient
                .sql(
                        """
                        UPDATE pokemon_species
                        SET enabled = FALSE
                        WHERE national_dex_id = 25
                        """)
                .update();
        try {
            mockMvc.perform(get("/api/v1/pokemon-species/25"))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value("POKEMON_NOT_FOUND"));

            mockMvc.perform(
                            get("/api/v1/pokemon-species")
                                    .queryParam("query", "25"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.totalElements").value(0));
        } finally {
            jdbcClient
                    .sql(
                            """
                            UPDATE pokemon_species
                            SET enabled = TRUE
                            WHERE national_dex_id = 25
                            """)
                    .update();
        }
    }

    @Test
    @WithMockUser(username = "catalog-member")
    void should_rejectRequest_when_queryOrPageParametersAreInvalid()
            throws Exception {
        mockMvc.perform(
                        get("/api/v1/pokemon-species")
                                .queryParam("query", "가".repeat(81)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mockMvc.perform(
                        get("/api/v1/pokemon-species")
                                .queryParam("generation", "10"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mockMvc.perform(
                        get("/api/v1/pokemon-species")
                                .queryParam("page", "-1"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mockMvc.perform(
                        get("/api/v1/pokemon-species")
                                .queryParam("size", "101"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
        mockMvc.perform(get("/api/v1/pokemon-species/0"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void should_requireAuthentication_when_anonymousUserRequestsCatalog()
            throws Exception {
        mockMvc.perform(get("/api/v1/pokemon-species"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
    }
}
