CREATE TABLE signs (
    id SERIAL PRIMARY KEY,
    word TEXT NOT NULL,
    poses JSONB NOT NULL,
    embedding vector(384)
);
