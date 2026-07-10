import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  createEmptyWorkspaceContext,
  sanitizeWorkspaceContext,
  type WorkspaceContext,
} from "@/lib/workspaceContext";

const WORKSPACE_CONTEXT_MODE = "workspace_context_state";
const WORKSPACE_CONTEXT_ORIGIN = "workspace_context_sync";
const MAX_PERSISTED_SNAPSHOTS = 24;

type WorkspaceContextMetadata = {
  workspaceContext?: unknown;
};

export async function getLatestPersistedWorkspaceContext(userId: string) {
  const latest = await prisma.reasoningRun.findFirst({
    where: {
      userId,
      mode: WORKSPACE_CONTEXT_MODE,
      origin: WORKSPACE_CONTEXT_ORIGIN,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      metadata: true,
    },
  });

  if (!latest) {
    return { context: null, savedAt: null, runId: null };
  }

  const metadata = (latest.metadata as WorkspaceContextMetadata | null) ?? null;
  return {
    context: sanitizeWorkspaceContext(metadata?.workspaceContext) ?? null,
    savedAt: latest.createdAt.toISOString(),
    runId: latest.id,
  };
}

export async function persistWorkspaceContextSnapshot(input: {
  userId: string;
  deckId?: string | null;
  context: WorkspaceContext;
}) {
  const sanitizedContext = sanitizeWorkspaceContext(input.context) ?? createEmptyWorkspaceContext();
  const latest = await getLatestPersistedWorkspaceContext(input.userId);

  if (latest.context && serializeComparableContext(latest.context) === serializeComparableContext(sanitizedContext)) {
    return {
      context: latest.context,
      savedAt: latest.savedAt,
      reused: true,
    };
  }

  const title = buildContextTitle(sanitizedContext);

  const saved = await prisma.reasoningRun.create({
    data: {
      userId: input.userId,
      deckId: input.deckId || sanitizedContext.activeStudySet?.deckId || null,
      mode: WORKSPACE_CONTEXT_MODE,
      origin: WORKSPACE_CONTEXT_ORIGIN,
      title,
      metadata: {
        workspaceContext: sanitizedContext,
      } as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      createdAt: true,
    },
  });

  await pruneOlderWorkspaceContextSnapshots(input.userId);

  return {
    context: sanitizedContext,
    savedAt: saved.createdAt.toISOString(),
    reused: false,
  };
}

async function pruneOlderWorkspaceContextSnapshots(userId: string) {
  const oldRuns = await prisma.reasoningRun.findMany({
    where: {
      userId,
      mode: WORKSPACE_CONTEXT_MODE,
      origin: WORKSPACE_CONTEXT_ORIGIN,
    },
    orderBy: { createdAt: "desc" },
    skip: MAX_PERSISTED_SNAPSHOTS,
    select: { id: true },
  });

  if (!oldRuns.length) return;

  await prisma.reasoningRun.deleteMany({
    where: {
      id: { in: oldRuns.map((run) => run.id) },
    },
  });
}

function buildContextTitle(context: WorkspaceContext) {
  if (context.whiteboardReference?.boardName) {
    return `Workspace context: ${context.whiteboardReference.boardName}`;
  }
  if (context.presentationReference?.title) {
    return `Workspace context: ${context.presentationReference.title}`;
  }
  if (context.activeStudySet?.focusConcept) {
    return `Workspace context: ${context.activeStudySet.focusConcept}`;
  }
  return "Workspace context snapshot";
}

function serializeComparableContext(context: WorkspaceContext) {
  const comparable = {
    ...context,
    updatedAt: null,
    whiteboardReference: context.whiteboardReference
      ? { ...context.whiteboardReference, updatedAt: null }
      : null,
    presentationReference: context.presentationReference
      ? { ...context.presentationReference, updatedAt: null }
      : null,
    uploadedAssets: context.uploadedAssets.map((asset) => ({ ...asset, updatedAt: null })),
    recentTutorInteractions: context.recentTutorInteractions.map((item) => ({ ...item, createdAt: null })),
  };

  return JSON.stringify(comparable);
}