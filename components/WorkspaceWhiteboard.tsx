"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import PremiumUpsellModal from "@/components/PremiumUpsellModal";
import { getUpgradePrompt, type PremiumApiResponse, type UpgradePrompt } from "@/lib/clientBilling";
import { updateWorkspaceContext, upsertWorkspaceAsset } from "@/lib/workspaceContext";

type WhiteboardAssistIntent = "clean-sketch" | "flowchart" | "relationships" | "visualize";
type ToolMode = "select" | "draw" | "pan" | "rectangle" | "arrow" | "note";
type ResizeHandle = "nw" | "ne" | "sw" | "se";
type BoardPresetId = "concept-map" | "timeline" | "compare-contrast";

type WhiteboardAssistSuggestion = {
  title: string;
  summary: string;
  actions: string[];
  cautions: string[];
  nodes: Array<{ id: string; label: string; x: number; y: number }>;
  connections: Array<{ from: string; to: string; label: string }>;
};

type StrokePoint = { x: number; y: number };
type Stroke = { id: string; color: string; width: number; points: StrokePoint[] };
type PdfViewport = { width: number; height: number };
type PdfPageLike = {
  getViewport: (options: { scale: number }) => PdfViewport;
  render: (options: { canvasContext: CanvasRenderingContext2D; viewport: PdfViewport }) => { promise: Promise<void> };
};
type PdfDocumentLike = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfPageLike>;
  destroy?: () => void;
};

type BoardRectangle = {
  id: string;
  kind: "rectangle";
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
};

type BoardArrow = {
  id: string;
  kind: "arrow";
  start: StrokePoint;
  end: StrokePoint;
  color: string;
};

type BoardShape = BoardRectangle | BoardArrow;

type BoardNote = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
};

type DraftShape = {
  kind: "rectangle" | "arrow";
  start: StrokePoint;
  current: StrokePoint;
};

type PanState = {
  pointerId: number;
  startClient: { x: number; y: number };
  startOffset: { x: number; y: number };
};

type SelectionDragState = {
  pointerId: number;
  startClient: { x: number; y: number };
  strokeOrigins: Array<{ id: string; points: StrokePoint[] }>;
  noteOrigins: Array<{ id: string; x: number; y: number }>;
  shapeOrigins: Array<{ id: string; kind: BoardShape["kind"]; x?: number; y?: number; start?: StrokePoint; end?: StrokePoint }>;
};

type ResizeState =
  | {
      pointerId: number;
      kind: "note";
      noteId: string;
      handle: ResizeHandle;
      origin: { x: number; y: number; width: number; height: number };
      startClient: { x: number; y: number };
    }
  | {
      pointerId: number;
      kind: "rectangle";
      shapeId: string;
      handle: ResizeHandle;
      origin: { x: number; y: number; width: number; height: number };
      startClient: { x: number; y: number };
    }
  | {
      pointerId: number;
      kind: "arrow-start" | "arrow-end";
      shapeId: string;
      startClient: { x: number; y: number };
      originStart: StrokePoint;
      originEnd: StrokePoint;
    };

type SelectionBox = {
  pointerId: number;
  start: StrokePoint;
  current: StrokePoint;
  append: boolean;
};

type PersistedWhiteboardState = {
  strokes: Stroke[];
  shapes: BoardShape[];
  notes: BoardNote[];
  annotations: string[];
  workspaceGoal: string;
  toolMode: ToolMode;
  viewportScale: number;
  viewportOffset: { x: number; y: number };
};

type RemoteBoardSummary = {
  boardId: string;
  boardName: string;
  savedAt: string;
};

type WhiteboardStateResponse = {
  ok: boolean;
  boards?: RemoteBoardSummary[];
  snapshot?: PersistedWhiteboardState | null;
  savedAt?: string | null;
  boardId?: string | null;
  boardName?: string | null;
  deletedCount?: number;
  error?: string;
};

const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 560;
const WHITEBOARD_STORAGE_KEY = "quickstud:workspace-whiteboard-v4";
const DEFAULT_NOTE_COLOR = "#FEF3C7";
const DEFAULT_NOTE_WIDTH = 180;
const DEFAULT_NOTE_HEIGHT = 120;
const MIN_NOTE_WIDTH = 140;
const MIN_NOTE_HEIGHT = 90;
const MIN_RECT_WIDTH = 60;
const MIN_RECT_HEIGHT = 50;
const HISTORY_LIMIT = 40;

const BOARD_PRESETS: Array<{
  id: BoardPresetId;
  label: string;
  description: string;
  create: () => Pick<PersistedWhiteboardState, "notes" | "shapes" | "annotations" | "workspaceGoal">;
}> = [
  {
    id: "concept-map",
    label: "Concept map",
    description: "Central concept with surrounding supporting ideas.",
    create: () => ({
      workspaceGoal: "Explain the central idea and its supporting concepts.",
      annotations: ["Use the center note for the main topic and the outer notes for key ideas."],
      notes: [
        createNote("Main concept", 380, 210, "#DBEAFE", 200, 124),
        createNote("Key idea 1", 120, 90, DEFAULT_NOTE_COLOR),
        createNote("Key idea 2", 650, 90, DEFAULT_NOTE_COLOR),
        createNote("Evidence", 120, 360, "#FCE7F3"),
        createNote("Example", 650, 360, "#DCFCE7"),
      ],
      shapes: [
        createArrow({ x: 300, y: 150 }, { x: 390, y: 230 }),
        createArrow({ x: 660, y: 150 }, { x: 570, y: 230 }),
        createArrow({ x: 300, y: 410 }, { x: 390, y: 330 }),
        createArrow({ x: 660, y: 410 }, { x: 570, y: 330 }),
      ],
    }),
  },
  {
    id: "timeline",
    label: "Timeline",
    description: "Lay out events or steps across a sequence.",
    create: () => ({
      workspaceGoal: "Organize the sequence from first step to final outcome.",
      annotations: ["Move each note as needed and add arrows for branching."],
      notes: [
        createNote("Start", 40, 200, "#DBEAFE", 150, 104),
        createNote("Step 2", 250, 200, DEFAULT_NOTE_COLOR, 150, 104),
        createNote("Step 3", 460, 200, DEFAULT_NOTE_COLOR, 150, 104),
        createNote("Result", 670, 200, "#DCFCE7", 150, 104),
      ],
      shapes: [
        createArrow({ x: 190, y: 252 }, { x: 250, y: 252 }),
        createArrow({ x: 400, y: 252 }, { x: 460, y: 252 }),
        createArrow({ x: 610, y: 252 }, { x: 670, y: 252 }),
      ],
    }),
  },
  {
    id: "compare-contrast",
    label: "Compare/contrast",
    description: "Two columns with a shared bridge between them.",
    create: () => ({
      workspaceGoal: "Compare two ideas and surface the most important differences.",
      annotations: ["Put shared ground in the center and contrasting details on each side."],
      notes: [
        createNote("Idea A", 70, 80, "#FCE7F3", 220, 120),
        createNote("Idea B", 670, 80, "#DBEAFE", 220, 120),
        createNote("Shared criteria", 350, 210, DEFAULT_NOTE_COLOR, 260, 124),
        createNote("Distinct features", 70, 380, "#FDE68A", 220, 120),
        createNote("Distinct features", 670, 380, "#BFDBFE", 220, 120),
      ],
      shapes: [
        createArrow({ x: 290, y: 140 }, { x: 350, y: 260 }),
        createArrow({ x: 670, y: 140 }, { x: 610, y: 260 }),
        createArrow({ x: 290, y: 440 }, { x: 350, y: 300 }),
        createArrow({ x: 670, y: 440 }, { x: 610, y: 300 }),
      ],
    }),
  },
];

export default function WorkspaceWhiteboard() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boardViewportRef = useRef<HTMLDivElement | null>(null);
  const drawingStrokeRef = useRef<Stroke | null>(null);
  const pdfDocumentRef = useRef<PdfDocumentLike | null>(null);
  const sourceObjectUrlRef = useRef<string | null>(null);
  const historyTimeoutRef = useRef<number | null>(null);
  const undoStackRef = useRef<PersistedWhiteboardState[]>([]);
  const redoStackRef = useRef<PersistedWhiteboardState[]>([]);
  const historyBaselineRef = useRef<PersistedWhiteboardState | null>(null);
  const historySuspendRef = useRef(false);

  const [toolMode, setToolMode] = useState<ToolMode>("select");
  const [penColor, setPenColor] = useState("#0f172a");
  const [penWidth, setPenWidth] = useState(3);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [shapes, setShapes] = useState<BoardShape[]>([]);
  const [notes, setNotes] = useState<BoardNote[]>([]);
  const [annotationDraft, setAnnotationDraft] = useState("");
  const [annotations, setAnnotations] = useState<string[]>([]);
  const [workspaceGoal, setWorkspaceGoal] = useState("");
  const [sourceAttachmentName, setSourceAttachmentName] = useState<string | null>(null);
  const [sourceAttachmentUrl, setSourceAttachmentUrl] = useState<string | null>(null);
  const [sourceOverlayKind, setSourceOverlayKind] = useState<"image" | "pdf" | null>(null);
  const [pdfPageCount, setPdfPageCount] = useState(0);
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [assistLoading, setAssistLoading] = useState<WhiteboardAssistIntent | null>(null);
  const [assistSuggestion, setAssistSuggestion] = useState<WhiteboardAssistSuggestion | null>(null);
  const [showOverlayGuide, setShowOverlayGuide] = useState(true);
  const [draftShape, setDraftShape] = useState<DraftShape | null>(null);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [selectionDragState, setSelectionDragState] = useState<SelectionDragState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [viewportScale, setViewportScale] = useState(1);
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 });
  const [selectedStrokeIds, setSelectedStrokeIds] = useState<string[]>([]);
  const [selectedNoteIds, setSelectedNoteIds] = useState<string[]>([]);
  const [selectedShapeIds, setSelectedShapeIds] = useState<string[]>([]);
  const [hasHydratedLocalState, setHasHydratedLocalState] = useState(false);
  const [hasLocalSnapshot, setHasLocalSnapshot] = useState(false);
  const [remoteSyncLoading, setRemoteSyncLoading] = useState(false);
  const [remoteSyncSaving, setRemoteSyncSaving] = useState(false);
  const [remoteSavedAt, setRemoteSavedAt] = useState<string | null>(null);
  const [remoteBoards, setRemoteBoards] = useState<RemoteBoardSummary[]>([]);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const [boardName, setBoardName] = useState("Untitled board");
  const [renamingBoardId, setRenamingBoardId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [upgradePrompt, setUpgradePrompt] = useState<UpgradePrompt | null>(null);

  function currentSnapshot(): PersistedWhiteboardState {
    return {
      strokes,
      shapes,
      notes,
      annotations,
      workspaceGoal,
      toolMode,
      viewportScale,
      viewportOffset,
    };
  }

  function syncHistoryFlags() {
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }

  function clearSelection() {
    setSelectedStrokeIds([]);
    setSelectedNoteIds([]);
    setSelectedShapeIds([]);
  }

  function applySnapshot(snapshot: PersistedWhiteboardState, options?: { preserveTool?: boolean; clearSelection?: boolean }) {
    setStrokes(Array.isArray(snapshot.strokes) ? snapshot.strokes : []);
    setShapes(Array.isArray(snapshot.shapes) ? snapshot.shapes : []);
    setNotes(Array.isArray(snapshot.notes) ? snapshot.notes : []);
    setAnnotations(Array.isArray(snapshot.annotations) ? snapshot.annotations.slice(0, 8) : []);
    setWorkspaceGoal(typeof snapshot.workspaceGoal === "string" ? snapshot.workspaceGoal : "");
    if (!options?.preserveTool) {
      setToolMode(isToolMode(snapshot.toolMode) ? snapshot.toolMode : "select");
    }
    setViewportScale(clamp(Number(snapshot.viewportScale) || 1, 0.6, 2.5));
    setViewportOffset({
      x: Number(snapshot.viewportOffset?.x) || 0,
      y: Number(snapshot.viewportOffset?.y) || 0,
    });
    if (options?.clearSelection !== false) {
      clearSelection();
    }
  }

  function setHistoryBaseline(snapshot: PersistedWhiteboardState) {
    historyBaselineRef.current = cloneSnapshot(snapshot);
  }

  function restoreSnapshot(snapshot: PersistedWhiteboardState) {
    historySuspendRef.current = true;
    applySnapshot(snapshot);
    setHistoryBaseline(snapshot);
    window.setTimeout(() => {
      historySuspendRef.current = false;
    }, 0);
  }

  function createNewBoard() {
    historySuspendRef.current = true;
    setStrokes([]);
    setShapes([]);
    setNotes([]);
    setAnnotations([]);
    setAnnotationDraft("");
    setWorkspaceGoal("");
    setAssistSuggestion(null);
    setShowOverlayGuide(true);
    setToolMode("select");
    setViewportScale(1);
    setViewportOffset({ x: 0, y: 0 });
    clearSelection();
    setActiveBoardId(null);
    setBoardName("Untitled board");
    setRemoteSavedAt(null);
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncHistoryFlags();
    const emptySnapshot = createEmptySnapshot();
    setHistoryBaseline(emptySnapshot);
    window.setTimeout(() => {
      historySuspendRef.current = false;
    }, 0);
  }

  useEffect(() => {
    const raw = window.localStorage.getItem(WHITEBOARD_STORAGE_KEY);
    if (!raw) {
      setHistoryBaseline(createEmptySnapshot());
      setHasHydratedLocalState(true);
      return;
    }

    try {
      const saved = JSON.parse(raw) as Partial<PersistedWhiteboardState>;
      const snapshot = sanitizePersistedState(saved);
      applySnapshot(snapshot);
      setHistoryBaseline(snapshot);
      setHasLocalSnapshot(hasMeaningfulBoardContent(snapshot));
    } catch {
      window.localStorage.removeItem(WHITEBOARD_STORAGE_KEY);
      setHistoryBaseline(createEmptySnapshot());
    } finally {
      setHasHydratedLocalState(true);
    }
  }, []);

  useEffect(() => {
    if (!hasHydratedLocalState) return;
    const snapshot = currentSnapshot();
    window.localStorage.setItem(WHITEBOARD_STORAGE_KEY, JSON.stringify(snapshot));
    setHasLocalSnapshot(hasMeaningfulBoardContent(snapshot));
  }, [annotations, hasHydratedLocalState, notes, shapes, strokes, toolMode, viewportOffset, viewportScale, workspaceGoal]);

  useEffect(() => {
    if (!hasHydratedLocalState) return;

    updateWorkspaceContext((currentContext) => {
      const nextAsset = sourceAttachmentName
        ? {
            id: `whiteboard:${sourceAttachmentName}`,
            kind: sourceOverlayKind || "file",
            name: sourceAttachmentName,
            source: "whiteboard" as const,
            updatedAt: new Date().toISOString(),
          }
        : null;

      return {
        ...currentContext,
        whiteboardReference: {
          boardId: activeBoardId,
          boardName: boardName.trim() || "Untitled board",
          workspaceGoal: workspaceGoal.trim() || null,
          noteCount: notes.length,
          shapeCount: shapes.length,
          strokeCount: strokes.length,
          selectedCount: selectedStrokeIds.length + selectedNoteIds.length + selectedShapeIds.length,
          annotationCount: annotations.length,
          sourceAttachmentName,
          sourceOverlayKind,
          updatedAt: new Date().toISOString(),
        },
        uploadedAssets: nextAsset ? upsertWorkspaceAsset(currentContext.uploadedAssets, nextAsset) : currentContext.uploadedAssets,
      };
    });
  }, [
    activeBoardId,
    annotations.length,
    boardName,
    hasHydratedLocalState,
    notes.length,
    selectedNoteIds.length,
    selectedShapeIds.length,
    selectedStrokeIds.length,
    shapes.length,
    sourceAttachmentName,
    sourceOverlayKind,
    strokes.length,
    workspaceGoal,
  ]);

  useEffect(() => {
    if (!hasHydratedLocalState || historySuspendRef.current) return;
    const snapshot = currentSnapshot();
    if (!historyBaselineRef.current) {
      setHistoryBaseline(snapshot);
      return;
    }
    if (serializeSnapshot(snapshot) === serializeSnapshot(historyBaselineRef.current)) return;

    if (historyTimeoutRef.current) {
      window.clearTimeout(historyTimeoutRef.current);
    }

    historyTimeoutRef.current = window.setTimeout(() => {
      const baseline = historyBaselineRef.current;
      if (!baseline) return;
      const nextSnapshot = currentSnapshot();
      if (serializeSnapshot(nextSnapshot) === serializeSnapshot(baseline)) return;
      undoStackRef.current = [...undoStackRef.current, cloneSnapshot(baseline)].slice(-HISTORY_LIMIT);
      redoStackRef.current = [];
      setHistoryBaseline(nextSnapshot);
      syncHistoryFlags();
    }, 220);

    return () => {
      if (historyTimeoutRef.current) {
        window.clearTimeout(historyTimeoutRef.current);
      }
    };
  }, [annotations, hasHydratedLocalState, notes, shapes, strokes, toolMode, viewportOffset, viewportScale, workspaceGoal]);

  useEffect(() => {
    if (!hasHydratedLocalState) return;

    let cancelled = false;

    async function loadRemoteBoards() {
      setRemoteSyncLoading(true);
      try {
        const response = await fetch("/api/workspace/whiteboard-state", { cache: "no-store" });
        const data = (await response.json()) as WhiteboardStateResponse;
        if (!response.ok || !data.ok) {
          throw new Error(data.error || "We couldn't reach your saved workspace boards.");
        }
        if (cancelled) return;
        setRemoteBoards(data.boards || []);
        setRemoteSavedAt(data.savedAt || null);
        if (data.boardId) {
          setActiveBoardId(data.boardId);
          setBoardName(data.boardName || "Untitled board");
        }
        if (data.snapshot && !hasLocalSnapshot) {
          historySuspendRef.current = true;
          applySnapshot(sanitizePersistedState(data.snapshot));
          setHistoryBaseline(sanitizePersistedState(data.snapshot));
          window.setTimeout(() => {
            historySuspendRef.current = false;
          }, 0);
        }
      } catch (error) {
        if (!cancelled && error instanceof Error && !/Unauthorized/i.test(error.message)) {
          toast.error(error.message);
        }
      } finally {
        if (!cancelled) setRemoteSyncLoading(false);
      }
    }

    void loadRemoteBoards();

    return () => {
      cancelled = true;
    };
  }, [hasHydratedLocalState, hasLocalSnapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    for (const stroke of strokes) {
      drawStroke(context, stroke);
    }
  }, [strokes]);

  useEffect(() => {
    function onPointerMove(event: PointerEvent) {
      if (panState && event.pointerId === panState.pointerId) {
        setViewportOffset({
          x: panState.startOffset.x + (event.clientX - panState.startClient.x),
          y: panState.startOffset.y + (event.clientY - panState.startClient.y),
        });
        return;
      }

      if (selectionDragState && event.pointerId === selectionDragState.pointerId) {
        const deltaX = (event.clientX - selectionDragState.startClient.x) / viewportScale;
        const deltaY = (event.clientY - selectionDragState.startClient.y) / viewportScale;

        setStrokes((current) => current.map((stroke) => {
          const origin = selectionDragState.strokeOrigins.find((item) => item.id === stroke.id);
          if (!origin) return stroke;
          return {
            ...stroke,
            points: origin.points.map((point) => ({
              x: clamp(point.x + deltaX, 0, CANVAS_WIDTH),
              y: clamp(point.y + deltaY, 0, CANVAS_HEIGHT),
            })),
          };
        }));

        setNotes((current) => current.map((note) => {
          const origin = selectionDragState.noteOrigins.find((item) => item.id === note.id);
          if (!origin) return note;
          return {
            ...note,
            x: clamp(origin.x + deltaX, 0, CANVAS_WIDTH - note.width),
            y: clamp(origin.y + deltaY, 0, CANVAS_HEIGHT - note.height),
          };
        }));

        setShapes((current) => current.map((shape) => {
          const origin = selectionDragState.shapeOrigins.find((item) => item.id === shape.id);
          if (!origin) return shape;
          if (shape.kind === "rectangle" && origin.kind === "rectangle") {
            return {
              ...shape,
              x: clamp((origin.x || 0) + deltaX, 0, CANVAS_WIDTH - shape.width),
              y: clamp((origin.y || 0) + deltaY, 0, CANVAS_HEIGHT - shape.height),
            };
          }
          if (shape.kind === "arrow" && origin.kind === "arrow" && origin.start && origin.end) {
            return {
              ...shape,
              start: { x: clamp(origin.start.x + deltaX, 0, CANVAS_WIDTH), y: clamp(origin.start.y + deltaY, 0, CANVAS_HEIGHT) },
              end: { x: clamp(origin.end.x + deltaX, 0, CANVAS_WIDTH), y: clamp(origin.end.y + deltaY, 0, CANVAS_HEIGHT) },
            };
          }
          return shape;
        }));
        return;
      }

      if (resizeState && event.pointerId === resizeState.pointerId) {
        const deltaX = (event.clientX - resizeState.startClient.x) / viewportScale;
        const deltaY = (event.clientY - resizeState.startClient.y) / viewportScale;

        if (resizeState.kind === "note") {
          const nextRect = resizeBox(resizeState.origin, resizeState.handle, deltaX, deltaY, MIN_NOTE_WIDTH, MIN_NOTE_HEIGHT);
          setNotes((current) => current.map((note) => note.id === resizeState.noteId ? { ...note, ...clampRectToBoard(nextRect) } : note));
          return;
        }

        if (resizeState.kind === "rectangle") {
          const nextRect = resizeBox(resizeState.origin, resizeState.handle, deltaX, deltaY, MIN_RECT_WIDTH, MIN_RECT_HEIGHT);
          setShapes((current) => current.map((shape) => shape.id === resizeState.shapeId && shape.kind === "rectangle" ? { ...shape, ...clampRectToBoard(nextRect) } : shape));
          return;
        }

        const nextPoint = {
          x: clamp(resizeState.kind === "arrow-start" ? resizeState.originStart.x + deltaX : resizeState.originEnd.x + deltaX, 0, CANVAS_WIDTH),
          y: clamp(resizeState.kind === "arrow-start" ? resizeState.originStart.y + deltaY : resizeState.originEnd.y + deltaY, 0, CANVAS_HEIGHT),
        };

        setShapes((current) => current.map((shape) => {
          if (shape.id !== resizeState.shapeId || shape.kind !== "arrow") return shape;
          return resizeState.kind === "arrow-start" ? { ...shape, start: nextPoint } : { ...shape, end: nextPoint };
        }));
        return;
      }

      if (selectionBox && event.pointerId === selectionBox.pointerId) {
        const point = getBoardPoint(event.clientX, event.clientY, boardViewportRef.current, viewportOffset, viewportScale);
        if (!point) return;
        setSelectionBox((current) => current ? { ...current, current: point } : current);
      }
    }

    function onPointerUp(event: PointerEvent) {
      if (panState && event.pointerId === panState.pointerId) setPanState(null);
      if (selectionDragState && event.pointerId === selectionDragState.pointerId) setSelectionDragState(null);
      if (resizeState && event.pointerId === resizeState.pointerId) setResizeState(null);
      if (selectionBox && event.pointerId === selectionBox.pointerId) {
        finalizeSelectionBox(selectionBox);
        setSelectionBox(null);
      }
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [panState, resizeState, selectionBox, selectionDragState, viewportOffset, viewportScale]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          redoBoardState();
        } else {
          undoBoardState();
        }
        return;
      }

      if (modifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redoBoardState();
        return;
      }

      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (!selectedStrokeIds.length && !selectedNoteIds.length && !selectedShapeIds.length) return;

      event.preventDefault();
      removeSelectedItems();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedNoteIds, selectedShapeIds, selectedStrokeIds, shapes, notes, strokes, annotations, workspaceGoal, viewportScale, viewportOffset, toolMode]);

  useEffect(() => {
    return () => {
      if (sourceObjectUrlRef.current) URL.revokeObjectURL(sourceObjectUrlRef.current);
      pdfDocumentRef.current?.destroy?.();
      if (historyTimeoutRef.current) window.clearTimeout(historyTimeoutRef.current);
    };
  }, []);

  const boardSummary = useMemo(() => {
    const selectedCount = selectedStrokeIds.length + selectedNoteIds.length + selectedShapeIds.length;
    const selectionText = selectedCount ? `, ${selectedCount} selected` : "";
    return `${strokes.length} sketch stroke${strokes.length === 1 ? "" : "s"}, ${shapes.length} shape${shapes.length === 1 ? "" : "s"}, ${notes.length} note${notes.length === 1 ? "" : "s"}, ${annotations.length} annotation${annotations.length === 1 ? "" : "s"}${selectionText}`;
  }, [annotations.length, notes.length, selectedNoteIds.length, selectedShapeIds.length, selectedStrokeIds.length, shapes.length, strokes.length]);

  const boardTransform = useMemo(
    () => `translate(${viewportOffset.x}px, ${viewportOffset.y}px) scale(${viewportScale})`,
    [viewportOffset.x, viewportOffset.y, viewportScale]
  );

  const selectionBoxRect = selectionBox ? normalizeSelectionBox(selectionBox) : null;
  const canManipulateSelection = toolMode === "select";

  function undoBoardState() {
    if (!undoStackRef.current.length) return;
    const previous = undoStackRef.current[undoStackRef.current.length - 1];
    const current = cloneSnapshot(currentSnapshot());
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, current].slice(-HISTORY_LIMIT);
    syncHistoryFlags();
    restoreSnapshot(previous);
  }

  function redoBoardState() {
    if (!redoStackRef.current.length) return;
    const next = redoStackRef.current[redoStackRef.current.length - 1];
    const current = cloneSnapshot(currentSnapshot());
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, current].slice(-HISTORY_LIMIT);
    syncHistoryFlags();
    restoreSnapshot(next);
  }

  function finalizeSelectionBox(box: SelectionBox) {
    const rect = normalizeSelectionBox(box);
    const selectedStrokes = strokes.filter((stroke) => rectsIntersect(rect, getStrokeBounds(stroke))).map((stroke) => stroke.id);
    const selectedNotes = notes.filter((note) => rectsIntersect(rect, { x: note.x, y: note.y, width: note.width, height: note.height })).map((note) => note.id);
    const selectedShapes = shapes.filter((shape) => rectsIntersect(rect, getShapeBounds(shape))).map((shape) => shape.id);
    setSelectedStrokeIds(box.append ? unionIds(selectedStrokeIds, selectedStrokes) : selectedStrokes);
    setSelectedNoteIds(box.append ? unionIds(selectedNoteIds, selectedNotes) : selectedNotes);
    setSelectedShapeIds(box.append ? unionIds(selectedShapeIds, selectedShapes) : selectedShapes);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (toolMode === "pan") {
      setPanState({
        pointerId: event.pointerId,
        startClient: { x: event.clientX, y: event.clientY },
        startOffset: viewportOffset,
      });
      return;
    }

    const point = getBoardPoint(event.clientX, event.clientY, boardViewportRef.current, viewportOffset, viewportScale);
    if (!point) return;

    if (toolMode === "select") {
      const hitStroke = findStrokeAtPoint(strokes, point);
      if (hitStroke) {
        const nextStrokeIds = event.shiftKey ? toggleId(selectedStrokeIds, hitStroke.id, true) : [hitStroke.id];
        if (!event.shiftKey) {
          setSelectedNoteIds([]);
          setSelectedShapeIds([]);
        }
        setSelectedStrokeIds(nextStrokeIds);
        if (nextStrokeIds.includes(hitStroke.id)) {
          startSelectionDrag(event.pointerId, event.clientX, event.clientY, nextStrokeIds);
        }
        return;
      }

      setSelectionBox({
        pointerId: event.pointerId,
        start: point,
        current: point,
        append: event.shiftKey,
      });
      if (!event.shiftKey) clearSelection();
      return;
    }

    if (toolMode === "draw") {
      const nextStroke: Stroke = { id: createStrokeId(), color: penColor, width: penWidth, points: [point] };
      drawingStrokeRef.current = nextStroke;
      setStrokes((current) => [...current, nextStroke]);
      return;
    }

    if (toolMode === "rectangle" || toolMode === "arrow") {
      setDraftShape({ kind: toolMode, start: point, current: point });
      return;
    }

    if (toolMode === "note") {
      const noteText = annotationDraft.trim() || "New note";
      const note = createNote(noteText, clamp(point.x, 0, CANVAS_WIDTH - DEFAULT_NOTE_WIDTH), clamp(point.y, 0, CANVAS_HEIGHT - DEFAULT_NOTE_HEIGHT), DEFAULT_NOTE_COLOR);
      setNotes((current) => [...current, note]);
      setToolMode("select");
      setSelectedStrokeIds([]);
      setSelectedNoteIds([note.id]);
      setSelectedShapeIds([]);
      if (annotationDraft.trim()) setAnnotationDraft("");
    }
  }

  function handlePointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = getBoardPoint(event.clientX, event.clientY, boardViewportRef.current, viewportOffset, viewportScale);
    if (!point) return;

    if (drawingStrokeRef.current) {
      drawingStrokeRef.current = {
        ...drawingStrokeRef.current,
        points: [...drawingStrokeRef.current.points, point],
      };
      setStrokes((current) => {
        const copy = [...current];
        copy[copy.length - 1] = drawingStrokeRef.current as Stroke;
        return copy;
      });
      return;
    }

    if (draftShape) {
      setDraftShape({ ...draftShape, current: point });
    }
  }

  function finishPointerAction() {
    drawingStrokeRef.current = null;

    if (draftShape) {
      const nextShape = toBoardShape(draftShape, penColor);
      if (nextShape) {
        setShapes((current) => [...current, nextShape]);
        setToolMode("select");
        setSelectedStrokeIds([]);
        setSelectedShapeIds([nextShape.id]);
        setSelectedNoteIds([]);
      }
      setDraftShape(null);
    }
  }

  function clearBoard() {
    setStrokes([]);
    setShapes([]);
    setNotes([]);
    setAnnotations([]);
    setAnnotationDraft("");
    setAssistSuggestion(null);
    setShowOverlayGuide(true);
    setViewportScale(1);
    setViewportOffset({ x: 0, y: 0 });
    clearSelection();
    setRemoteSavedAt(null);
    window.localStorage.removeItem(WHITEBOARD_STORAGE_KEY);
  }

  function addAnnotation() {
    const trimmed = annotationDraft.trim();
    if (!trimmed) return;
    setAnnotations((current) => [trimmed, ...current].slice(0, 8));
    setAnnotationDraft("");
  }

  function addStickyNoteFromDraft() {
    const noteText = annotationDraft.trim();
    if (!noteText) return;
    const note = createNote(noteText, 60, 60 + notes.length * 18, DEFAULT_NOTE_COLOR);
    setNotes((current) => [...current, note]);
    setAnnotationDraft("");
    setToolMode("select");
    setSelectedStrokeIds([]);
    setSelectedNoteIds([note.id]);
    setSelectedShapeIds([]);
  }

  async function requestAssist(intent: WhiteboardAssistIntent) {
    setAssistLoading(intent);
    try {
      const response = await fetch("/api/workspace/whiteboard-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent,
          workspaceGoal,
          annotations,
          boardSummary,
          hasSourceAttachment: Boolean(sourceAttachmentName),
        }),
      });

      const data = (await response.json()) as ({ suggestion?: WhiteboardAssistSuggestion } & PremiumApiResponse);
      const prompt = getUpgradePrompt(data, "Whiteboard assist is a Premium feature.");
      if (prompt) {
        setUpgradePrompt(prompt);
        return;
      }
      if (!response.ok || !data?.ok || !data.suggestion) {
        throw new Error(data?.error || "Whiteboard assist is unavailable right now.");
      }
      setAssistSuggestion(data.suggestion as WhiteboardAssistSuggestion);
      setShowOverlayGuide(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Whiteboard assist is unavailable right now.");
    } finally {
      setAssistLoading(null);
    }
  }

  function applyAssistSuggestion() {
    if (!assistSuggestion) return;

    const nextNotes = assistSuggestion.nodes.map((node, index) => ({
      id: `ai-note-${Date.now()}-${index}`,
      x: clamp(node.x * CANVAS_WIDTH - 80, 0, CANVAS_WIDTH - DEFAULT_NOTE_WIDTH),
      y: clamp(node.y * CANVAS_HEIGHT - 35, 0, CANVAS_HEIGHT - DEFAULT_NOTE_HEIGHT),
      width: DEFAULT_NOTE_WIDTH,
      height: DEFAULT_NOTE_HEIGHT,
      text: node.label,
      color: "#DBEAFE",
    }));

    const nodeLookup = new Map(assistSuggestion.nodes.map((node) => [node.id, node]));
    const nextShapes: BoardShape[] = assistSuggestion.connections.flatMap((connection, index) => {
      const from = nodeLookup.get(connection.from);
      const to = nodeLookup.get(connection.to);
      if (!from || !to) return [];
      return [{
        id: `ai-arrow-${Date.now()}-${index}`,
        kind: "arrow",
        start: { x: from.x * CANVAS_WIDTH, y: from.y * CANVAS_HEIGHT },
        end: { x: to.x * CANVAS_WIDTH, y: to.y * CANVAS_HEIGHT },
        color: "#0284C7",
      }];
    });

    setNotes((current) => [...current, ...nextNotes]);
    setShapes((current) => [...current, ...nextShapes]);
    setSelectedStrokeIds([]);
    setSelectedNoteIds(nextNotes.map((note) => note.id));
    setSelectedShapeIds(nextShapes.map((shape) => shape.id));
    setToolMode("select");
    setShowOverlayGuide(false);
    toast.success("Applied the AI guide onto the board as editable notes and connectors.");
  }

  async function handleSourceAttachment(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setSourceAttachmentName(file.name);
    pdfDocumentRef.current?.destroy?.();
    pdfDocumentRef.current = null;
    setPdfPageCount(0);
    setPdfCurrentPage(1);

    if (sourceObjectUrlRef.current) {
      URL.revokeObjectURL(sourceObjectUrlRef.current);
      sourceObjectUrlRef.current = null;
    }

    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (isPdf) {
      setPdfLoading(true);
      try {
        await loadPdfDocument(file);
        setSourceOverlayKind("pdf");
      } catch (error) {
        setSourceAttachmentUrl(null);
        setSourceAttachmentName(null);
        setSourceOverlayKind(null);
        toast.error(error instanceof Error ? error.message : "We couldn't render that PDF on the board.");
      } finally {
        setPdfLoading(false);
      }
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    sourceObjectUrlRef.current = objectUrl;
    setSourceAttachmentUrl(objectUrl);
    setSourceOverlayKind("image");
  }

  async function downloadBoard() {
    try {
      const snapshotUrl = await renderBoardSnapshot({
        sourceAttachmentUrl,
        strokes,
        shapes,
        notes,
      });

      const link = document.createElement("a");
      link.href = snapshotUrl;
      link.download = "quickstud-workspace-board.png";
      link.click();
    } catch {
      toast.error("We couldn't export the board right now.");
    }
  }

  async function loadPdfDocument(file: File) {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).toString();
    }

    const fileData = new Uint8Array(await file.arrayBuffer());
    const loadingTask = pdfjsLib.getDocument({ data: fileData });
    const pdfDocument = (await loadingTask.promise) as PdfDocumentLike;
    pdfDocumentRef.current = pdfDocument;
    setPdfPageCount(pdfDocument.numPages);
    await renderPdfPage(pdfDocument, 1);
  }

  async function renderPdfPage(document: PdfDocumentLike, pageNumber: number) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.35 });
    const renderCanvas = window.document.createElement("canvas");
    renderCanvas.width = viewport.width;
    renderCanvas.height = viewport.height;
    const renderContext = renderCanvas.getContext("2d");
    if (!renderContext) throw new Error("We couldn't prepare the PDF canvas.");

    await page.render({ canvasContext: renderContext, viewport }).promise;
    setSourceAttachmentUrl(renderCanvas.toDataURL("image/png"));
    setPdfCurrentPage(pageNumber);
  }

  async function goToPdfPage(nextPage: number) {
    if (!pdfDocumentRef.current) return;
    const clampedPage = Math.max(1, Math.min(pdfPageCount, nextPage));
    setPdfLoading(true);
    try {
      await renderPdfPage(pdfDocumentRef.current, clampedPage);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We couldn't render that PDF page.");
    } finally {
      setPdfLoading(false);
    }
  }

  function nudgeZoom(delta: number) {
    setViewportScale((current) => clamp(round2(current + delta), 0.6, 2.5));
  }

  function resetViewport() {
    setViewportScale(1);
    setViewportOffset({ x: 0, y: 0 });
  }

  function updateNoteText(noteId: string, text: string) {
    setNotes((current) => current.map((note) => note.id === noteId ? { ...note, text } : note));
  }

  function removeSelectedItems() {
    setStrokes((current) => current.filter((stroke) => !selectedStrokeIds.includes(stroke.id)));
    setNotes((current) => current.filter((note) => !selectedNoteIds.includes(note.id)));
    setShapes((current) => current.filter((shape) => !selectedShapeIds.includes(shape.id)));
    clearSelection();
  }

  function selectNote(noteId: string, multi: boolean) {
    setSelectedShapeIds((current) => (multi ? current : []));
    setSelectedNoteIds((current) => toggleId(current, noteId, multi));
  }

  function selectShape(shapeId: string, multi: boolean) {
    setSelectedNoteIds((current) => (multi ? current : []));
    setSelectedShapeIds((current) => toggleId(current, shapeId, multi));
  }

  function startSelectionDrag(pointerId: number, clientX: number, clientY: number, strokeIds = selectedStrokeIds) {
    setSelectionDragState({
      pointerId,
      startClient: { x: clientX, y: clientY },
      strokeOrigins: strokes.filter((stroke) => strokeIds.includes(stroke.id)).map((stroke) => ({
        id: stroke.id,
        points: stroke.points.map((point) => ({ ...point })),
      })),
      noteOrigins: notes.filter((note) => selectedNoteIds.includes(note.id)).map((note) => ({ id: note.id, x: note.x, y: note.y })),
      shapeOrigins: shapes.filter((shape) => selectedShapeIds.includes(shape.id)).map((shape) =>
        shape.kind === "rectangle"
          ? { id: shape.id, kind: shape.kind, x: shape.x, y: shape.y }
          : { id: shape.id, kind: shape.kind, start: shape.start, end: shape.end }
      ),
    });
  }

  function handleNoteHeaderPointerDown(noteId: string, event: React.PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    const alreadySelected = selectedNoteIds.includes(noteId);
    const multi = event.shiftKey;
    if (!alreadySelected || !multi) {
      selectNote(noteId, multi);
    }
    if (toolMode === "select") {
      const selected = alreadySelected && !multi ? selectedNoteIds : multi ? toggleId(selectedNoteIds, noteId, true) : [noteId];
      if (!selected.includes(noteId)) return;
      startSelectionDrag(event.pointerId, event.clientX, event.clientY);
    }
  }

  function handleNoteBodyPointerDown(noteId: string, event: React.PointerEvent<HTMLDivElement>) {
    if (toolMode !== "select") return;
    event.stopPropagation();
    selectNote(noteId, event.shiftKey);
  }

  function startNoteResize(note: BoardNote, handle: ResizeHandle, event: React.PointerEvent<HTMLButtonElement>) {
    event.stopPropagation();
    setToolMode("select");
    setSelectedNoteIds([note.id]);
    setSelectedShapeIds([]);
    setResizeState({
      pointerId: event.pointerId,
      kind: "note",
      noteId: note.id,
      handle,
      origin: { x: note.x, y: note.y, width: note.width, height: note.height },
      startClient: { x: event.clientX, y: event.clientY },
    });
  }

  function startRectangleResize(shape: BoardRectangle, handle: ResizeHandle, event: React.PointerEvent<SVGCircleElement>) {
    event.stopPropagation();
    setToolMode("select");
    setSelectedShapeIds([shape.id]);
    setSelectedNoteIds([]);
    setResizeState({
      pointerId: event.pointerId,
      kind: "rectangle",
      shapeId: shape.id,
      handle,
      origin: { x: shape.x, y: shape.y, width: shape.width, height: shape.height },
      startClient: { x: event.clientX, y: event.clientY },
    });
  }

  function startArrowHandleDrag(shape: BoardArrow, edge: "start" | "end", event: React.PointerEvent<SVGCircleElement>) {
    event.stopPropagation();
    setToolMode("select");
    setSelectedShapeIds([shape.id]);
    setSelectedNoteIds([]);
    setResizeState({
      pointerId: event.pointerId,
      kind: edge === "start" ? "arrow-start" : "arrow-end",
      shapeId: shape.id,
      startClient: { x: event.clientX, y: event.clientY },
      originStart: shape.start,
      originEnd: shape.end,
    });
  }

  function handleShapePointerDown(shapeId: string, event: React.PointerEvent<SVGElement>) {
    if (toolMode !== "select") return;
    event.stopPropagation();
    const alreadySelected = selectedShapeIds.includes(shapeId);
    const multi = event.shiftKey;
    if (!alreadySelected || !multi) {
      selectShape(shapeId, multi);
    }
    const selected = alreadySelected && !multi ? selectedShapeIds : multi ? toggleId(selectedShapeIds, shapeId, true) : [shapeId];
    if (!selected.includes(shapeId)) return;
    startSelectionDrag(event.pointerId, event.clientX, event.clientY);
  }

  function applyBoardPreset(presetId: BoardPresetId) {
    const preset = BOARD_PRESETS.find((item) => item.id === presetId);
    if (!preset) return;
    const snapshot = preset.create();
    setStrokes([]);
    setShapes(snapshot.shapes);
    setNotes(snapshot.notes);
    setAnnotations(snapshot.annotations);
    setWorkspaceGoal(snapshot.workspaceGoal);
    setAssistSuggestion(null);
    setShowOverlayGuide(true);
    clearSelection();
    setToolMode("select");
    resetViewport();
    toast.success(`${preset.label} preset loaded onto the board.`);
  }

  async function refreshRemoteBoards(preferredBoardId?: string | null) {
    const query = preferredBoardId ? `?boardId=${encodeURIComponent(preferredBoardId)}` : "";
    const response = await fetch(`/api/workspace/whiteboard-state${query}`, { cache: "no-store" });
    const data = (await response.json()) as WhiteboardStateResponse;
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "We couldn't refresh your saved boards.");
    }
    setRemoteBoards(data.boards || []);
    return data;
  }

  async function saveBoardToCloud() {
    setRemoteSyncSaving(true);
    try {
      const response = await fetch("/api/workspace/whiteboard-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshot: currentSnapshot(),
          boardId: activeBoardId,
          boardName,
        }),
      });
      const data = (await response.json()) as WhiteboardStateResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "We couldn't save your board to your account.");
      }
      setActiveBoardId(data.boardId || null);
      setBoardName(data.boardName || boardName || "Untitled board");
      setRemoteSavedAt(data.savedAt || new Date().toISOString());
      const refreshed = await refreshRemoteBoards(data.boardId || activeBoardId);
      setRemoteBoards(refreshed.boards || []);
      toast.success("Board saved to your account.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We couldn't save your board to your account.");
    } finally {
      setRemoteSyncSaving(false);
    }
  }

  async function loadBoardFromCloud(boardId?: string) {
    setRemoteSyncLoading(true);
    try {
      const query = boardId ? `?boardId=${encodeURIComponent(boardId)}` : activeBoardId ? `?boardId=${encodeURIComponent(activeBoardId)}` : "";
      const response = await fetch(`/api/workspace/whiteboard-state${query}`, { cache: "no-store" });
      const data = (await response.json()) as WhiteboardStateResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "We couldn't load your board from your account.");
      }
      setRemoteBoards(data.boards || []);
      if (!data.snapshot) {
        toast.message("No saved board found for this account yet.");
        return;
      }
      restoreSnapshot(sanitizePersistedState(data.snapshot));
      setActiveBoardId(data.boardId || null);
      setBoardName(data.boardName || "Untitled board");
      setRemoteSavedAt(data.savedAt || null);
      toast.success("Loaded your saved board from your account.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We couldn't load your board from your account.");
    } finally {
      setRemoteSyncLoading(false);
    }
  }

  async function deleteBoardFromCloud(boardId: string) {
    setRemoteSyncLoading(true);
    try {
      const response = await fetch("/api/workspace/whiteboard-state", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId }),
      });
      const data = (await response.json()) as WhiteboardStateResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "We couldn't delete that saved board.");
      }
      const refreshed = await refreshRemoteBoards(activeBoardId === boardId ? undefined : activeBoardId);
      setRemoteBoards(refreshed.boards || []);
      if (activeBoardId === boardId) {
        createNewBoard();
      }
      toast.success("Saved board deleted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We couldn't delete that saved board.");
    } finally {
      setRemoteSyncLoading(false);
    }
  }

  async function renameBoardInCloud(boardId: string, nextName: string) {
    const trimmedName = nextName.trim();
    if (!trimmedName) {
      toast.error("Board name is required.");
      return;
    }

    setRemoteSyncLoading(true);
    try {
      const response = await fetch("/api/workspace/whiteboard-state", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId, boardName: trimmedName }),
      });
      const data = (await response.json()) as WhiteboardStateResponse;
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "We couldn't rename that saved board.");
      }
      const refreshed = await refreshRemoteBoards(boardId);
      setRemoteBoards(refreshed.boards || []);
      if (activeBoardId === boardId) {
        setBoardName(trimmedName);
      }
      setRenamingBoardId(null);
      setRenameDraft("");
      toast.success("Saved board renamed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We couldn't rename that saved board.");
    } finally {
      setRemoteSyncLoading(false);
    }
  }

  return (
    <>
    <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]">
      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Human-operated whiteboard</p>
            <h2 className="mt-2 text-xl font-semibold text-slate-950">Sketch, marquee-select, undo, and manage multiple saved boards.</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={undoBoardState} disabled={!canUndo} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50">
              Undo
            </button>
            <button type="button" onClick={redoBoardState} disabled={!canRedo} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50">
              Redo
            </button>
            <button type="button" onClick={saveBoardToCloud} disabled={remoteSyncSaving} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60">
              {remoteSyncSaving ? "Saving..." : "Save board"}
            </button>
            <button type="button" onClick={() => loadBoardFromCloud()} disabled={remoteSyncLoading} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60">
              {remoteSyncLoading ? "Loading..." : "Load board"}
            </button>
            <button type="button" onClick={clearBoard} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50">
              Clear board
            </button>
            <button type="button" onClick={downloadBoard} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50">
              Download PNG
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[0.25fr_0.75fr]">
          <div className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <div>
              <p className="text-sm font-medium text-slate-800">Tool</p>
              <div className="mt-2 grid gap-2">
                {[
                  ["select", "Select"],
                  ["draw", "Draw"],
                  ["pan", "Pan"],
                  ["rectangle", "Rectangle"],
                  ["arrow", "Arrow"],
                  ["note", "Sticky note"],
                ].map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setToolMode(mode as ToolMode)}
                    className={toolMode === mode
                      ? "rounded-2xl bg-slate-950 px-3 py-2 text-sm font-medium text-white"
                      : "rounded-2xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">Select mode supports shift-click, drag select, marquee select, resize handles, and keyboard undo/redo.</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Freehand strokes participate in marquee selection and can be moved or deleted after selection.</p>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-800">Board presets</p>
              <div className="mt-2 grid gap-2">
                {BOARD_PRESETS.map((preset) => (
                  <button key={preset.id} type="button" onClick={() => applyBoardPreset(preset.id)} className="rounded-2xl border border-slate-300 bg-white px-3 py-2 text-left text-sm font-medium text-slate-900 hover:bg-slate-50">
                    <span className="block">{preset.label}</span>
                    <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">{preset.description}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-800">Board identity</p>
              <label className="mt-2 block text-sm font-medium text-slate-800">
                Board name
                <input
                  value={boardName}
                  onChange={(event) => setBoardName(event.target.value)}
                  placeholder="Untitled board"
                  className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900"
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={createNewBoard} className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-white">
                  New board
                </button>
                {activeBoardId ? <span className="self-center text-xs text-slate-500">Saved board active</span> : <span className="self-center text-xs text-slate-500">Unsaved board</span>}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium text-slate-800">Viewport</p>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" onClick={() => nudgeZoom(-0.1)} className="rounded-full border border-slate-300 px-3 py-1 text-sm font-medium text-slate-900 hover:bg-white">-</button>
                <input type="range" min={0.6} max={2.5} step={0.05} value={viewportScale} onChange={(event) => setViewportScale(Number(event.target.value))} className="w-full" />
                <button type="button" onClick={() => nudgeZoom(0.1)} className="rounded-full border border-slate-300 px-3 py-1 text-sm font-medium text-slate-900 hover:bg-white">+</button>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-600">
                <span>{Math.round(viewportScale * 100)}%</span>
                <button type="button" onClick={resetViewport} className="rounded-full border border-slate-300 px-3 py-1 font-medium text-slate-700 hover:bg-white">Reset view</button>
              </div>
            </div>

            <label className="block text-sm font-medium text-slate-800">
              Pen color
              <input type="color" value={penColor} onChange={(event) => setPenColor(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white p-1" />
            </label>
            <label className="block text-sm font-medium text-slate-800">
              Pen width
              <input type="range" min={1} max={12} value={penWidth} onChange={(event) => setPenWidth(Number(event.target.value))} className="mt-2 w-full" />
              <span className="mt-1 block text-xs text-slate-500">{penWidth}px</span>
            </label>
            <label className="block text-sm font-medium text-slate-800">
              Source overlay
              <input type="file" accept="image/*,.pdf" onChange={handleSourceAttachment} className="mt-2 block w-full text-xs text-slate-600" />
              <span className="mt-2 block text-xs leading-5 text-slate-500">
                Images and PDF pages can be shown directly behind the board while you sketch on top.
              </span>
            </label>
            {sourceAttachmentName ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-600">
                Source attached: {sourceAttachmentName}
                {sourceOverlayKind === "pdf" ? ` • page ${pdfCurrentPage} of ${pdfPageCount}` : ""}
              </div>
            ) : null}
            {sourceOverlayKind === "pdf" ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3 text-xs text-slate-600">
                <div className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => void goToPdfPage(pdfCurrentPage - 1)} disabled={pdfLoading || pdfCurrentPage <= 1} className="rounded-full border border-slate-300 px-3 py-1 font-medium text-slate-700 disabled:opacity-50">
                    Prev page
                  </button>
                  <span>{pdfLoading ? "Rendering..." : `Page ${pdfCurrentPage} / ${pdfPageCount}`}</span>
                  <button type="button" onClick={() => void goToPdfPage(pdfCurrentPage + 1)} disabled={pdfLoading || pdfCurrentPage >= pdfPageCount} className="rounded-full border border-slate-300 px-3 py-1 font-medium text-slate-700 disabled:opacity-50">
                    Next page
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-4">
            <div ref={boardViewportRef} className="relative aspect-[12/7] overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-inner">
              <div className="absolute left-0 top-0" style={{ width: CANVAS_WIDTH, height: CANVAS_HEIGHT, transform: boardTransform, transformOrigin: "top left" }}>
                {sourceAttachmentUrl && (sourceOverlayKind === "image" || sourceOverlayKind === "pdf") ? (
                  <img src={sourceAttachmentUrl} alt="workspace source overlay" className="pointer-events-none absolute inset-0 h-full w-full object-contain opacity-30" />
                ) : null}

                <canvas
                  ref={canvasRef}
                  width={CANVAS_WIDTH}
                  height={CANVAS_HEIGHT}
                  className="absolute inset-0 h-full w-full touch-none bg-white"
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={finishPointerAction}
                  onPointerLeave={finishPointerAction}
                />

                <svg viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} className="absolute inset-0 h-full w-full pointer-events-none">
                  {selectedStrokeIds.map((strokeId) => {
                    const stroke = strokes.find((item) => item.id === strokeId);
                    if (!stroke) return null;
                    const bounds = getStrokeBounds(stroke);
                    return (
                      <rect
                        key={`stroke-selection-${strokeId}`}
                        x={Math.max(0, bounds.x - 8)}
                        y={Math.max(0, bounds.y - 8)}
                        width={Math.max(16, bounds.width + 16)}
                        height={Math.max(16, bounds.height + 16)}
                        fill="rgba(14,165,233,0.06)"
                        stroke="#0284c7"
                        strokeDasharray="8 6"
                        strokeWidth={2}
                      />
                    );
                  })}
                  {shapes.map((shape) => renderBoardShape(shape, selectedShapeIds.includes(shape.id), canManipulateSelection, handleShapePointerDown))}
                  {draftShape ? renderDraftShape(draftShape, penColor) : null}
                  {selectionBoxRect ? (
                    <rect
                      x={selectionBoxRect.x}
                      y={selectionBoxRect.y}
                      width={selectionBoxRect.width}
                      height={selectionBoxRect.height}
                      fill="rgba(14,165,233,0.08)"
                      stroke="#0284c7"
                      strokeDasharray="8 6"
                      strokeWidth={2}
                    />
                  ) : null}
                  {assistSuggestion && showOverlayGuide
                    ? assistSuggestion.connections.map((connection) => {
                        const from = assistSuggestion.nodes.find((node) => node.id === connection.from);
                        const to = assistSuggestion.nodes.find((node) => node.id === connection.to);
                        if (!from || !to) return null;
                        return (
                          <g key={`${connection.from}-${connection.to}-${connection.label}`}>
                            <line x1={from.x * CANVAS_WIDTH} y1={from.y * CANVAS_HEIGHT} x2={to.x * CANVAS_WIDTH} y2={to.y * CANVAS_HEIGHT} stroke="#0ea5e9" strokeDasharray="8 8" strokeWidth="2" />
                            <text x={((from.x + to.x) / 2) * CANVAS_WIDTH} y={((from.y + to.y) / 2) * CANVAS_HEIGHT - 8} fontSize="14" textAnchor="middle" fill="#0369a1">
                              {connection.label}
                            </text>
                          </g>
                        );
                      })
                    : null}
                  {assistSuggestion && showOverlayGuide
                    ? assistSuggestion.nodes.map((node) => (
                        <g key={node.id} transform={`translate(${node.x * CANVAS_WIDTH}, ${node.y * CANVAS_HEIGHT})`}>
                          <rect x={-86} y={-24} width={172} height={48} rx={18} fill="rgba(14,165,233,0.14)" stroke="#0284c7" strokeDasharray="8 5" />
                          <text textAnchor="middle" y="6" fontSize="15" fill="#0f172a">{node.label}</text>
                        </g>
                      ))
                    : null}
                  {canManipulateSelection && shapes.map((shape) => {
                    if (!selectedShapeIds.includes(shape.id)) return null;
                    if (shape.kind === "rectangle") {
                      return renderRectangleHandles(shape, startRectangleResize);
                    }
                    return renderArrowHandles(shape, startArrowHandleDrag);
                  })}
                </svg>

                {notes.map((note) => {
                  const selected = selectedNoteIds.includes(note.id);
                  return (
                    <div
                      key={note.id}
                      className={selected ? "absolute rounded-2xl border-2 border-sky-500 shadow-sm" : "absolute rounded-2xl border border-amber-200 shadow-sm"}
                      style={{ left: note.x, top: note.y, width: note.width, minHeight: note.height, backgroundColor: note.color }}
                      onPointerDown={(event) => handleNoteBodyPointerDown(note.id, event)}
                    >
                      <div
                        className="flex cursor-grab items-center justify-between rounded-t-2xl border-b border-amber-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-900"
                        onPointerDown={(event) => handleNoteHeaderPointerDown(note.id, event)}
                      >
                        <span>Sticky note</span>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setNotes((current) => current.filter((item) => item.id !== note.id));
                            setSelectedNoteIds((current) => current.filter((item) => item !== note.id));
                          }}
                          className="pointer-events-auto rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700"
                        >
                          Remove
                        </button>
                      </div>
                      <textarea
                        value={note.text}
                        onChange={(event) => updateNoteText(note.id, event.target.value)}
                        className="w-full resize-none rounded-b-2xl bg-transparent px-3 py-3 text-sm leading-6 text-slate-900 outline-none"
                        style={{ minHeight: note.height - 40 }}
                      />
                      {selected && canManipulateSelection ? renderNoteHandles(note, startNoteResize) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[0.7fr_0.3fr]">
              <label className="block text-sm font-medium text-slate-800">
                Workspace goal
                <textarea
                  value={workspaceGoal}
                  onChange={(event) => setWorkspaceGoal(event.target.value)}
                  placeholder="Describe what you are trying to explain, plan, or visualize."
                  className="mt-2 min-h-[104px] w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900"
                />
              </label>
              <label className="block text-sm font-medium text-slate-800">
                Note or annotation draft
                <textarea
                  value={annotationDraft}
                  onChange={(event) => setAnnotationDraft(event.target.value)}
                  placeholder="Add an annotation or place it as a sticky note."
                  className="mt-2 min-h-[104px] w-full rounded-2xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-900"
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={addAnnotation} className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50">
                    Add annotation
                  </button>
                  <button type="button" onClick={addStickyNoteFromDraft} className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50">
                    Place sticky note
                  </button>
                </div>
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="rounded-3xl border border-sky-200 bg-sky-50 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Saved boards</p>
            {remoteSavedAt ? <span className="text-xs text-sky-700">Last save {formatSavedAt(remoteSavedAt)}</span> : null}
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-700">You can keep multiple named boards in your account and switch between them without losing the current browser autosave.</p>
          <div className="mt-4 space-y-2">
            {remoteBoards.length ? remoteBoards.map((board) => (
              <div key={board.boardId} className={board.boardId === activeBoardId ? "rounded-2xl border border-sky-300 bg-white px-3 py-3" : "rounded-2xl border border-slate-200 bg-white px-3 py-3"}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    {renamingBoardId === board.boardId ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          className="w-full max-w-[220px] rounded-xl border border-slate-300 px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-slate-900"
                        />
                        <button type="button" onClick={() => void renameBoardInCloud(board.boardId, renameDraft)} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-900 hover:bg-slate-50">
                          Save name
                        </button>
                        <button type="button" onClick={() => { setRenamingBoardId(null); setRenameDraft(""); }} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-900 hover:bg-slate-50">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm font-medium text-slate-900">{board.boardName}</p>
                    )}
                    <p className="mt-1 text-xs text-slate-500">Saved {formatSavedAt(board.savedAt)}</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => loadBoardFromCloud(board.boardId)} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-900 hover:bg-slate-50">
                      Load
                    </button>
                    <button type="button" onClick={() => { setRenamingBoardId(board.boardId); setRenameDraft(board.boardName); }} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-900 hover:bg-slate-50">
                      Rename
                    </button>
                    <button type="button" onClick={() => deleteBoardFromCloud(board.boardId)} className="rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-900 hover:bg-slate-50">
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )) : <p className="text-sm text-slate-500">No saved boards yet.</p>}
          </div>
        </div>

        <div className="rounded-3xl border border-sky-200 bg-sky-50 p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">AI assist actions</p>
          <p className="mt-3 text-sm leading-6 text-slate-700">The AI can suggest a structure preview, and you can apply that guide onto the board as editable notes and arrows.</p>
          <div className="mt-4 grid gap-2">
            {[
              ["clean-sketch", "Clean this sketch"],
              ["flowchart", "Convert to flowchart"],
              ["relationships", "Draw relationships"],
              ["visualize", "Visualize this explanation"],
            ].map(([intent, label]) => (
              <button
                key={intent}
                type="button"
                onClick={() => requestAssist(intent as WhiteboardAssistIntent)}
                disabled={assistLoading !== null}
                className="rounded-2xl border border-sky-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-900 hover:bg-sky-50 disabled:opacity-60"
              >
                {assistLoading === intent ? "Thinking..." : label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Board state</p>
              <p className="mt-2 text-sm text-slate-700">{boardSummary}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(selectedStrokeIds.length || selectedNoteIds.length || selectedShapeIds.length) ? (
                <button type="button" onClick={removeSelectedItems} className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50">
                  Delete selection
                </button>
              ) : null}
              {assistSuggestion ? (
                <button type="button" onClick={() => setShowOverlayGuide((current) => !current)} className="rounded-full border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50">
                  {showOverlayGuide ? "Hide guide" : "Show guide"}
                </button>
              ) : null}
            </div>
          </div>

          {annotations.length ? (
            <div className="mt-4 space-y-2">
              {annotations.map((annotation) => (
                <div key={annotation} className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                  {annotation}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500">No annotations yet.</p>
          )}
        </div>

        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">AI guide</p>
            {assistSuggestion ? (
              <button type="button" onClick={applyAssistSuggestion} className="rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-50">
                Apply to board
              </button>
            ) : null}
          </div>
          {assistSuggestion ? (
            <div className="mt-4 space-y-4">
              <div>
                <h3 className="text-base font-semibold text-slate-950">{assistSuggestion.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-700">{assistSuggestion.summary}</p>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-900">Suggested actions</p>
                <div className="mt-2 space-y-2">
                  {assistSuggestion.actions.map((action) => (
                    <div key={action} className="rounded-2xl border border-amber-200 bg-white/80 px-3 py-3 text-sm leading-6 text-slate-700">{action}</div>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-900">Cautions</p>
                <div className="mt-2 space-y-2">
                  {assistSuggestion.cautions.map((caution) => (
                    <div key={caution} className="rounded-2xl border border-amber-200 bg-white/80 px-3 py-3 text-sm leading-6 text-slate-700">{caution}</div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-3 text-sm leading-6 text-slate-700">Ask for structure, relationships, or flow. The guidance can stay as a preview or be applied onto the board as editable objects.</p>
          )}
        </div>
      </section>
    </div>
    <PremiumUpsellModal
      open={Boolean(upgradePrompt)}
      title={upgradePrompt?.title || "Premium feature"}
      message={upgradePrompt?.message || "Upgrade to Premium to continue."}
      upgradePath={upgradePrompt?.upgradePath}
      onClose={() => setUpgradePrompt(null)}
    />
    </>
  );
}

function getBoardPoint(
  clientX: number,
  clientY: number,
  viewport: HTMLDivElement | null,
  offset: { x: number; y: number },
  scale: number
) {
  if (!viewport) return null;
  const rect = viewport.getBoundingClientRect();
  return {
    x: clamp((clientX - rect.left - offset.x) / scale, 0, CANVAS_WIDTH),
    y: clamp((clientY - rect.top - offset.y) / scale, 0, CANVAS_HEIGHT),
  };
}

function renderBoardShape(
  shape: BoardShape,
  selected: boolean,
  interactive: boolean,
  onPointerDown: (shapeId: string, event: React.PointerEvent<SVGElement>) => void
) {
  const strokeWidth = selected ? 4 : 3;
  if (shape.kind === "rectangle") {
    return (
      <rect
        key={shape.id}
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        rx={18}
        fill="transparent"
        stroke={shape.color}
        strokeDasharray={selected ? "10 6" : undefined}
        strokeWidth={strokeWidth}
        pointerEvents={interactive ? "auto" : "none"}
        onPointerDown={(event) => onPointerDown(shape.id, event)}
      />
    );
  }

  return (
    <g key={shape.id} pointerEvents={interactive ? "auto" : "none"} onPointerDown={(event) => onPointerDown(shape.id, event)}>
      <line x1={shape.start.x} y1={shape.start.y} x2={shape.end.x} y2={shape.end.y} stroke={shape.color} strokeWidth={strokeWidth} strokeDasharray={selected ? "10 6" : undefined} />
      {renderArrowHead(shape)}
    </g>
  );
}

function renderDraftShape(draftShape: DraftShape, color: string) {
  const shape = toBoardShape(draftShape, color);
  return shape ? renderBoardShape(shape, false, false, () => undefined) : null;
}

function renderRectangleHandles(shape: BoardRectangle, onStartResize: (shape: BoardRectangle, handle: ResizeHandle, event: React.PointerEvent<SVGCircleElement>) => void) {
  const handles: Array<{ handle: ResizeHandle; x: number; y: number }> = [
    { handle: "nw", x: shape.x, y: shape.y },
    { handle: "ne", x: shape.x + shape.width, y: shape.y },
    { handle: "sw", x: shape.x, y: shape.y + shape.height },
    { handle: "se", x: shape.x + shape.width, y: shape.y + shape.height },
  ];
  return handles.map((item) => (
    <circle
      key={`${shape.id}-${item.handle}`}
      cx={item.x}
      cy={item.y}
      r={7}
      fill="#ffffff"
      stroke="#0284c7"
      strokeWidth={2}
      pointerEvents="auto"
      onPointerDown={(event) => onStartResize(shape, item.handle, event)}
    />
  ));
}

function renderArrowHandles(shape: BoardArrow, onStartDrag: (shape: BoardArrow, edge: "start" | "end", event: React.PointerEvent<SVGCircleElement>) => void) {
  return [
    <circle
      key={`${shape.id}-start`}
      cx={shape.start.x}
      cy={shape.start.y}
      r={7}
      fill="#ffffff"
      stroke="#0284c7"
      strokeWidth={2}
      pointerEvents="auto"
      onPointerDown={(event) => onStartDrag(shape, "start", event)}
    />,
    <circle
      key={`${shape.id}-end`}
      cx={shape.end.x}
      cy={shape.end.y}
      r={7}
      fill="#ffffff"
      stroke="#0284c7"
      strokeWidth={2}
      pointerEvents="auto"
      onPointerDown={(event) => onStartDrag(shape, "end", event)}
    />,
  ];
}

function renderNoteHandles(note: BoardNote, onStartResize: (note: BoardNote, handle: ResizeHandle, event: React.PointerEvent<HTMLButtonElement>) => void) {
  const positions: Array<{ handle: ResizeHandle; className: string }> = [
    { handle: "nw", className: "left-[-6px] top-[-6px] cursor-nwse-resize" },
    { handle: "ne", className: "right-[-6px] top-[-6px] cursor-nesw-resize" },
    { handle: "sw", className: "bottom-[-6px] left-[-6px] cursor-nesw-resize" },
    { handle: "se", className: "bottom-[-6px] right-[-6px] cursor-nwse-resize" },
  ];
  return positions.map((item) => (
    <button
      key={`${note.id}-${item.handle}`}
      type="button"
      aria-label={`Resize note ${item.handle}`}
      onPointerDown={(event) => onStartResize(note, item.handle, event)}
      className={`absolute h-3.5 w-3.5 rounded-full border-2 border-sky-500 bg-white ${item.className}`}
    />
  ));
}

function renderArrowHead(shape: BoardArrow) {
  const angle = Math.atan2(shape.end.y - shape.start.y, shape.end.x - shape.start.x);
  const size = 12;
  const left = {
    x: shape.end.x - size * Math.cos(angle - Math.PI / 6),
    y: shape.end.y - size * Math.sin(angle - Math.PI / 6),
  };
  const right = {
    x: shape.end.x - size * Math.cos(angle + Math.PI / 6),
    y: shape.end.y - size * Math.sin(angle + Math.PI / 6),
  };

  return <polygon points={`${shape.end.x},${shape.end.y} ${left.x},${left.y} ${right.x},${right.y}`} fill={shape.color} />;
}

function toBoardShape(draftShape: DraftShape, color: string): BoardShape | null {
  if (draftShape.kind === "rectangle") {
    const width = Math.abs(draftShape.current.x - draftShape.start.x);
    const height = Math.abs(draftShape.current.y - draftShape.start.y);
    if (width < 8 || height < 8) return null;
    return {
      id: `rect-${Date.now()}`,
      kind: "rectangle",
      x: Math.min(draftShape.start.x, draftShape.current.x),
      y: Math.min(draftShape.start.y, draftShape.current.y),
      width,
      height,
      color,
    };
  }

  const length = Math.hypot(draftShape.current.x - draftShape.start.x, draftShape.current.y - draftShape.start.y);
  if (length < 10) return null;
  return {
    id: `arrow-${Date.now()}`,
    kind: "arrow",
    start: draftShape.start,
    end: draftShape.current,
    color,
  };
}

function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke) {
  if (!stroke.points.length) return;

  context.strokeStyle = stroke.color;
  context.lineWidth = stroke.width;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(stroke.points[0].x, stroke.points[0].y);
  for (const point of stroke.points.slice(1)) {
    context.lineTo(point.x, point.y);
  }
  context.stroke();
}

async function renderBoardSnapshot({
  sourceAttachmentUrl,
  strokes,
  shapes,
  notes,
}: {
  sourceAttachmentUrl: string | null;
  strokes: Stroke[];
  shapes: BoardShape[];
  notes: BoardNote[];
}) {
  const canvas = window.document.createElement("canvas");
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  if (sourceAttachmentUrl) {
    const image = await loadImage(sourceAttachmentUrl);
    context.save();
    context.globalAlpha = 0.3;
    drawContainedImage(context, image, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.restore();
  }

  for (const stroke of strokes) drawStroke(context, stroke);
  for (const shape of shapes) drawShapeOnCanvas(context, shape);
  for (const note of notes) drawNoteOnCanvas(context, note);

  return canvas.toDataURL("image/png");
}

function drawShapeOnCanvas(context: CanvasRenderingContext2D, shape: BoardShape) {
  context.strokeStyle = shape.color;
  context.fillStyle = shape.color;
  context.lineWidth = 3;

  if (shape.kind === "rectangle") {
    context.beginPath();
    context.roundRect(shape.x, shape.y, shape.width, shape.height, 18);
    context.stroke();
    return;
  }

  context.beginPath();
  context.moveTo(shape.start.x, shape.start.y);
  context.lineTo(shape.end.x, shape.end.y);
  context.stroke();

  const angle = Math.atan2(shape.end.y - shape.start.y, shape.end.x - shape.start.x);
  const size = 12;
  context.beginPath();
  context.moveTo(shape.end.x, shape.end.y);
  context.lineTo(shape.end.x - size * Math.cos(angle - Math.PI / 6), shape.end.y - size * Math.sin(angle - Math.PI / 6));
  context.lineTo(shape.end.x - size * Math.cos(angle + Math.PI / 6), shape.end.y - size * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fill();
}

function drawNoteOnCanvas(context: CanvasRenderingContext2D, note: BoardNote) {
  context.fillStyle = note.color;
  context.strokeStyle = "#D97706";
  context.lineWidth = 1.2;
  context.beginPath();
  context.roundRect(note.x, note.y, note.width, note.height, 18);
  context.fill();
  context.stroke();

  context.fillStyle = "#0F172A";
  context.font = '15px "Aptos", sans-serif';
  wrapText(context, note.text, note.x + 12, note.y + 26, Math.max(80, note.width - 24), 22, Math.max(2, Math.floor((note.height - 30) / 22)));
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
) {
  const words = text.split(/\s+/).filter(Boolean);
  let line = "";
  let lineIndex = 0;

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (context.measureText(next).width > maxWidth && line) {
      context.fillText(line, x, y + lineIndex * lineHeight);
      line = word;
      lineIndex += 1;
      if (lineIndex >= maxLines) break;
    } else {
      line = next;
    }
  }

  if (lineIndex < maxLines && line) {
    context.fillText(line, x, y + lineIndex * lineHeight);
  }
}

function drawContainedImage(context: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const scale = Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const x = (width - drawWidth) / 2;
  const y = (height - drawHeight) / 2;
  context.drawImage(image, x, y, drawWidth, drawHeight);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image failed to load"));
    image.src = src;
  });
}

function createStrokeId() {
  return `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createNote(text: string, x: number, y: number, color: string, width = DEFAULT_NOTE_WIDTH, height = DEFAULT_NOTE_HEIGHT): BoardNote {
  return {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    x,
    y,
    width,
    height,
    text,
    color,
  };
}

function createArrow(start: StrokePoint, end: StrokePoint, color = "#0284C7"): BoardArrow {
  return {
    id: `arrow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "arrow",
    start,
    end,
    color,
  };
}

function createEmptySnapshot(): PersistedWhiteboardState {
  return {
    strokes: [],
    shapes: [],
    notes: [],
    annotations: [],
    workspaceGoal: "",
    toolMode: "select",
    viewportScale: 1,
    viewportOffset: { x: 0, y: 0 },
  };
}

function resizeBox(
  origin: { x: number; y: number; width: number; height: number },
  handle: ResizeHandle,
  deltaX: number,
  deltaY: number,
  minWidth: number,
  minHeight: number
) {
  let left = origin.x;
  let right = origin.x + origin.width;
  let top = origin.y;
  let bottom = origin.y + origin.height;

  if (handle === "nw" || handle === "sw") left += deltaX;
  if (handle === "ne" || handle === "se") right += deltaX;
  if (handle === "nw" || handle === "ne") top += deltaY;
  if (handle === "sw" || handle === "se") bottom += deltaY;

  if (right - left < minWidth) {
    if (handle === "nw" || handle === "sw") left = right - minWidth;
    else right = left + minWidth;
  }

  if (bottom - top < minHeight) {
    if (handle === "nw" || handle === "ne") top = bottom - minHeight;
    else bottom = top + minHeight;
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

function clampRectToBoard(rect: { x: number; y: number; width: number; height: number }) {
  return {
    x: clamp(rect.x, 0, CANVAS_WIDTH - rect.width),
    y: clamp(rect.y, 0, CANVAS_HEIGHT - rect.height),
    width: clamp(rect.width, 1, CANVAS_WIDTH),
    height: clamp(rect.height, 1, CANVAS_HEIGHT),
  };
}

function toggleId(current: string[], id: string, multi: boolean) {
  if (!multi) return [id];
  return current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
}

function unionIds(a: string[], b: string[]) {
  return Array.from(new Set([...a, ...b]));
}

function normalizeSelectionBox(box: SelectionBox) {
  return {
    x: Math.min(box.start.x, box.current.x),
    y: Math.min(box.start.y, box.current.y),
    width: Math.abs(box.current.x - box.start.x),
    height: Math.abs(box.current.y - box.start.y),
  };
}

function getStrokeBounds(stroke: Stroke) {
  if (!stroke.points.length) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const xs = stroke.points.map((point) => point.x);
  const ys = stroke.points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

function findStrokeAtPoint(strokes: Stroke[], point: StrokePoint) {
  return [...strokes].reverse().find((stroke) => {
    const bounds = getStrokeBounds(stroke);
    const padding = Math.max(8, stroke.width * 2);
    return point.x >= bounds.x - padding
      && point.x <= bounds.x + bounds.width + padding
      && point.y >= bounds.y - padding
      && point.y <= bounds.y + bounds.height + padding;
  }) ?? null;
}

function getShapeBounds(shape: BoardShape) {
  if (shape.kind === "rectangle") {
    return { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  }
  return {
    x: Math.min(shape.start.x, shape.end.x),
    y: Math.min(shape.start.y, shape.end.y),
    width: Math.abs(shape.end.x - shape.start.x),
    height: Math.abs(shape.end.y - shape.start.y),
  };
}

function rectsIntersect(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

function cloneSnapshot(snapshot: PersistedWhiteboardState): PersistedWhiteboardState {
  return JSON.parse(JSON.stringify(snapshot)) as PersistedWhiteboardState;
}

function serializeSnapshot(snapshot: PersistedWhiteboardState) {
  return JSON.stringify(snapshot);
}

function sanitizePersistedState(value: Partial<PersistedWhiteboardState> | null | undefined): PersistedWhiteboardState {
  return {
    strokes: Array.isArray(value?.strokes) ? (value.strokes ?? []).map(sanitizeStroke).filter(Boolean) as Stroke[] : [],
    shapes: Array.isArray(value?.shapes) ? (value.shapes ?? []).map(sanitizeShape).filter(Boolean) as BoardShape[] : [],
    notes: Array.isArray(value?.notes) ? (value.notes ?? []).map(sanitizeNote).filter(Boolean) as BoardNote[] : [],
    annotations: Array.isArray(value?.annotations) ? value.annotations.filter((item): item is string => typeof item === "string").slice(0, 8) : [],
    workspaceGoal: typeof value?.workspaceGoal === "string" ? value.workspaceGoal : "",
    toolMode: isToolMode(value?.toolMode) ? value.toolMode : "select",
    viewportScale: clamp(Number(value?.viewportScale) || 1, 0.6, 2.5),
    viewportOffset: {
      x: Number(value?.viewportOffset?.x) || 0,
      y: Number(value?.viewportOffset?.y) || 0,
    },
  };
}

function sanitizeStroke(value: unknown): Stroke | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return {
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : createStrokeId(),
    color: typeof candidate.color === "string" ? candidate.color : "#0f172a",
    width: clamp(Number(candidate.width) || 3, 1, 20),
    points: Array.isArray(candidate.points)
      ? candidate.points
          .map((point) => {
            if (!point || typeof point !== "object") return null;
            const current = point as Record<string, unknown>;
            return {
              x: clamp(Number(current.x) || 0, 0, CANVAS_WIDTH),
              y: clamp(Number(current.y) || 0, 0, CANVAS_HEIGHT),
            };
          })
          .filter(Boolean) as StrokePoint[]
      : [],
  };
}

function sanitizeShape(value: unknown): BoardShape | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "rectangle") {
    return {
      id: String(candidate.id || `rect-${Date.now()}`),
      kind: "rectangle",
      x: clamp(Number(candidate.x) || 0, 0, CANVAS_WIDTH),
      y: clamp(Number(candidate.y) || 0, 0, CANVAS_HEIGHT),
      width: clamp(Number(candidate.width) || MIN_RECT_WIDTH, MIN_RECT_WIDTH, CANVAS_WIDTH),
      height: clamp(Number(candidate.height) || MIN_RECT_HEIGHT, MIN_RECT_HEIGHT, CANVAS_HEIGHT),
      color: typeof candidate.color === "string" ? candidate.color : "#0f172a",
    };
  }
  if (candidate.kind === "arrow") {
    return {
      id: String(candidate.id || `arrow-${Date.now()}`),
      kind: "arrow",
      start: { x: clamp(Number((candidate.start as Record<string, unknown> | undefined)?.x) || 0, 0, CANVAS_WIDTH), y: clamp(Number((candidate.start as Record<string, unknown> | undefined)?.y) || 0, 0, CANVAS_HEIGHT) },
      end: { x: clamp(Number((candidate.end as Record<string, unknown> | undefined)?.x) || 0, 0, CANVAS_WIDTH), y: clamp(Number((candidate.end as Record<string, unknown> | undefined)?.y) || 0, 0, CANVAS_HEIGHT) },
      color: typeof candidate.color === "string" ? candidate.color : "#0284C7",
    };
  }
  return null;
}

function sanitizeNote(value: unknown): BoardNote | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  return {
    id: String(candidate.id || `note-${Date.now()}`),
    x: clamp(Number(candidate.x) || 0, 0, CANVAS_WIDTH),
    y: clamp(Number(candidate.y) || 0, 0, CANVAS_HEIGHT),
    width: clamp(Number(candidate.width) || DEFAULT_NOTE_WIDTH, MIN_NOTE_WIDTH, CANVAS_WIDTH),
    height: clamp(Number(candidate.height) || DEFAULT_NOTE_HEIGHT, MIN_NOTE_HEIGHT, CANVAS_HEIGHT),
    text: typeof candidate.text === "string" ? candidate.text : "",
    color: typeof candidate.color === "string" ? candidate.color : DEFAULT_NOTE_COLOR,
  };
}

function hasMeaningfulBoardContent(snapshot: PersistedWhiteboardState) {
  return Boolean(snapshot.workspaceGoal.trim() || snapshot.annotations.length || snapshot.notes.length || snapshot.shapes.length || snapshot.strokes.length);
}

function formatSavedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleString();
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round2(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isToolMode(value: unknown): value is ToolMode {
  return value === "select" || value === "draw" || value === "pan" || value === "rectangle" || value === "arrow" || value === "note";
}
