import {
  MAX_DIAGRAM_GROUPS,
  MAX_DIAGRAM_LABELS,
  MAX_SHAPES_PER_LABEL,
  clampPoint,
  clampShape,
  type OcclusionGroup,
  type OcclusionLabel,
  type OcclusionPoint,
  type OcclusionPointer,
  type OcclusionShape,
} from "@/lib/study/image-occlusion";

/**
 * The diagram editor's labels and groups, with undo.
 *
 * Only the labels and groups are history. The picture, the header and the
 * study settings are ordinary form fields; undoing a box should never quietly
 * flip "hide all" back as well.
 *
 * Continuous edits collapse into one step. Typing a label is one step per label
 * visited, not one per key, and dragging a box is one step per drag, not one
 * per pointer move -- `coalesceKey` is how an action says which run it belongs
 * to.
 */
export type DiagramDraft = {
  labels: OcclusionLabel[];
  groups: OcclusionGroup[];
};

export type DiagramEditorState = {
  past: DiagramDraft[];
  present: DiagramDraft;
  future: DiagramDraft[];
  coalesceKey: string | null;
};

export type DiagramEditorAction =
  | { type: "add-label"; label: OcclusionLabel }
  /** Several labels at once, as one step: what "find the labels" adds. */
  | { type: "add-labels"; labels: OcclusionLabel[] }
  | { type: "add-shape"; labelId: string; shape: OcclusionShape }
  | {
      type: "update-shape";
      labelId: string;
      shapeIndex: number;
      shape: OcclusionShape;
      /** One per drag, so a whole drag undoes in one step. */
      gestureId?: string;
    }
  | { type: "remove-shape"; labelId: string; shapeIndex: number }
  | { type: "remove-label"; labelId: string }
  | { type: "set-answer"; labelId: string; answer: string }
  | { type: "set-accepts"; labelId: string; accepts: string[] }
  | { type: "set-note"; labelId: string; note: string }
  | {
      type: "set-pointer";
      labelId: string;
      /** Where the label's line points, or null to remove the line. */
      pointer: OcclusionPointer | null;
      /** One per drag of the tip or bend, so moving it undoes in one step. */
      gestureId?: string;
    }
  | { type: "add-group"; group: OcclusionGroup }
  | { type: "set-group-name"; groupId: string; name: string }
  | { type: "toggle-group-label"; groupId: string; labelId: string }
  | { type: "remove-group"; groupId: string }
  /** A new set of labels in place of the old, as one step: what a crop does. */
  | { type: "replace-labels"; labels: OcclusionLabel[] }
  | { type: "undo" }
  | { type: "redo" };

/** Far more than anyone undoes, and small: a step is a few dozen numbers. */
const HISTORY_LIMIT = 100;

export function createDiagramEditorState(draft: Partial<DiagramDraft> = {}): DiagramEditorState {
  return {
    past: [],
    present: { labels: draft.labels ?? [], groups: draft.groups ?? [] },
    future: [],
    coalesceKey: null,
  };
}

function commit(
  state: DiagramEditorState,
  present: DiagramDraft,
  coalesceKey: string | null = null
): DiagramEditorState {
  if (present.labels === state.present.labels && present.groups === state.present.groups) return state;
  // Same run as the last step: replace it rather than adding another.
  if (coalesceKey && coalesceKey === state.coalesceKey) {
    return { ...state, present, future: [], coalesceKey };
  }
  return {
    past: [...state.past, state.present].slice(-HISTORY_LIMIT),
    present,
    future: [],
    coalesceKey,
  };
}

function mapLabel(
  labels: OcclusionLabel[],
  labelId: string,
  update: (label: OcclusionLabel) => OcclusionLabel | null
) {
  let changed = false;
  const next = labels.flatMap((label) => {
    if (label.id !== labelId) return [label];
    const updated = update(label);
    if (updated !== label) changed = true;
    return updated ? [updated] : [];
  });
  return changed ? next : labels;
}

function mapGroup(
  groups: OcclusionGroup[],
  groupId: string,
  update: (group: OcclusionGroup) => OcclusionGroup | null
) {
  let changed = false;
  const next = groups.flatMap((group) => {
    if (group.id !== groupId) return [group];
    const updated = update(group);
    if (updated !== group) changed = true;
    return updated ? [updated] : [];
  });
  return changed ? next : groups;
}

/** Groups without the labels that no longer exist. */
function pruneGroups(groups: OcclusionGroup[], labels: OcclusionLabel[]) {
  const ids = new Set(labels.map((label) => label.id));
  let changed = false;
  const next = groups.map((group) => {
    const labelIds = group.labelIds.filter((labelId) => ids.has(labelId));
    if (labelIds.length === group.labelIds.length) return group;
    changed = true;
    return { ...group, labelIds };
  });
  return changed ? next : groups;
}

function withLabels(state: DiagramEditorState, labels: OcclusionLabel[]): DiagramDraft {
  if (labels === state.present.labels) return state.present;
  return { labels, groups: pruneGroups(state.present.groups, labels) };
}

function withGroups(state: DiagramEditorState, groups: OcclusionGroup[]): DiagramDraft {
  return groups === state.present.groups ? state.present : { ...state.present, groups };
}

function cleanPointer(pointer: OcclusionPointer): OcclusionPointer {
  return { ...clampPoint(pointer), ...(pointer.bend ? { bend: clampPoint(pointer.bend) } : {}) };
}

export function diagramEditorReducer(
  state: DiagramEditorState,
  action: DiagramEditorAction
): DiagramEditorState {
  const { labels, groups } = state.present;
  switch (action.type) {
    case "add-label":
      if (labels.length >= MAX_DIAGRAM_LABELS) return state;
      return commit(state, withLabels(state, [...labels, { ...action.label, shapes: action.label.shapes.map(clampShape) }]));
    case "add-labels": {
      const room = MAX_DIAGRAM_LABELS - labels.length;
      if (room <= 0 || action.labels.length === 0) return state;
      const added = action.labels
        .slice(0, room)
        .map((label) => ({ ...label, shapes: label.shapes.map(clampShape) }));
      return commit(state, withLabels(state, [...labels, ...added]));
    }
    case "add-shape":
      return commit(
        state,
        withLabels(
          state,
          mapLabel(labels, action.labelId, (label) =>
            label.shapes.length >= MAX_SHAPES_PER_LABEL
              ? label
              : { ...label, shapes: [...label.shapes, clampShape(action.shape)] }
          )
        )
      );
    case "update-shape":
      return commit(
        state,
        withLabels(
          state,
          mapLabel(labels, action.labelId, (label) =>
            label.shapes[action.shapeIndex]
              ? {
                  ...label,
                  shapes: label.shapes.map((shape, index) =>
                    index === action.shapeIndex ? clampShape(action.shape) : shape
                  ),
                }
              : label
          )
        ),
        action.gestureId ? `gesture:${action.gestureId}` : null
      );
    case "remove-shape":
      // A label is its boxes: removing the last one removes the label.
      return commit(
        state,
        withLabels(
          state,
          mapLabel(labels, action.labelId, (label) => {
            const shapes = label.shapes.filter((_, index) => index !== action.shapeIndex);
            return shapes.length > 0 ? { ...label, shapes } : null;
          })
        )
      );
    case "remove-label":
      return commit(state, withLabels(state, mapLabel(labels, action.labelId, () => null)));
    case "set-answer":
      return commit(
        state,
        withLabels(
          state,
          mapLabel(labels, action.labelId, (label) =>
            label.answer === action.answer ? label : { ...label, answer: action.answer }
          )
        ),
        `answer:${action.labelId}`
      );
    case "set-accepts":
      return commit(
        state,
        withLabels(
          state,
          mapLabel(labels, action.labelId, (label) => {
            if ((label.accepts ?? []).join("\n") === action.accepts.join("\n")) return label;
            const next: OcclusionLabel = { ...label, accepts: action.accepts };
            if (action.accepts.length === 0) delete next.accepts;
            return next;
          })
        ),
        `accepts:${action.labelId}`
      );
    case "set-note":
      return commit(
        state,
        withLabels(
          state,
          mapLabel(labels, action.labelId, (label) => {
            if ((label.note ?? "") === action.note) return label;
            const next: OcclusionLabel = { ...label, note: action.note };
            if (!action.note) delete next.note;
            return next;
          })
        ),
        `note:${action.labelId}`
      );
    case "set-pointer":
      return commit(
        state,
        withLabels(
          state,
          mapLabel(labels, action.labelId, (label) => {
            if (!action.pointer) {
              if (!label.pointer) return label;
              const next: OcclusionLabel = { ...label };
              delete next.pointer;
              return next;
            }
            return { ...label, pointer: cleanPointer(action.pointer) };
          })
        ),
        action.gestureId ? `gesture:${action.gestureId}` : null
      );
    case "add-group":
      if (groups.length >= MAX_DIAGRAM_GROUPS) return state;
      return commit(state, withGroups(state, [...groups, action.group]));
    case "set-group-name":
      return commit(
        state,
        withGroups(
          state,
          mapGroup(groups, action.groupId, (group) =>
            group.name === action.name ? group : { ...group, name: action.name }
          )
        ),
        `group-name:${action.groupId}`
      );
    case "toggle-group-label":
      return commit(
        state,
        withGroups(
          state,
          mapGroup(groups, action.groupId, (group) => ({
            ...group,
            labelIds: group.labelIds.includes(action.labelId)
              ? group.labelIds.filter((labelId) => labelId !== action.labelId)
              : [...group.labelIds, action.labelId],
          }))
        )
      );
    case "remove-group":
      return commit(state, withGroups(state, mapGroup(groups, action.groupId, () => null)));
    case "replace-labels":
      return commit(state, withLabels(state, action.labels));
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        coalesceKey: null,
      };
    }
    case "redo": {
      const next = state.future[0];
      if (!next) return state;
      return {
        past: [...state.past, state.present],
        present: next,
        future: state.future.slice(1),
        coalesceKey: null,
      };
    }
    default:
      return state;
  }
}

/** Where a line's bend starts when one is added: halfway along the straight line. */
export function midpointBend(from: OcclusionPoint, to: OcclusionPoint): OcclusionPoint {
  return clampPoint({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 });
}
