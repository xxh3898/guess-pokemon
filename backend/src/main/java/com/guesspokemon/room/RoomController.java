package com.guesspokemon.room;

import static com.guesspokemon.common.error.ApiErrorCode.AUTHENTICATION_REQUIRED;

import com.guesspokemon.common.error.ApiException;
import com.guesspokemon.realtime.RealtimeEventPublisher;
import com.guesspokemon.realtime.RoomConnectionService;
import com.guesspokemon.room.RoomApplicationService.JoinOutcome;
import com.guesspokemon.room.RoomApplicationService.LeaveOutcome;
import com.guesspokemon.room.RoomDtos.JoinableRoomListResponse;
import com.guesspokemon.room.RoomDtos.RoomSnapshot;
import com.guesspokemon.security.AuthenticatedUser;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/rooms")
public class RoomController {

    private final RoomApplicationService roomApplicationService;
    private final RealtimeEventPublisher eventPublisher;
    private final RoomConnectionService roomConnectionService;

    public RoomController(
            RoomApplicationService roomApplicationService,
            RealtimeEventPublisher eventPublisher,
            RoomConnectionService roomConnectionService) {
        this.roomApplicationService = roomApplicationService;
        this.eventPublisher = eventPublisher;
        this.roomConnectionService = roomConnectionService;
    }

    @PostMapping
    ResponseEntity<RoomSnapshot> create(
            @AuthenticationPrincipal AuthenticatedUser authenticatedUser) {
        AuthenticatedUser user = requireAuthenticatedUser(authenticatedUser);
        RoomSnapshot snapshot =
                roomApplicationService.create(
                        user.id(),
                        user.nickname());
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(snapshot);
    }

    @PostMapping("/{roomCode}/join")
    ResponseEntity<RoomSnapshot> join(
            @PathVariable String roomCode,
            @AuthenticationPrincipal AuthenticatedUser authenticatedUser) {
        AuthenticatedUser user = requireAuthenticatedUser(authenticatedUser);
        JoinOutcome outcome =
                roomApplicationService.join(
                        roomCode,
                        user.id(),
                        user.nickname());
        eventPublisher.publishPlayerJoined(outcome);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(outcome.joinedSnapshot());
    }

    @GetMapping
    ResponseEntity<JoinableRoomListResponse> list(
            @AuthenticationPrincipal AuthenticatedUser authenticatedUser) {
        requireAuthenticatedUser(authenticatedUser);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(roomApplicationService.listJoinableRooms());
    }

    @GetMapping("/{roomCode}")
    ResponseEntity<RoomSnapshot> get(
            @PathVariable String roomCode,
            @AuthenticationPrincipal AuthenticatedUser authenticatedUser) {
        AuthenticatedUser user = requireAuthenticatedUser(authenticatedUser);
        RoomSnapshot snapshot =
                roomApplicationService.getSnapshot(
                        roomCode,
                        user.id());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(snapshot);
    }

    @DeleteMapping("/{roomCode}/members/me")
    ResponseEntity<Void> leave(
            @PathVariable String roomCode,
            @AuthenticationPrincipal AuthenticatedUser authenticatedUser) {
        AuthenticatedUser user = requireAuthenticatedUser(authenticatedUser);
        LeaveOutcome outcome =
                roomApplicationService.leave(
                        roomCode,
                        user.id());
        eventPublisher.publishLeave(outcome);
        if (outcome.roomClosed()) {
            roomConnectionService.clearRoom(roomCode);
        } else {
            roomConnectionService.clearUserRoom(
                    user.id(),
                    roomCode);
        }
        return ResponseEntity.noContent()
                .cacheControl(CacheControl.noStore())
                .build();
    }

    private AuthenticatedUser requireAuthenticatedUser(
            AuthenticatedUser authenticatedUser) {
        if (authenticatedUser == null) {
            throw new ApiException(AUTHENTICATION_REQUIRED);
        }
        return authenticatedUser;
    }
}
