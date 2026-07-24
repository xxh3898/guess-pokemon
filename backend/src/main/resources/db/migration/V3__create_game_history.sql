CREATE TABLE game (
    id UUID NOT NULL,
    round_group_id UUID NOT NULL,
    answer_pokemon_id INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL,
    end_reason VARCHAR(40),
    action_count SMALLINT NOT NULL,
    state_version BIGINT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_game PRIMARY KEY (id),
    CONSTRAINT fk_game_answer_pokemon
        FOREIGN KEY (answer_pokemon_id)
        REFERENCES pokemon_species (national_dex_id),
    CONSTRAINT ck_game_status
        CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'ABORTED')),
    CONSTRAINT ck_game_end_reason
        CHECK (
            end_reason IS NULL
            OR end_reason IN (
                'CORRECT_GUESS',
                'QUESTION_LIMIT',
                'PLAYER_LEFT',
                'RECONNECT_TIMEOUT',
                'BOTH_DISCONNECTED',
                'SERVER_RESTART'
            )
        ),
    CONSTRAINT ck_game_action_count
        CHECK (action_count BETWEEN 0 AND 20),
    CONSTRAINT ck_game_state_version
        CHECK (state_version >= 0),
    CONSTRAINT ck_game_lifecycle
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
        ),
    CONSTRAINT ck_game_timestamps
        CHECK (
            ended_at IS NULL
            OR ended_at >= started_at
        )
);

CREATE INDEX ix_game_round_group_id
    ON game (round_group_id);

CREATE INDEX ix_game_status_updated_at
    ON game (status, updated_at);

CREATE INDEX ix_game_ended_at_desc
    ON game (ended_at DESC);

CREATE TABLE game_participant (
    game_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role VARCHAR(20) NOT NULL,
    result VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_game_participant
        PRIMARY KEY (game_id, user_id),
    CONSTRAINT fk_game_participant_game
        FOREIGN KEY (game_id)
        REFERENCES game (id),
    CONSTRAINT fk_game_participant_user
        FOREIGN KEY (user_id)
        REFERENCES app_user (id),
    CONSTRAINT uk_game_participant_game_role
        UNIQUE (game_id, role),
    CONSTRAINT ck_game_participant_role
        CHECK (role IN ('SELECTOR', 'QUESTIONER')),
    CONSTRAINT ck_game_participant_result
        CHECK (result IN ('WIN', 'LOSS', 'NONE'))
);

CREATE INDEX ix_game_participant_user_game
    ON game_participant (user_id, game_id);

CREATE TABLE game_action (
    id UUID NOT NULL,
    command_id UUID NOT NULL,
    game_id UUID NOT NULL,
    actor_user_id UUID NOT NULL,
    sequence_no SMALLINT NOT NULL,
    action_type VARCHAR(20) NOT NULL,
    question_text VARCHAR(200),
    answer VARCHAR(20),
    guessed_pokemon_id INTEGER,
    correct BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL,
    answered_at TIMESTAMPTZ,
    CONSTRAINT pk_game_action PRIMARY KEY (id),
    CONSTRAINT uk_game_action_command_id
        UNIQUE (command_id),
    CONSTRAINT uk_game_action_game_sequence
        UNIQUE (game_id, sequence_no),
    CONSTRAINT fk_game_action_game
        FOREIGN KEY (game_id)
        REFERENCES game (id),
    CONSTRAINT fk_game_action_actor_participant
        FOREIGN KEY (game_id, actor_user_id)
        REFERENCES game_participant (game_id, user_id),
    CONSTRAINT fk_game_action_guessed_pokemon
        FOREIGN KEY (guessed_pokemon_id)
        REFERENCES pokemon_species (national_dex_id),
    CONSTRAINT ck_game_action_sequence
        CHECK (sequence_no BETWEEN 1 AND 20),
    CONSTRAINT ck_game_action_type
        CHECK (action_type IN ('QUESTION', 'GUESS')),
    CONSTRAINT ck_game_action_answer
        CHECK (
            answer IS NULL
            OR answer IN ('YES', 'NO', 'UNKNOWN')
        ),
    CONSTRAINT ck_game_action_shape
        CHECK (
            (
                action_type = 'QUESTION'
                AND question_text IS NOT NULL
                AND btrim(question_text) <> ''
                AND char_length(question_text) BETWEEN 1 AND 200
                AND guessed_pokemon_id IS NULL
                AND correct IS NULL
                AND (
                    (
                        answer IS NULL
                        AND answered_at IS NULL
                    )
                    OR (
                        answer IS NOT NULL
                        AND answered_at IS NOT NULL
                    )
                )
            )
            OR (
                action_type = 'GUESS'
                AND question_text IS NULL
                AND answer IS NULL
                AND guessed_pokemon_id IS NOT NULL
                AND correct IS NOT NULL
                AND answered_at IS NULL
            )
        ),
    CONSTRAINT ck_game_action_timestamps
        CHECK (
            answered_at IS NULL
            OR answered_at >= created_at
        )
);
