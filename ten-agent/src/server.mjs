import http from "node:http";

const PORT = parseInt(process.env.PORT || "8080", 10);

/**
 * Minimal TEN Agent HTTP server — scaffold for future real-time AI voice integration.
 *
 * When fully implemented, /start will:
 *   1. Join the Agora RTC channel as a bot UID
 *   2. Subscribe to the learner's audio stream
 *   3. Run ASR → LLM → TTS-VC pipeline
 *   4. Publish synthesized audio back to the channel
 *
 * This scaffold provides the HTTP contract consumed by the Next.js backend.
 */

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, sessions: activeSessions.size });
  }

  if (req.method === "POST" && url.pathname === "/start") {
    try {
      const body = await readBody(req);
      const { channel, uid, expertId, voiceModelId, systemPrompt } = body;

      if (!channel || !uid) {
        return json(res, 400, { error: "channel and uid are required" });
      }

      if (activeSessions.has(channel)) {
        return json(res, 409, { error: "Session already active on this channel" });
      }

      // TODO: Replace with actual TEN Framework / Agora RTC bot logic
      activeSessions.set(channel, {
        uid,
        expertId,
        voiceModelId,
        startedAt: Date.now(),
      });

      console.log(`[TEN] Started session: channel=${channel} expert=${expertId}`);
      return json(res, 200, { ok: true, channel });
    } catch (err) {
      console.error("[TEN] /start error:", err);
      return json(res, 500, { error: err.message });
    }
  }

  if (req.method === "POST" && url.pathname === "/stop") {
    try {
      const body = await readBody(req);
      const { channel } = body;

      if (!channel) {
        return json(res, 400, { error: "channel is required" });
      }

      const session = activeSessions.get(channel);
      if (session) {
        activeSessions.delete(channel);
        const duration = Math.round((Date.now() - session.startedAt) / 1000);
        console.log(`[TEN] Stopped session: channel=${channel} duration=${duration}s`);
      }

      return json(res, 200, { ok: true, channel });
    } catch (err) {
      console.error("[TEN] /stop error:", err);
      return json(res, 500, { error: err.message });
    }
  }

  json(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`[TEN Agent] Listening on port ${PORT}`);
  console.log(`[TEN Agent] AGORA_APP_ID: ${process.env.AGORA_APP_ID ? "set" : "missing"}`);
  console.log(`[TEN Agent] DASHSCOPE_API_KEY: ${process.env.DASHSCOPE_API_KEY ? "set" : "missing"}`);
});
