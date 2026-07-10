"use client";

import { useEffect, useRef, useState } from "react";
import {
  WORKSPACE_CONTEXT_EVENT,
  createEmptyWorkspaceContext,
  readWorkspaceContext,
  sanitizeWorkspaceContext,
  writeWorkspaceContext,
  type WorkspaceContext,
} from "@/lib/workspaceContext";

const SYNC_DELAY_MS = 1200;

export default function WorkspaceContextSync() {
  const [context, setContext] = useState<WorkspaceContext>(createEmptyWorkspaceContext());
  const isHydratingRef = useRef(true);
  const lastSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    setContext(readWorkspaceContext());

    function onWorkspaceContext(event: Event) {
      const detail = "detail" in event ? (event as CustomEvent).detail : null;
      const nextContext = sanitizeWorkspaceContext(detail);
      if (nextContext) {
        setContext(nextContext);
      }
    }

    window.addEventListener(WORKSPACE_CONTEXT_EVENT, onWorkspaceContext);
    return () => window.removeEventListener(WORKSPACE_CONTEXT_EVENT, onWorkspaceContext);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function hydrateFromServer() {
      try {
        const response = await fetch("/api/workspace/context", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        const remoteContext = sanitizeWorkspaceContext(data?.context);
        const localContext = readWorkspaceContext();

        if (!remoteContext) {
          lastSyncedRef.current = serializeComparableContext(localContext);
          return;
        }

        const localTime = new Date(localContext.updatedAt).getTime();
        const remoteTime = new Date(remoteContext.updatedAt).getTime();
        const nextContext = remoteTime > localTime ? remoteContext : localContext;

        if (!cancelled && serializeComparableContext(nextContext) !== serializeComparableContext(localContext)) {
          writeWorkspaceContext(nextContext);
        }

        lastSyncedRef.current = serializeComparableContext(nextContext);
      } finally {
        isHydratingRef.current = false;
      }
    }

    void hydrateFromServer();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (isHydratingRef.current) return;

    const comparable = serializeComparableContext(context);
    if (comparable === lastSyncedRef.current) return;

    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/workspace/context", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context,
            deckId: context.activeStudySet?.deckId || null,
          }),
        });
        if (!response.ok) return;
        lastSyncedRef.current = comparable;
      } catch {
        // Silent failure: local workspace context should continue working offline.
      }
    }, SYNC_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [context]);

  return null;
}

function serializeComparableContext(context: WorkspaceContext) {
  return JSON.stringify({
    ...context,
    updatedAt: null,
    whiteboardReference: context.whiteboardReference
      ? { ...context.whiteboardReference, updatedAt: null }
      : null,
    presentationReference: context.presentationReference
      ? { ...context.presentationReference, updatedAt: null }
      : null,
    uploadedAssets: context.uploadedAssets.map((asset) => ({ ...asset, updatedAt: null })),
    recentTutorInteractions: context.recentTutorInteractions.map((item) => ({
      ...item,
      createdAt: null,
    })),
  });
}