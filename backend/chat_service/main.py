from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import os
import json
import uuid
import asyncpg
from shared.models import ChatRequest
from shared.sdk import LLMObservabilitySDK

app = FastAPI(title="Chat Service")
sdk = LLMObservabilitySDK()

# Enable CORS for the frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://llm_user:llm_password@localhost:5432/llm_db")

@app.on_event("startup")
async def startup():
    app.state.pool = await asyncpg.create_pool(DATABASE_URL)

@app.on_event("shutdown")
async def shutdown():
    await app.state.pool.close()

@app.get("/conversations")
async def list_conversations():
    async with app.state.pool.acquire() as conn:
        records = await conn.fetch("SELECT id, title, created_at FROM conversations ORDER BY updated_at DESC")
        return [{"id": str(r["id"]), "title": r["title"], "created_at": r["created_at"]} for r in records]

@app.get("/conversations/{conversation_id}/messages")
async def get_messages(conversation_id: str):
    async with app.state.pool.acquire() as conn:
        records = await conn.fetch("SELECT id, role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC", uuid.UUID(conversation_id))
        return [{"id": str(r["id"]), "role": r["role"], "content": r["content"]} for r in records]

@app.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    async with app.state.pool.acquire() as conn:
        await conn.execute("DELETE FROM conversations WHERE id = $1", uuid.UUID(conversation_id))
        return {"status": "deleted"}

@app.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    async with app.state.pool.acquire() as conn:
        conv_id = request.conversation_id
        if not conv_id:
            # Generate title from the first 40 characters of the user's message
            title = request.message[:40] + ("..." if len(request.message) > 40 else "")
            if not title.strip():
                title = "New Chat"
            conv_id_uuid = await conn.fetchval("INSERT INTO conversations (title) VALUES ($1) RETURNING id", title)
            conv_id = str(conv_id_uuid)
        else:
            await conn.execute("UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1", uuid.UUID(conv_id))

        # Save user message
        user_msg_id = await conn.fetchval(
            "INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3) RETURNING id",
            uuid.UUID(conv_id), "user", request.message
        )

        # Retrieve context (last 5 messages)
        history = await conn.fetch(
            "SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 5",
            uuid.UUID(conv_id)
        )
        
        messages_payload = [{"role": "assistant" if r["role"] == "model" else r["role"], "content": r["content"]} for r in reversed(history)]

        # Prepare for model message insertion
        model_msg_id = str(uuid.uuid4())

        async def generate():
            yield f"data: {json.dumps({'conversation_id': conv_id})}\n\n"
            full_content = ""
            try:
                async for chunk in sdk.completion_stream(
                    conversation_id=conv_id,
                    message_id=model_msg_id,
                    model=request.model,
                    messages=messages_payload
                ):
                    content = chunk.choices[0].delta.content or ""
                    full_content += content
                    yield f"data: {json.dumps({'content': content})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
            finally:
                # Save model message to DB
                if full_content:
                    await app.state.pool.execute(
                        "INSERT INTO messages (id, conversation_id, role, content) VALUES ($1, $2, $3, $4)",
                        uuid.UUID(model_msg_id), uuid.UUID(conv_id), "model", full_content
                    )
                yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")

@app.get("/dashboard/metrics")
async def get_metrics():
    # Enhanced aggregations for the dashboard
    async with app.state.pool.acquire() as conn:
        avg_latency = await conn.fetchval("SELECT AVG(latency_ms) FROM inference_logs WHERE status = 'success'")
        total_requests = await conn.fetchval("SELECT COUNT(*) FROM inference_logs")
        error_requests = await conn.fetchval("SELECT COUNT(*) FROM inference_logs WHERE status = 'error'")
        total_tokens = await conn.fetchval("SELECT SUM(total_tokens) FROM inference_logs") or 0
        
        # Model distribution
        model_distribution_records = await conn.fetch("SELECT model, COUNT(*) as count FROM inference_logs GROUP BY model")
        model_distribution = {r["model"]: r["count"] for r in model_distribution_records}
        
        # Recent live logs
        recent_log_records = await conn.fetch(
            """
            SELECT id, model, provider, latency_ms, status, request_timestamp, input_preview, output_preview 
            FROM inference_logs 
            ORDER BY created_at DESC 
            LIMIT 5
            """
        )
        recent_logs = [
            {
                "id": str(r["id"]),
                "model": r["model"],
                "provider": r["provider"],
                "latency_ms": r["latency_ms"],
                "status": r["status"],
                "request_timestamp": r["request_timestamp"].isoformat() if r["request_timestamp"] else None,
                "input_preview": r["input_preview"],
                "output_preview": r["output_preview"]
            }
            for r in recent_log_records
        ]
        
        return {
            "avg_latency_ms": round(avg_latency or 0, 2),
            "throughput_total": total_requests,
            "error_rate": round(error_requests / total_requests * 100, 2) if total_requests else 0,
            "errors": error_requests,
            "total_tokens": total_tokens,
            "model_distribution": model_distribution,
            "recent_logs": recent_logs
        }
