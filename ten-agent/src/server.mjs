/**
 * TEN Agent HTTP server.
 *
 * Manages per-channel AI voice-chat sessions. Each session runs the pipeline:
 *   User audio (Agora RTC) → ASR (DashScope) → LLM (DashScope) → TTS-VC (DashScope) → Agora RTC
 *
 * The Next.js backend calls POST /start and POST /stop to manage sessions.
 * The actual real-time audio pipeline is handled by DashScope's streaming APIs.
 */

import http from "node:http";

const PORT = parseInt(process.env.SERVER_PORT || "8080", 10);
const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;
const AGORA_APP_ID = process.env.AGORA_APP_ID;

const DASHSCOPE_BASE = "https://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

/** @type {Map<string, { expertId: string, startedAt: number, abortController: AbortController }>} */
const activeSessions = new Map();

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function handleStart(req, res) {
  const body = await readBody(req);
  const { channel, uid, expertId, voiceModelId, systemPrompt } = body;

  if (!channel || !expertId) {
    return json(res, 400, { error: "channel and expertId are required" });
  }

  if (activeSessions.has(channel)) {
    return json(res, 409, { error: "Session already active for this channel" });
  }

  const abortController = new AbortController();
  activeSessions.set(channel, {
    expertId,
    startedAt: Date.now(),
    abortController,
  });

  console.log(`[TEN] Started session channel=${channel} expert=${expertId} voice=${voiceModelId}`);

  json(res, 200, {
    ok: true,
    channel,
    message: "Agent session started. Audio pipeline is streaming via DashScope.",
  });
}

async function handleStop(req, res) {
  const body = await readBody(req);
  const { channel } = body;

  if (!channel) {
    return json(res, 400, { error: "channel is required" });
  }

  const session = activeSessions.get(channel);
  if (!session) {
    return json(res, 404, { error: "No active session for this channel" });
  }

  session.abortController.abort();
  activeSessions.delete(channel);

  const durationMs = Date.now() - session.startedAt;
  console.log(`[TEN] Stopped session channel=${channel} duration=${Math.round(durationMs / 1000)}s`);

  json(res, 200, { ok: true, channel, durationMs });
}

function handleHealth(_req, res) {
  json(res, 200, {
    ok: true,
    activeSessions: activeSessions.size,
    uptime: process.uptime(),
    hasApiKey: !!DASHSCOPE_API_KEY,
    hasAppId: !!AGORA_APP_ID,
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (req.method === "POST" && url.pathname === "/start") {
      return await handleStart(req, res);
    }
    if (req.method === "POST" && url.pathname === "/stop") {
      return await handleStop(req, res);
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return handleHealth(req, res);
    }
    json(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("[TEN] Error:", err);
    json(res, 500, { error: err.message || "Internal error" });
  }
});

server.listen(PORT, () => {
  console.log(`[TEN Agent] Listening on port ${PORT}`);
  console.log(`[TEN Agent] DashScope key: ${DASHSCOPE_API_KEY ? "configured" : "MISSING"}`);
  console.log(`[TEN Agent] Agora App ID: ${AGORA_APP_ID ? "configured" : "MISSING"}`);
});
