# TEN Agent — AI Voice Chat Service

Self-hosted TEN Framework agent for **Help & Grow** AI voice chat.

Learners talk to an AI clone of an expert in real time: Agora RTC transports audio,
DashScope Qwen handles ASR → LLM → TTS-VC with the expert's cloned voice.

## Quick start

```bash
cp .env.example .env   # fill in values
docker compose up -d
```

The agent HTTP API listens on port **8080** by default.

## Environment variables

| Variable | Description |
|----------|-------------|
| `AGORA_APP_ID` | Agora project App ID |
| `AGORA_APP_CERTIFICATE` | Agora App Certificate (for token auth) |
| `DASHSCOPE_API_KEY` | Alibaba DashScope API key (ASR + LLM + TTS-VC) |

## HTTP API (called by Next.js backend)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| POST | `/start` | `{ channel, uid, expertId, voiceModelId, systemPrompt }` | Start agent in Agora channel |
| POST | `/stop` | `{ channel }` | Stop agent and leave channel |
| GET | `/health` | — | Health check |

## Architecture

```
User mic → Agora SD-RTN → TEN RTC Extension
  → ASR (qwen3-asr-flash) → text
  → LLM (qwen-max + expert mem9 context) → response text
  → TTS-VC (qwen3-tts-vc + expert voice clone) → audio frames
  → Agora SD-RTN → User speaker
```
