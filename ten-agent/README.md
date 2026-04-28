# TEN Agent — Real-time AI Voice Chat Service

This is the companion Docker service for **Help & Grow** real-time AI voice chat.
It joins an Agora RTC channel, listens to the **player's** microphone stream, and
speaks back as the expert's AI clone using TEN Framework + DashScope Qwen.

## Architecture

```
Player (browser/WeChat) ──Agora RTC──> TEN Agent container
                                         ├─ ASR:  DashScope Qwen3-ASR
                                         ├─ LLM:  Qwen-Max + mem9 context
                                         └─ TTS:  Qwen3-TTS-VC (expert voice clone)
```

## Prerequisites

- Docker & Docker Compose
- Agora App ID + Certificate (from [console.agora.io](https://console.agora.io))
- DashScope API Key (`DASHSCOPE_API_KEY`)

## Quick Start

```bash
cp .env.example .env   # Fill in your keys
docker compose up -d
```

The service listens on port **8080** by default.

## API

### POST /start
Join a channel and start the AI agent.

```json
{
  "channel": "vc-abc-12345678",
  "uid": 100001,
  "expertId": "expert-uuid",
  "voiceModelId": "qwen-tts-voice-id",
  "systemPrompt": "You are an AI clone of Dr. Smith..."
}
```

### POST /stop
Leave the channel and clean up resources.

```json
{
  "channel": "vc-abc-12345678"
}
```

### GET /health
Returns `{ "ok": true }`.

## Deployment

Deploy to ECS, Fly.io, Railway, or any Docker host. Set the resulting URL as
`TEN_AGENT_URL` in Vercel environment variables, then set `VOICE_CHAT_MODE=both`
(or `realtime`) to activate.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGORA_APP_ID` | Yes | Agora project App ID |
| `AGORA_APP_CERTIFICATE` | Yes | Agora App Certificate |
| `DASHSCOPE_API_KEY` | Yes | Alibaba DashScope key |
| `MEM9_API_KEY` | No | mem9 API key for expert memory |
| `PORT` | No | HTTP port (default: 8080) |
