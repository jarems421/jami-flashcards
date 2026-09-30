"use client";

import { useState } from "react";
import TopicPicker from "@/components/topics/TopicPicker";
import { Input, JamiTutorIcon, OptionSwitch } from "@/components/ui";
import type { DiagramEditorController } from "@/hooks/useDiagramEditor";
import type { Topic } from "@/lib/material/topics";
import { MAX_FRONT_LENGTH } from "@/lib/study/cards";
import {
  MAX_ACCEPTED_ANSWER_LENGTH,
  MAX_DIAGRAM_GROUPS,
  MAX_GROUP_NAME_LENGTH,
  MAX_LABEL_ANSWER_LENGTH,
  MAX_LABEL_NOTE_LENGTH,
  MAX_SHAPES_PER_LABEL,
  type OcclusionLabel,
} from "@/lib/study/image-occlusion";

type DiagramLabelPanelProps = {
  editor: DiagramEditorController;
  userId: string;
  topics: Topic[];
  onTopicsChange: (topics: Topic[]) => void;
  /** Whether finding labels with Jami is offered here. */
  aiEnabled: boolean;
};

export function diagramLabelFieldId(labelId: string) {
  return `diagram-label-${labelId}`;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
      <path d="M4 6h12M8 6V4.5h4V6M6 6l.7 9.5h6.6L14 6" />
    </svg>
  );
}

const smallAction =
  "rounded-full px-2.5 py-1 text-xs font-medium text-text-secondary transition hover:bg-[var(--color-glass-medium)] hover:text-text-primary disabled:opacity-50";

/**
 * Other answers a typed label accepts, as the student writes them: separated
 * by commas. Held as text while it is being typed -- turning it into a list
 * on every key would swallow the comma just typed.
 */
function AcceptsField({
  label,
  index,
  disabled,
  onChange,
}: {
  label: OcclusionLabel;
  index: number;
  disabled: boolean;
  onChange: (accepts: string[]) => void;
}) {
  const [text, setText] = useState((label.accepts ?? []).join(", "));
  const parse = (value: string) =>
    value
      .split(",")
      .map((entry) => entry.trim().slice(0, MAX_ACCEPTED_ANSWER_LENGTH))
      .filter(Boolean);
  return (
    <input
      value={text}
      disabled={disabled}
      autoComplete="off"
      aria-label={`Other answers accepted for label ${index + 1}`}
      placeholder="Also accept, e.g. LV, ventriculus sinister"
      onChange={(event) => {
        setText(event.target.value);
        onChange(parse(event.target.value));
      }}
      className="app-field app-field-text w-full rounded-lg px-3 py-2 text-sm outline-none"
    />
  );
}

/**
 * The words side of the editor: what kind of picture it is, every label, the
 * groups asked together, then how it is studied.
 *
 * The list is the other way to reach a box: choosing a row selects its box on
 * the picture, and drawing a box puts its row here. On a phone this sits under
 * the picture; on a larger screen, beside it.
 */
export default function DiagramLabelPanel({ editor, userId, topics, onTopicsChange, aiEnabled }: DiagramLabelPanelProps) {
  const busy = editor.saving || editor.deleting;
  const naming = editor.labelMode === "name";
  const hasLines = editor.labels.some((label) => label.pointer);

  return (
    <div className="space-y-5">
      {/* First, because it changes what a box is drawn around. */}
      <OptionSwitch
        label="Are the labels on the picture?"
        value={editor.labelMode}
        disabled={busy}
        detail="selected"
        onChange={editor.setLabelMode}
        options={[
          { value: "cover", label: "Yes, cover them", detail: "Draw a box over each printed label." },
          { value: "name", label: "No, name the parts", detail: "Box each part and type its name." },
        ]}
      />

      {aiEnabled && !naming ? (
        <section className="rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-3">
          <button
            type="button"
            disabled={busy || editor.detecting}
            onClick={() => void editor.detectLabels()}
            className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left transition hover:bg-[var(--color-glass-medium)] disabled:opacity-60"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-glass-medium)] text-accent">
              <JamiTutorIcon className="h-5 w-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-text-primary">
                {editor.detecting ? "Finding the labels…" : "Find the labels for me"}
              </span>
              <span className="block text-xs leading-5 text-text-muted">
                Jami boxes each printed label and types what it says. The picture is sent once and not kept.
              </span>
            </span>
          </button>
        </section>
      ) : null}

      {editor.notice ? (
        <p role="status" className="flex items-start justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-3 py-2.5 text-sm text-text-secondary">
          <span>{editor.notice}</span>
          <button type="button" onClick={editor.dismissNotice} className={smallAction} aria-label="Dismiss">
            ✕
          </button>
        </p>
      ) : null}

      <section aria-labelledby="diagram-labels-heading" className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="diagram-labels-heading" className="text-sm font-semibold text-text-primary">
            Labels{editor.labels.length > 0 ? ` (${editor.labels.length})` : ""}
          </h3>
          <span className="text-xs text-text-muted">One card each</span>
        </div>

        {editor.labels.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--color-border-strong)] px-4 py-5 text-center text-sm leading-6 text-text-secondary">
            {naming
              ? "Draw a box around each part you want to learn, or trace round it with Outline, then name it here."
              : "Draw a box over each label you want to learn. Tap to drop one, or drag to size it."}
          </p>
        ) : (
          <ol className="space-y-1.5">
            {editor.labels.map((label, index) => {
              const selected = editor.selection?.labelId === label.id;
              const missingName = naming && !label.answer.trim();
              return (
                <li
                  key={label.id}
                  className={`rounded-xl border p-1.5 transition duration-fast ${
                    selected
                      ? "border-accent bg-[var(--color-glass-medium)]"
                      : "border-[var(--color-border)] bg-[var(--color-glass-subtle)]"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => editor.selectLabel(label.id)}
                      aria-label={`Select label ${index + 1} on the picture`}
                      aria-pressed={selected}
                      className="occlusion-edit-badge grid h-8 min-w-8 shrink-0 place-items-center rounded-lg px-1.5 text-xs font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-selected-border)]"
                    >
                      {index + 1}
                    </button>
                    <input
                      id={diagramLabelFieldId(label.id)}
                      value={label.answer}
                      maxLength={MAX_LABEL_ANSWER_LENGTH}
                      disabled={busy}
                      autoComplete="off"
                      aria-label={`Label ${index + 1}`}
                      aria-invalid={missingName || undefined}
                      placeholder={naming ? "Name this part" : "What it says (optional)"}
                      onFocus={() => {
                        if (!selected) editor.selectLabel(label.id);
                      }}
                      onChange={(event) => editor.setAnswer(label.id, event.target.value)}
                      className={`app-field app-field-text min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none ${
                        missingName ? "ring-1 ring-[var(--color-error-mark)]" : ""
                      }`}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => editor.removeLabel(label.id)}
                      aria-label={`Remove label ${index + 1}`}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-text-muted transition hover:bg-[var(--color-glass-medium)] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-selected-border)] disabled:opacity-50"
                    >
                      <TrashIcon />
                    </button>
                  </div>

                  {selected ? (
                    <div className="mt-2 space-y-2 px-1 pb-1">
                      {label.answer.trim() ? (
                        <AcceptsField
                          key={label.id}
                          label={label}
                          index={index}
                          disabled={busy}
                          onChange={(accepts) => editor.setAccepts(label.id, accepts)}
                        />
                      ) : null}
                      <textarea
                        value={label.note ?? ""}
                        maxLength={MAX_LABEL_NOTE_LENGTH}
                        disabled={busy}
                        rows={2}
                        aria-label={`Note for label ${index + 1}`}
                        placeholder="Note shown with the answer (optional)"
                        onChange={(event) => editor.setNote(label.id, event.target.value)}
                        className="app-field app-field-text w-full resize-none rounded-lg px-3 py-2 text-sm outline-none"
                      />
                      <div className="flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-text-muted">
                        <span className="mr-auto">
                          {label.shapes.length === 1 ? "1 box" : `${label.shapes.length} boxes`}
                          {label.pointer ? (label.pointer.bend ? " · bent line" : " · line") : ""}
                        </span>
                        {label.pointer ? (
                          <>
                            {label.pointer.bend ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => editor.setPointer(label.id, { x: label.pointer!.x, y: label.pointer!.y })}
                                className={smallAction}
                              >
                                Straighten line
                              </button>
                            ) : null}
                            <button type="button" disabled={busy} onClick={() => editor.setPointer(label.id, null)} className={smallAction}>
                              Remove line
                            </button>
                          </>
                        ) : (
                          <button type="button" disabled={busy} onClick={() => editor.startPointing(label.id)} className={smallAction}>
                            + Line to the part
                          </button>
                        )}
                        {editor.addingToLabelId === label.id ? (
                          <button type="button" onClick={editor.cancelAddingBox} className={`${smallAction} text-accent`}>
                            Drawing another box… Cancel
                          </button>
                        ) : label.shapes.length < MAX_SHAPES_PER_LABEL ? (
                          <button type="button" disabled={busy} onClick={() => editor.startAddingBox(label.id)} className={smallAction}>
                            + Another box
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {editor.labels.length >= 2 ? (
        <section aria-labelledby="diagram-groups-heading" className="space-y-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="diagram-groups-heading" className="text-sm font-semibold text-text-primary">
              Ask together
            </h3>
            <span className="text-xs text-text-muted">One more card per group</span>
          </div>
          {editor.groups.length === 0 ? (
            <p className="text-xs leading-5 text-text-muted">
              A group asks several labels on one card, like &ldquo;name all four valves&rdquo;. Each label keeps its own card too.
            </p>
          ) : (
            <ul className="space-y-2">
              {editor.groups.map((group, groupIndex) => (
                <li key={group.id} className="space-y-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] p-2.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      value={group.name}
                      maxLength={MAX_GROUP_NAME_LENGTH}
                      disabled={busy}
                      aria-label={`Name of group ${groupIndex + 1}`}
                      placeholder="Group name, e.g. The four valves"
                      onChange={(event) => editor.setGroupName(group.id, event.target.value)}
                      className="app-field app-field-text min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => editor.removeGroup(group.id)}
                      aria-label={`Remove group ${groupIndex + 1}`}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-text-muted transition hover:bg-[var(--color-glass-medium)] hover:text-text-primary disabled:opacity-50"
                    >
                      <TrashIcon />
                    </button>
                  </div>
                  <div role="group" aria-label={`Labels in group ${groupIndex + 1}`} className="flex flex-wrap gap-1.5">
                    {editor.labels.map((label, index) => {
                      const member = group.labelIds.includes(label.id);
                      return (
                        <button
                          key={label.id}
                          type="button"
                          disabled={busy}
                          aria-pressed={member}
                          title={label.answer.trim() || `Label ${index + 1}`}
                          onClick={() => editor.toggleGroupLabel(group.id, label.id)}
                          className={`grid h-8 min-w-8 place-items-center rounded-lg border px-1.5 text-xs font-bold transition ${
                            member
                              ? "occlusion-edit-badge border-transparent"
                              : "border-[var(--color-border)] text-text-muted hover:border-[var(--color-border-strong)] hover:text-text-primary"
                          }`}
                        >
                          {index + 1}
                        </button>
                      );
                    })}
                  </div>
                  {group.labelIds.length < 2 ? (
                    <p className="text-xs text-text-muted">Tap at least two numbers.</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {editor.groups.length < MAX_DIAGRAM_GROUPS ? (
            <button type="button" disabled={busy} onClick={editor.addGroup} className={`${smallAction} border border-dashed border-[var(--color-border-strong)]`}>
              + Ask labels together
            </button>
          ) : null}
        </section>
      ) : null}

      <section aria-label="Study settings" className="space-y-4 border-t border-[var(--color-border)] pt-5">
        <Input
          label="Question (optional)"
          placeholder="e.g. The heart, anterior view"
          value={editor.header}
          maxLength={MAX_FRONT_LENGTH}
          disabled={busy}
          onChange={(event) => editor.setHeader(event.target.value)}
        />
        <OptionSwitch
          label="When studying a label"
          value={editor.hideOthers ? "all" : "one"}
          disabled={busy}
          detail="selected"
          onChange={(value) => editor.setHideOthers(value === "all")}
          options={[
            { value: "all", label: "Hide all labels", detail: "Harder: no neighbours to lean on." },
            { value: "one", label: "Hide just that one", detail: "Easier: the others stay visible." },
          ]}
        />
        {hasLines ? (
          <OptionSwitch
            label="Lines end in"
            value={editor.pointerEnd}
            disabled={busy}
            onChange={editor.setPointerEnd}
            options={[
              { value: "dot", label: "A dot" },
              { value: "arrow", label: "An arrowhead" },
            ]}
          />
        ) : null}
      </section>

      <details className="rounded-xl border border-[var(--color-border)] bg-[var(--color-glass-subtle)] px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium text-text-secondary">
          Topics <span className="font-normal text-text-muted">(optional)</span>
        </summary>
        <div className="mt-4">
          <TopicPicker
            userId={userId}
            topics={topics}
            selectedTopicIds={editor.topicIds}
            onChange={editor.setTopicIds}
            onTopicsChange={onTopicsChange}
            disabled={busy}
          />
        </div>
      </details>
    </div>
  );
}
