import type { ApiState, DraftState, DiffEntry, RoutingScopeRow, RouteOverrideRow } from "./shared-types";

/**
 * Compare the current draft against the API state and produce a list of
 * human-readable diff entries for the "Confirm changes" dialog.
 */
export function diffDrafts(api: ApiState, draft: DraftState): DiffEntry[] {
  const out: DiffEntry[] = [];
  if (draft.activeLlm !== api.active.llm) {
    out.push({
      label: "Active LLM",
      before: api.active.llm,
      after: draft.activeLlm,
    });
  }
  if (draft.activeStorage !== api.active.storage) {
    out.push({
      label: "Active Storage",
      before: api.active.storage,
      after: draft.activeStorage,
    });
  }
  const before = api.active.llmImageChain.join(",") || "(default)";
  const after = draft.llmImageChain.join(",") || "(default)";
  if (before !== after) {
    out.push({ label: "Image chain", before, after });
  }
  const vBefore = api.active.llmVoiceChain.join(",") || "(default)";
  const vAfter = draft.llmVoiceChain.join(",") || "(default)";
  if (vBefore !== vAfter) {
    out.push({ label: "Voice chain", before: vBefore, after: vAfter });
  }
  for (const row of api.llm) {
    const draftEntry = draft.models[row.key];
    if (!draftEntry) continue;
    const textDefault = row.models.text?.default ?? "";
    const imageDefault = row.models.image?.default ?? "";
    if (
      draftEntry.textModel !== undefined &&
      draftEntry.textModel !== textDefault
    ) {
      out.push({
        label: `${row.displayName} text model`,
        before: textDefault || "(unset)",
        after: draftEntry.textModel || "(unset)",
      });
    }
    if (
      draftEntry.imageModel !== undefined &&
      draftEntry.imageModel !== imageDefault
    ) {
      out.push({
        label: `${row.displayName} image model`,
        before: imageDefault || "(unset)",
        after: draftEntry.imageModel || "(unset)",
      });
    }
  }

  // Routing scope diffs.
  const allScopes: RoutingScopeRow[] = [
    ...api.routing.scopes.llm,
    ...api.routing.scopes.image,
    ...api.routing.scopes.voice,
    ...api.routing.scopes.storage,
  ];
  for (const scope of allScopes) {
    const dk = `${scope.category}:${scope.scopeKey}`;
    const d = draft.scopes[dk];
    if (!d) continue;
    const beforeChain = scope.chain.join(",") || "(empty)";
    const afterChain = d.chain.join(",") || "(empty)";
    if (beforeChain !== afterChain) {
      out.push({
        label: `Scope ${scope.category}/${scope.scopeKey} chain`,
        before: beforeChain,
        after: afterChain,
      });
    }
    if (d.enabled !== scope.enabled) {
      out.push({
        label: `Scope ${scope.category}/${scope.scopeKey} enabled`,
        before: String(scope.enabled),
        after: String(d.enabled),
      });
    }
  }

  // Route override diffs.
  const allOverrides: RouteOverrideRow[] = [
    ...api.routing.overrides.llm,
    ...api.routing.overrides.image,
    ...api.routing.overrides.voice,
    ...api.routing.overrides.storage,
  ];
  for (const o of allOverrides) {
    const dk = `${o.category}:${o.routePattern}`;
    const d = draft.overrides[dk];
    if (!d) continue;
    const beforeChain = o.chainOverride.join(",") || "(empty)";
    const afterChain = d.chainOverride.join(",") || "(empty)";
    if (beforeChain !== afterChain) {
      out.push({
        label: `Override ${o.category} ${o.routePattern}`,
        before: beforeChain,
        after: afterChain,
      });
    }
    if (d.enabled !== o.enabled) {
      out.push({
        label: `Override ${o.category} ${o.routePattern} enabled`,
        before: String(o.enabled),
        after: String(d.enabled),
      });
    }
  }
  for (const [k, d] of Object.entries(draft.overrides)) {
    if (!d.isNew) continue;
    out.push({
      label: `New override ${d.category} ${d.routePattern}`,
      before: "(none)",
      after: d.chainOverride.join(",") || "(empty)",
    });
    void k;
  }
  for (const del of draft.deletedOverrides) {
    out.push({
      label: `Delete override ${del.category} ${del.routePattern}`,
      before: "(exists)",
      after: "(removed)",
    });
  }

  // Cloud region settings.
  for (const r of api.cloudRegions ?? []) {
    if (r.readonly) continue;
    const before = r.dbValue ?? "";
    const after = draft.cloudRegions?.[r.key] ?? "";
    if (before !== after) {
      out.push({
        label: `Region ${r.label} (${r.key})`,
        before: before || "(unset — using env/default)",
        after: after || "(unset — using env/default)",
      });
    }
  }
  return out;
}
