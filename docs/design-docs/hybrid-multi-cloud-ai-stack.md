# Architecture Design: Scalable Multi-Cloud AI Stack

**Status:** Proposed
**Author:** Engineering
**Target Date:** 2026-05

## 1. Objective

To establish a highly scalable, flexible, and cost-efficient AI architecture for the **Help & Grow** Expert Network. This architecture aims to deliver state-of-the-art (SOTA) performance for real-time voice chat and heavy text generation, leveraging the optimal strengths and free tiers of multiple AI providers simultaneously, while ensuring robust readiness for a large-scale global Go-To-Market (GTM).

## 2. Core Architectural Decisions

### 2.1 Hybrid AI Capability Routing

Instead of relying on a single vendor for all AI capabilities, the system will route requests based on modality, cost-efficiency, and performance characteristics:

-   **Text Generation & LLM Reasoning:** Route to **BytePlus**.
    -   **Model:** `doubao-seed-1.6-flash`
    -   **Rationale:** Provides high-throughput, low-latency text generation. Capitalizes on the generous initial trial quota (~500,000 tokens) and maintains highly competitive pricing post-trial. Ideal for profile generation, matchmaking reasoning, and text-based chat.
-   **Audio Processing (TTS & ASR):** Route to **Google Gemini**.
    -   **Text-to-Speech (TTS):** `gemini-3.1-flash-tts-preview`
    -   **Automatic Speech Recognition (ASR):** Native audio understanding via the standard `gemini-3.1-flash` model.
    -   **Rationale:** Gemini 3.1 Flash represents the new base standard (sunsetting previous 2.x versions). It provides a highly generous, perpetual free tier (15 RPM / 1M tokens per minute) that natively handles multimodal audio synthesis and transcription without requiring separate specialized audio models.

### 2.2 Scenario Routing Matrix

To maximize free quotas and SOTA performance, the platform routes AI tasks according to the following matrix:

| Scenario / Feature | AI Modality / API | AI Provider | Model Version | Rationale & Free Quota Strategy |
| :--- | :--- | :--- | :--- | :--- |
| **Profile Generation & Text Chat** | LLM (Text Generation) | **BytePlus** | `doubao-seed-1.6-flash` | High throughput, low latency. Capitalizes on 500k initial free tokens and highly competitive post-trial pricing. |
| **Matchmaking Reasoning** | LLM (Text Reasoning) | **BytePlus** | `doubao-seed-1.6-flash` | SOTA cost-efficiency for processing large context windows during semantic matchmaking. |
| **Voice Intro Synthesis (Profile)** | TTS (Text-to-Speech) | **Google Gemini** | `gemini-3.1-flash-tts-preview` | Generous perpetual free tier (15 RPM / 1M tokens/min). Avoids Alibaba TTS hard-stops post-trial. |
| **Async Voice Chat (Reply Synthesis)** | TTS (Text-to-Speech) | **Google Gemini** | `gemini-3.1-flash-tts-preview` | High concurrency handling within the 15 RPM free tier limit. Cost-effective for high-volume free asynchronous voice. |
| **Real-time Voice Chat (Transcription)** | ASR (Speech Recognition) | **Google Gemini** | `gemini-3.1-flash` (Base) | Native audio understanding without specialized models. Base model 3.1 replaces sunsetting 2.x versions. |
| **Real-time Voice Chat (Streaming Text/Audio)** | LLM / TTS | **Google Gemini** | `gemini-3.1-flash` (Base) | True multimodal I/O reduces overall latency compared to chaining separate ASR -> LLM -> TTS pipelines. |
| **Failover / Fallback (Voice)** | ASR / TTS | **Alibaba Cloud** | `SenseVoice` / `CosyVoice` | Used strictly as a fallback mechanism if Gemini rate limits are exceeded, burning through any remaining trial hours/characters. |

### 2.3 Regional Compute & Latency Optimization

For real-time voice chat, minimizing latency is the most critical non-functional requirement.

-   **Compute Region:** All Vercel serverless functions **must** be explicitly pinned to the `sin1` (Singapore) region.
-   **AI Endpoints:** BytePlus and Alibaba Cloud host their primary Southeast Asia AI endpoints in the `ap-southeast-1` region.
-   **Rationale:** **Keeping compute in `sin1` minimizes round-trip latency to <50ms, which is critical for realtime voice chat performance.**

*Note: Current inspection of the Vercel deployment indicates that serverless functions are defaulting to `iad1` (Washington, D.C., USA). This must be explicitly overridden in the Vercel project settings or via `vercel.json`.*

## 3. Long-Term Scalability & Flexibility Principles

1.  **Provider Agnosticism:** The codebase must maintain strict abstractions (e.g., `VoiceSynthesisProvider`, `AIGenerator`) so that models and providers can be hot-swapped via environment variables without code changes.
2.  **Quota Monitoring:** Implement robust alerting to monitor the exhaustion of trial quotas (especially BytePlus and Alibaba Cloud) to ensure smooth transitions to pay-as-you-go tiers without production outages.
3.  **Fallback Mechanisms:** Maintain secondary providers for critical paths (e.g., if Gemini ASR fails, fallback to DashScope SenseVoice) to ensure high availability.
4.  **Cost Arbitrage:** Continuously evaluate the pricing and performance of `ap-southeast-1` models to dynamically route non-realtime batch jobs to the most cost-effective provider.

## 4. Action Items for Code Agents

1.  **Vercel Region Configuration:** Update `vercel.json` to enforce `"regions": ["sin1"]`.
2.  **BytePlus Integration:** Ensure the default LLM generator for text tasks defaults to `doubao-seed-1.6-flash`.
3.  **Gemini Audio Integration:** Update the Gemini integration layer to specifically target `gemini-3.1-flash` for ASR and `gemini-3.1-flash-tts-preview` for TTS, ensuring compatibility with the new 3.1 multimodal API surface.
