from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime
import uuid

# Base models for Ingestion

class InferenceLogPayload(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    conversation_id: Optional[str] = None
    message_id: Optional[str] = None
    model: str
    provider: str
    latency_ms: int
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    status: str
    error_message: Optional[str] = None
    request_timestamp: datetime
    response_timestamp: datetime
    input_preview: Optional[str] = None
    output_preview: Optional[str] = None

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    message: str
    model: str = "gpt-3.5-turbo" # Default, can be overridden
    provider: str = "openai"

class ChatResponse(BaseModel):
    conversation_id: str
    message_id: str
    reply: str
