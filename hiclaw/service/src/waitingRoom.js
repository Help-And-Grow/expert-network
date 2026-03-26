import { v4 as uuidv4 } from "uuid";
import { pool } from "./store.js";

export async function enqueue({ expertId, menteeId, sessionId, draft }) {
  const id = uuidv4();
  await pool.execute(
    `INSERT INTO waiting_room (id, expert_id, mentee_id, session_id, draft, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
    [id, expertId, menteeId, sessionId, draft]
  );
  return id;
}

export async function getQueue(expertId) {
  const [rows] = await pool.execute(
    `SELECT id, mentee_id, session_id, draft, edited_response, status, created_at
     FROM waiting_room
     WHERE expert_id = ? AND status = 'pending'
     ORDER BY created_at ASC`,
    [expertId]
  );
  return rows;
}

export async function getDraft(draftId) {
  const [rows] = await pool.execute(
    "SELECT * FROM waiting_room WHERE id = ?",
    [draftId]
  );
  return rows[0] || null;
}

/**
 * Review a draft — approve (with optional edits) or reject.
 * On approval, marks the linked session as completed.
 */
export async function reviewDraft(draftId, { action, editedResponse }) {
  if (action === "approve") {
    const finalResponse = editedResponse || null;
    await pool.execute(
      `UPDATE waiting_room SET status = 'approved', edited_response = ? WHERE id = ?`,
      [finalResponse, draftId]
    );

    const draft = await getDraft(draftId);
    if (draft?.session_id) {
      await pool.execute(
        `UPDATE sessions SET status = 'completed', completed_at = NOW() WHERE id = ?`,
        [draft.session_id]
      );
    }

    return { status: "approved", sessionId: draft?.session_id };
  }

  if (action === "reject") {
    await pool.execute(
      "UPDATE waiting_room SET status = 'rejected' WHERE id = ?",
      [draftId]
    );
    return { status: "rejected" };
  }

  throw new Error(`Invalid action: ${action}`);
}
