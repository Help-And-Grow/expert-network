import express from "express";
import { routeQuery } from "./manager.js";
import { getQueue, reviewDraft } from "./waitingRoom.js";
import { updateExpertStatus } from "./store.js";

const app = express();
app.use(express.json());

app.post("/query", async (req, res) => {
  try {
    const {
      menteeId,
      expertId,
      mem9SpaceId,
      expertName,
      query,
      continueSessionId,
      sprintContract,
      autoSprintContract,
      sprintMode,
    } = req.body;
    if (!menteeId || !expertId || !query) {
      return res.status(400).json({ error: "menteeId, expertId, and query are required" });
    }
    const result = await routeQuery({
      menteeId,
      expertId,
      mem9SpaceId,
      expertName,
      query,
      continueSessionId,
      sprintContract,
      autoSprintContract: !!autoSprintContract,
      sprintMode: sprintMode === "coaching" ? "coaching" : "vetting",
    });
    res.json(result);
  } catch (err) {
    console.error("[POST /query]", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/queue/:expertId", async (req, res) => {
  try {
    const queue = await getQueue(req.params.expertId);
    res.json({ items: queue });
  } catch (err) {
    console.error("[GET /queue]", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/review/:draftId", async (req, res) => {
  try {
    const { action, editedResponse } = req.body;
    if (!action || !["approve", "reject"].includes(action)) {
      return res.status(400).json({ error: "action must be 'approve' or 'reject'" });
    }
    const result = await reviewDraft(req.params.draftId, { action, editedResponse });
    res.json(result);
  } catch (err) {
    console.error("[POST /review]", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/expert-status", async (req, res) => {
  try {
    const { expertId, isOnline } = req.body;
    if (!expertId) return res.status(400).json({ error: "expertId required" });
    await updateExpertStatus(expertId, !!isOnline);
    res.json({ ok: true });
  } catch (err) {
    console.error("[POST /expert-status]", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`[expert-shadow-service] listening on :${PORT}`));
