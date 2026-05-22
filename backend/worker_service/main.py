import asyncio
import os
import json
import redis.asyncio as redis
from redis.exceptions import ResponseError
import asyncpg
import uuid
from datetime import datetime
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://llm_user:llm_password@localhost:5432/llm_db")

redis_client = redis.from_url(REDIS_URL)

analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

def redact_pii(text: str) -> str:
    if not text:
        return text
    try:
        results = analyzer.analyze(text=text, entities=[], language='en')
        anonymized = anonymizer.anonymize(text=text, analyzer_results=results)
        return anonymized.text
    except Exception as e:
        print(f"Redaction error: {e}")
        return text

async def process_logs():
    print("Worker service started. Connecting to DB...")
    # Add a small delay to ensure DB is ready
    await asyncio.sleep(5)
    
    conn = await asyncpg.connect(DATABASE_URL)
    print("Connected to DB. Listening for events...")
    
    # Create consumer group if not exists
    try:
        await redis_client.xgroup_create("inference_logs_stream", "log_workers", mkstream=True)
    except ResponseError as e:
        if "BUSYGROUP" not in str(e):
            print(f"Error creating consumer group: {e}")
            
    while True:
        try:
            # Read from stream
            messages = await redis_client.xreadgroup(
                "log_workers", "worker-1", {"inference_logs_stream": ">"}, count=10, block=2000
            )
            
            if not messages:
                continue
                
            for stream_name, stream_messages in messages:
                for message_id, message_data in stream_messages:
                    decoded_data = {k.decode('utf-8'): v.decode('utf-8') for k, v in message_data.items()}
                    
                    # Redact PII
                    input_preview = redact_pii(decoded_data.get('input_preview', ''))
                    output_preview = redact_pii(decoded_data.get('output_preview', ''))
                    
                    # Convert types for asyncpg / PostgreSQL UUID and Timestamp constraints
                    log_id = uuid.UUID(decoded_data['id'])
                    conv_id_str = decoded_data.get('conversation_id')
                    conv_id = uuid.UUID(conv_id_str) if conv_id_str else None
                    msg_id_str = decoded_data.get('message_id')
                    msg_id = uuid.UUID(msg_id_str) if msg_id_str else None
                    
                    req_ts = datetime.fromisoformat(decoded_data['request_timestamp'])
                    resp_ts = datetime.fromisoformat(decoded_data['response_timestamp'])

                    # Insert into DB with retry for race condition
                    for attempt in range(5):
                        try:
                            await conn.execute(
                                '''
                                INSERT INTO inference_logs 
                                (id, conversation_id, message_id, model, provider, latency_ms, input_tokens, output_tokens, total_tokens, status, error_message, request_timestamp, response_timestamp, input_preview, output_preview)
                                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                                ''',
                                log_id, conv_id, msg_id, decoded_data['model'], decoded_data['provider'],
                                int(decoded_data['latency_ms']), int(decoded_data.get('input_tokens', 0)),
                                int(decoded_data.get('output_tokens', 0)), int(decoded_data.get('total_tokens', 0)),
                                decoded_data['status'], decoded_data.get('error_message') or None,
                                req_ts, resp_ts, input_preview, output_preview
                            )
                            # Acknowledge message
                            await redis_client.xack("inference_logs_stream", "log_workers", message_id)
                            break
                        except Exception as e:
                            if "violates foreign key constraint" in str(e) or "ForeignKeyViolationError" in str(type(e)):
                                print(f"Waiting for chat_service to commit message {msg_id} (attempt {attempt+1}/5)...")
                                await asyncio.sleep(1)
                            else:
                                raise e
                    else:
                        print(f"Dropped log {log_id}: FK violation persisted.")
                    
        except Exception as e:
            print(f"Worker Error: {e}")
            await asyncio.sleep(1)

if __name__ == "__main__":
    asyncio.run(process_logs())
