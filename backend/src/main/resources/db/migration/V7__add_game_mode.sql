ALTER TABLE game
    ADD COLUMN mode VARCHAR(30) NOT NULL
        DEFAULT 'TWENTY_QUESTIONS';

ALTER TABLE game
    ALTER COLUMN mode DROP DEFAULT;

ALTER TABLE game
    DROP CONSTRAINT ck_game_end_reason,
    DROP CONSTRAINT ck_game_lifecycle;

ALTER TABLE game
    ADD CONSTRAINT ck_game_mode
        CHECK (mode IN ('TWENTY_QUESTIONS', 'SILHOUETTE')),
    ADD CONSTRAINT ck_game_mode_action_count
        CHECK (
            (mode = 'TWENTY_QUESTIONS' AND action_count BETWEEN 0 AND 20)
            OR (mode = 'SILHOUETTE' AND action_count BETWEEN 0 AND 3)
        ),
    ADD CONSTRAINT ck_game_end_reason
        CHECK (
            end_reason IS NULL
            OR end_reason IN (
                'CORRECT_GUESS',
                'QUESTION_LIMIT',
                'GUESS_LIMIT',
                'PLAYER_LEFT',
                'RECONNECT_TIMEOUT',
                'BOTH_DISCONNECTED',
                'SERVER_RESTART'
            )
        ),
    ADD CONSTRAINT ck_game_lifecycle
        CHECK (
            (
                status = 'IN_PROGRESS'
                AND end_reason IS NULL
                AND ended_at IS NULL
            )
            OR (
                status = 'COMPLETED'
                AND end_reason IN (
                    'CORRECT_GUESS',
                    'QUESTION_LIMIT',
                    'GUESS_LIMIT',
                    'PLAYER_LEFT',
                    'RECONNECT_TIMEOUT'
                )
                AND ended_at IS NOT NULL
            )
            OR (
                status = 'ABORTED'
                AND end_reason IN (
                    'BOTH_DISCONNECTED',
                    'SERVER_RESTART'
                )
                AND ended_at IS NOT NULL
            )
        );
