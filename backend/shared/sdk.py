import time
import httpx
import asyncio
import os
import litellm
from datetime import datetime, timezone
from shared.models import InferenceLogPayload

INGESTION_URL = os.environ.get("INGESTION_URL", "http://localhost:8001/ingest")

class LLMObservabilitySDK:
    def __init__(self, ingestion_url: str = INGESTION_URL):
        self.ingestion_url = ingestion_url
        self._http_client = httpx.AsyncClient()

    async def _send_log(self, payload: InferenceLogPayload):
        try:
            await self._http_client.post(self.ingestion_url, json=payload.model_dump(mode='json'))
        except Exception as e:
            print(f"[SDK Error] Failed to send log: {e}")

    async def completion_stream(self, conversation_id: str, message_id: str, **kwargs):
        """Wraps litellm.acompletion to stream responses and log telemetry."""
        start_time = time.time()
        request_timestamp = datetime.now(timezone.utc)
        
        model = kwargs.get("model", "unknown")
        # Extract provider from litellm if possible or assume from model string
        provider = kwargs.get("custom_llm_provider", model.split("/")[0] if "/" in model else "openai")
        
        messages = kwargs.get("messages", [])
        input_preview = messages[-1]["content"] if messages else ""

        status = "success"
        error_message = None
        output_preview = ""
        
        try:
            # We must use stream=True
            kwargs["stream"] = True
            response_stream = await litellm.acompletion(**kwargs)
            
            async for chunk in response_stream:
                content = chunk.choices[0].delta.content or ""
                output_preview += content
                yield chunk

        except Exception as e:
            status = "error"
            error_message = str(e)
            raise e
        finally:
            end_time = time.time()
            response_timestamp = datetime.now(timezone.utc)
            latency_ms = int((end_time - start_time) * 1000)
            
            # Count tokens using litellm's token_counter with character fallback
            try:
                input_tokens = litellm.token_counter(model=model, text=input_preview)
            except Exception:
                input_tokens = len(input_preview) // 4

            try:
                output_tokens = litellm.token_counter(model=model, text=output_preview)
            except Exception:
                output_tokens = len(output_preview) // 4

            log_entry = InferenceLogPayload(
                conversation_id=conversation_id,
                message_id=message_id,
                model=model,
                provider=provider,
                latency_ms=latency_ms,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                total_tokens=input_tokens + output_tokens,
                status=status,
                error_message=error_message,
                request_timestamp=request_timestamp,
                response_timestamp=response_timestamp,
                input_preview=input_preview,
                output_preview=output_preview
            )
            
            # Fire and forget
            asyncio.create_task(self._send_log(log_entry))
