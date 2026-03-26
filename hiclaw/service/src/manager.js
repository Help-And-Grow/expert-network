import { v4 as uuidv4 } from "uuid";
import {
  checkExpertStatus,
  createSession,
  getSession,
  updateSession,
  insertEvaluatorCritique,
} from "./store.js";
import { generate as shadowGenerate, refineDraft } from "./shadowWorker.js";
import { evaluateDraft } from "./evaluatorWorker.js";
import { enqueue } from "./waitingRoom.js";
import { getExpertContext, getProfileSummary } from "./mem9Client.js";
import { proposeSprintContract } from "./plannerWorker.js";

const EVALUATOR_ENABLED = process.env.EVALUATOR_ENABLED !== "false";
const EVALUATOR_MAX_ROUNDS = Math.max(1, Number(process.env.EVALUATOR_MAX_ROUNDS || 3));

function safeParseMessages(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Route a mentee query to the appropriate handler:
 * - Online expert: forward directly (returns routing info)
 * - Offline expert: shadow worker + evaluator loop, enqueue for expert review
 *
 * Optional body.continueSessionId: resume thread (same mentee + expert); updates conversation_messages.
 */
export async function routeQuery({
  menteeId,
  expertId,
  mem9SpaceId,
  expertName,
  query,
  continueSessionId = null,
  sprintContract = null,
  autoSprintContract = false,
  sprintMode = "vetting",
}) {
  const { isOnline } = await checkExpertStatus(expertId);

  let sessionId;
  let priorMessages = [];
  let handoffArtifact = null;
  let mem9ProfileSummary = "";

  if (continueSessionId) {
    const existing = await getSession(continueSessionId);
    if (
      existing &&
      String(existing.mentee_id) === String(menteeId) &&
      String(existing.expert_id) === String(expertId)
    ) {
      sessionId = continueSessionId;
      priorMessages = safeParseMessages(existing.conversation_messages);
      handoffArtifact = existing.handoff_artifact || null;
      mem9ProfileSummary = existing.mem9_profile_summary || "";
      priorMessages.push({ role: "user", content: query });
      await updateSession(sessionId, {
        query,
        conversationMessages: JSON.stringify(priorMessages),
      });
    }
  }

  if (!sessionId) {
    sessionId = uuidv4();
    priorMessages = [{ role: "user", content: query }];
    if (mem9SpaceId && process.env.MEM9_ENABLED !== "false") {
      try {
        mem9ProfileSummary = await getProfileSummary(mem9SpaceId);
      } catch (e) {
        console.warn("[manager] mem9 profile summary failed:", e);
      }
    }
    await createSession({
      id: sessionId,
      expertId,
      menteeId,
      query,
      conversationMessages: JSON.stringify(priorMessages),
      mem9ProfileSummary: mem9ProfileSummary || null,
      handoffArtifact: null,
    });
  }

  if (isOnline) {
    return {
      status: "forwarded",
      sessionId,
      message: `Query forwarded to ${expertName || "expert"} who is currently online.`,
    };
  }

  let mem9Context = "";
  if (mem9SpaceId && process.env.MEM9_ENABLED !== "false") {
    try {
      mem9Context = await getExpertContext(mem9SpaceId, query);
    } catch (e) {
      console.warn("[manager] mem9 context failed:", e);
    }
  }

  let effectiveSprintContract = sprintContract;
  if (!effectiveSprintContract && autoSprintContract) {
    try {
      effectiveSprintContract = await proposeSprintContract({
        expertName: expertName || "Expert",
        mem9Context,
        menteeQuery: query,
        mode: sprintMode === "coaching" ? "coaching" : "vetting",
      });
    } catch (e) {
      console.warn("[manager] sprint contract planner failed:", e);
    }
  }

  const onContextReset = async (artifact, replacementMessages) => {
    await updateSession(sessionId, {
      handoffArtifact: artifact,
      conversationMessages: JSON.stringify(replacementMessages),
    });
    handoffArtifact = artifact;
    priorMessages = replacementMessages;
  };

  let draft = await shadowGenerate({
    expertId,
    mem9SpaceId,
    expertName: expertName || "Expert",
    query,
    mem9Context,
    mem9ProfileSummary,
    sprintContract: effectiveSprintContract,
    priorMessages,
    handoffArtifact,
    onContextReset,
  });

  const afterGen = await getSession(sessionId);
  if (afterGen) {
    priorMessages = safeParseMessages(afterGen.conversation_messages);
    if (afterGen.handoff_artifact) handoffArtifact = afterGen.handoff_artifact;
    if (afterGen.mem9_profile_summary) mem9ProfileSummary = afterGen.mem9_profile_summary;
  }

  if (EVALUATOR_ENABLED) {
    let round = 0;
    while (round < EVALUATOR_MAX_ROUNDS) {
      const evalResult = await evaluateDraft({
        draft,
        expertName: expertName || "Expert",
        menteeQuery: query,
        mem9Context,
        sprintContract: effectiveSprintContract,
      });

      await insertEvaluatorCritique({
        sessionId,
        draftRound: round,
        passed: evalResult.pass,
        scoresJson: {
          overallScore: evalResult.overallScore,
          ...evalResult.scores,
        },
        critique: evalResult.critique,
        draftExcerpt: draft.slice(0, 2000),
      });

      if (evalResult.pass) break;

      round += 1;
      if (round >= EVALUATOR_MAX_ROUNDS) break;

      draft = await refineDraft({
        expertId,
        mem9SpaceId,
        expertName: expertName || "Expert",
        menteeQuery: query,
        priorDraft: draft,
        critique: evalResult.critique,
        mem9Context,
        mem9ProfileSummary,
        sprintContract: effectiveSprintContract,
        priorMessages,
        handoffArtifact,
      });
    }
  }

  const draftId = await enqueue({
    expertId,
    menteeId,
    sessionId,
    draft,
  });

  return {
    status: "pending_review",
    sessionId,
    draftId,
    message: `${expertName || "Expert"} is offline. A draft response has been generated and is awaiting their review.`,
  };
}
