from fastapi import FastAPI, HTTPException
import os
import json
import redis.asyncio as redis
from shared.models import InferenceLogPayload

app = FastAPI(title="Ingestion Service")

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
redis_client = redis.from_url(REDIS_URL)

@app.post("/ingest")
async def ingest_log(payload: InferenceLogPayload):
    try:
        # Publish to Redis stream 'inference_logs_stream'
        log_dict = payload.model_dump()
        # Convert datetime to string for redis
        log_dict['request_timestamp'] = log_dict['request_timestamp'].isoformat()
        log_dict['response_timestamp'] = log_dict['response_timestamp'].isoformat()
        
        # Redis xadd expects a dict of string to string
        stringified_dict = {k: str(v) if v is not None else "" for k, v in log_dict.items()}
        
        await redis_client.xadd("inference_logs_stream", stringified_dict)
        return {"status": "accepted"}
    except Exception as e:
        print(f"Error ingesting log: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")

@app.get("/health")
async def health():
    return {"status": "ok"}
