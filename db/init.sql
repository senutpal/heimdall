-- Initialization script for PostgreSQL

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Table for storing chat conversations
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL DEFAULT 'New Conversation',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for storing individual chat messages
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL, -- 'user', 'model', 'system'
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Table for storing telemetry and inference logs
CREATE TABLE IF NOT EXISTS inference_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    model VARCHAR(100) NOT NULL,
    provider VARCHAR(100) NOT NULL,
    latency_ms INTEGER NOT NULL,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    status VARCHAR(50) NOT NULL, -- 'success', 'error'
    error_message TEXT,
    request_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    response_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    input_preview TEXT,
    output_preview TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance on dashboards
CREATE INDEX idx_inference_logs_created_at ON inference_logs(created_at);
CREATE INDEX idx_inference_logs_status ON inference_logs(status);
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
