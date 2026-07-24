CREATE TABLE app_user (
    id UUID NOT NULL,
    login_id VARCHAR(30) NOT NULL,
    login_id_key VARCHAR(30) NOT NULL,
    nickname VARCHAR(16) NOT NULL,
    nickname_key VARCHAR(32) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT pk_app_user PRIMARY KEY (id),
    CONSTRAINT uk_app_user_login_id_key UNIQUE (login_id_key),
    CONSTRAINT uk_app_user_nickname_key UNIQUE (nickname_key),
    CONSTRAINT ck_app_user_login_id_key
        CHECK (login_id_key ~ '^[a-z0-9_]{4,30}$'),
    CONSTRAINT ck_app_user_status
        CHECK (status IN ('ACTIVE', 'DISABLED'))
);

CREATE TABLE spring_session (
    primary_id CHAR(36) NOT NULL,
    session_id CHAR(36) NOT NULL,
    creation_time BIGINT NOT NULL,
    last_access_time BIGINT NOT NULL,
    max_inactive_interval INTEGER NOT NULL,
    expiry_time BIGINT NOT NULL,
    principal_name VARCHAR(100),
    CONSTRAINT spring_session_pk PRIMARY KEY (primary_id)
);

CREATE UNIQUE INDEX spring_session_ix1
    ON spring_session (session_id);

CREATE INDEX spring_session_ix2
    ON spring_session (expiry_time);

CREATE INDEX spring_session_ix3
    ON spring_session (principal_name);

CREATE TABLE spring_session_attributes (
    session_primary_id CHAR(36) NOT NULL,
    attribute_name VARCHAR(200) NOT NULL,
    attribute_bytes BYTEA NOT NULL,
    CONSTRAINT spring_session_attributes_pk
        PRIMARY KEY (session_primary_id, attribute_name),
    CONSTRAINT spring_session_attributes_fk
        FOREIGN KEY (session_primary_id)
        REFERENCES spring_session (primary_id)
        ON DELETE CASCADE
);
