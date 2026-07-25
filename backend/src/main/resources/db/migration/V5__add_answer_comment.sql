ALTER TABLE game_action
    ADD COLUMN answer_comment VARCHAR(200);

ALTER TABLE game_action
    ADD CONSTRAINT ck_game_action_answer_comment
        CHECK (
            answer_comment IS NULL
            OR (
                action_type = 'QUESTION'
                AND answer IS NOT NULL
                AND answer_comment !~ '^[[:space:]]*$'
                AND char_length(answer_comment) BETWEEN 1 AND 200
            )
        );
