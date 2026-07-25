package com.guesspokemon.history;

import static com.guesspokemon.common.error.ApiErrorCode.AUTHENTICATION_REQUIRED;

import com.guesspokemon.common.error.ApiException;
import com.guesspokemon.game.GameTypes.GameResult;
import com.guesspokemon.history.GameHistoryDtos.GameDetail;
import com.guesspokemon.history.GameHistoryDtos.GamePage;
import com.guesspokemon.security.AuthenticatedUser;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/games")
public class GameHistoryController {

    private final GameHistoryService gameHistoryService;

    public GameHistoryController(
            GameHistoryService gameHistoryService) {
        this.gameHistoryService = gameHistoryService;
    }

    @GetMapping
    ResponseEntity<GamePage> list(
            @RequestParam(required = false)
                    GameResult result,
            @RequestParam(defaultValue = "0")
                    @Min(0)
                    int page,
            @RequestParam(defaultValue = "20")
                    @Min(1)
                    @Max(100)
                    int size,
            @AuthenticationPrincipal
                    AuthenticatedUser authenticatedUser) {
        AuthenticatedUser user =
                requireAuthenticatedUser(authenticatedUser);
        GamePage response =
                gameHistoryService.list(
                        user.id(),
                        result,
                        page,
                        size);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    @GetMapping("/{gameId}")
    ResponseEntity<GameDetail> findDetail(
            @PathVariable UUID gameId,
            @AuthenticationPrincipal
                    AuthenticatedUser authenticatedUser) {
        AuthenticatedUser user =
                requireAuthenticatedUser(authenticatedUser);
        GameDetail response =
                gameHistoryService.findDetail(
                        user.id(),
                        gameId);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(response);
    }

    private AuthenticatedUser requireAuthenticatedUser(
            AuthenticatedUser authenticatedUser) {
        if (authenticatedUser == null) {
            throw new ApiException(AUTHENTICATION_REQUIRED);
        }
        return authenticatedUser;
    }
}
