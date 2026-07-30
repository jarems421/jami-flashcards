import {
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import NotebookTextBlockOptions, {
  type NotebookTextBlockOptionsProps,
} from "@/components/workspace/NotebookTextBlockOptions";
import { getNotebookTextBlockOptionsElementId } from "@/lib/workspace/notebook-page-content";

type TestElementProps = {
  children?: ReactNode;
  [key: string]: unknown;
};

function collectElements(node: ReactNode): ReactElement<TestElementProps>[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectElements);
  }
  if (!isValidElement<TestElementProps>(node)) {
    return [];
  }
  return [node, ...collectElements(node.props.children)];
}

function findElement(
  elements: ReactElement<TestElementProps>[],
  prop: string,
  value: unknown
) {
  const element = elements.find((candidate) => candidate.props[prop] === value);
  expect(element, `Expected an element with ${prop}=${String(value)}`).toBeDefined();
  return element!;
}

function makeProps(
  overrides: Partial<NotebookTextBlockOptionsProps> = {}
): NotebookTextBlockOptionsProps {
  return {
    blockId: "block/a",
    open: true,
    outlineVisible: true,
    openAbove: true,
    alignFromLeft: true,
    onOpenChange: vi.fn(),
    onToggleOutline: vi.fn(),
    onDelete: vi.fn(),
    onKeyDown: vi.fn(),
    ...overrides,
  };
}

describe("NotebookTextBlockOptions", () => {
  it("renders the closed trigger with stable IDs and Pencil-friendly semantics", () => {
    const props = makeProps({ open: false });
    const html = renderToStaticMarkup(<NotebookTextBlockOptions {...props} />);
    const triggerId = getNotebookTextBlockOptionsElementId(
      props.blockId,
      "trigger"
    );
    const menuId = getNotebookTextBlockOptionsElementId(props.blockId, "menu");

    expect(html).toContain(`id="${triggerId}"`);
    expect(html).toContain(`aria-controls="${menuId}"`);
    expect(html).toContain('aria-label="Text box options"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-text-block-options-root="true"');
    expect(html).toContain('data-notebook-stylus-action="true"');
    expect(html).toContain('data-text-block-options-trigger="true"');
    expect(html).not.toContain('role="menu"');
  });

  it("renders checked menu actions with the requested position and alignment", () => {
    const props = makeProps();
    const html = renderToStaticMarkup(<NotebookTextBlockOptions {...props} />);
    const menuId = getNotebookTextBlockOptionsElementId(props.blockId, "menu");

    expect(html).toContain(`id="${menuId}"`);
    expect(html).toContain('role="menu"');
    expect(html).toContain('role="menuitemcheckbox"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('data-text-block-outline-toggle="true"');
    expect(html).toContain('role="menuitem"');
    expect(html).toContain('data-text-block-delete="true"');
    expect(html).toContain("Show outline");
    expect(html).toContain("Delete text box");
    expect(
      html.match(/data-notebook-stylus-action="true"/g)
    ).toHaveLength(3);
    expect(html).toContain("bottom-9");
    expect(html).toContain("left-0");
  });

  it("renders the unchecked switch below and aligned from the right", () => {
    const html = renderToStaticMarkup(
      <NotebookTextBlockOptions
        {...makeProps({
          outlineVisible: false,
          openAbove: false,
          alignFromLeft: false,
        })}
      />
    );

    expect(html).toContain('aria-checked="false"');
    expect(html).toContain("top-9");
    expect(html).toContain("right-0");
    expect(html).toContain("translate-x-0.5");
  });

  it("stops pointer and click propagation while forwarding every action", () => {
    const props = makeProps();
    const tree = NotebookTextBlockOptions(props);
    const elements = collectElements(tree);
    const trigger = findElement(
      elements,
      "data-text-block-options-trigger",
      "true"
    );
    const menu = findElement(elements, "role", "menu");
    const outline = findElement(elements, "data-text-block-outline-toggle", "true");
    const deleteAction = findElement(elements, "data-text-block-delete", "true");
    const event = { stopPropagation: vi.fn() };

    (
      trigger.props.onPointerDown as (event: {
        stopPropagation: () => void;
      }) => void
    )(event);
    (
      trigger.props.onClick as (event: {
        stopPropagation: () => void;
      }) => void
    )(event);
    (
      menu.props.onPointerDown as (event: {
        stopPropagation: () => void;
      }) => void
    )(event);
    (
      menu.props.onClick as (event: {
        stopPropagation: () => void;
      }) => void
    )(event);
    (
      outline.props.onPointerDown as (event: {
        stopPropagation: () => void;
      }) => void
    )(event);
    (
      outline.props.onClick as (event: {
        stopPropagation: () => void;
      }) => void
    )(event);
    (
      deleteAction.props.onPointerDown as (event: {
        stopPropagation: () => void;
      }) => void
    )(event);
    (
      deleteAction.props.onClick as (event: {
        stopPropagation: () => void;
      }) => void
    )(event);

    expect(event.stopPropagation).toHaveBeenCalledTimes(8);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(props.onToggleOutline).toHaveBeenCalledOnce();
    expect(props.onDelete).toHaveBeenCalledOnce();
    expect(menu.props.onKeyDown).toBe(props.onKeyDown);
  });
});
