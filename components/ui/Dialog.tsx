"use client";

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

export type DialogDismissReason = "escape" | "backdrop";

type DialogProps = {
  open: boolean;
  modal?: boolean;
  dismissible?: boolean;
  closeOnEscape?: boolean;
  closeOnBackdrop?: boolean;
  restoreFocus?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
  onDismiss: (reason: DialogDismissReason) => void;
};

type DialogEntry = {
  id: symbol;
  modal: boolean;
  panel: HTMLElement | null;
};

const dialogStack: DialogEntry[] = [];
const stackListeners = new Set<() => void>();
let stackVersion = 0;

function emitStackChange() {
  stackVersion += 1;
  stackListeners.forEach((listener) => listener());
}

function subscribeToStack(listener: () => void) {
  stackListeners.add(listener);
  return () => stackListeners.delete(listener);
}

function getStackVersion() {
  return stackVersion;
}

function registerDialog(entry: DialogEntry) {
  const existingIndex = dialogStack.findIndex((item) => item.id === entry.id);
  if (existingIndex >= 0) dialogStack.splice(existingIndex, 1);
  dialogStack.push(entry);
  emitStackChange();
}

function updateDialog(
  id: symbol,
  update: Partial<Pick<DialogEntry, "modal" | "panel">>
) {
  const entry = dialogStack.find((item) => item.id === id);
  if (!entry) return;
  let changed = false;
  if (typeof update.modal === "boolean" && entry.modal !== update.modal) {
    entry.modal = update.modal;
    changed = true;
  }
  if ("panel" in update && entry.panel !== update.panel) {
    entry.panel = update.panel ?? null;
    changed = true;
  }
  if (!changed) return;
  emitStackChange();
}

function unregisterDialog(id: symbol) {
  const index = dialogStack.findIndex((item) => item.id === id);
  if (index < 0) return;
  dialogStack.splice(index, 1);
  emitStackChange();
}

function isTopmostDialog(id: symbol) {
  return dialogStack.at(-1)?.id === id;
}

const bodyLockTokens = new Set<symbol>();
let bodyOverflowBeforeLock = "";

function acquireBodyLock(token: symbol) {
  if (bodyLockTokens.has(token)) return;
  if (bodyLockTokens.size === 0) {
    bodyOverflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyLockTokens.add(token);
}

function releaseBodyLock(token: symbol) {
  if (!bodyLockTokens.delete(token) || bodyLockTokens.size > 0) return;
  document.body.style.overflow = bodyOverflowBeforeLock;
  bodyOverflowBeforeLock = "";
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  "summary",
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function isElementVisible(element: HTMLElement) {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function getFocusableElements(panel: HTMLElement) {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    isElementVisible
  );
}

function isUsableFocusTarget(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || !isElementVisible(element)) return false;
  if (
    "disabled" in element &&
    typeof (element as HTMLButtonElement).disabled === "boolean" &&
    (element as HTMLButtonElement).disabled
  ) {
    return false;
  }
  return true;
}

function focusInitialTarget(
  panel: HTMLElement,
  initialFocusRef?: RefObject<HTMLElement | null>
) {
  const markedTarget = panel.querySelector<HTMLElement>(
    '[data-dialog-autofocus="true"]'
  );
  const target =
    (isUsableFocusTarget(initialFocusRef?.current ?? null)
      ? initialFocusRef?.current
      : null) ??
    (isUsableFocusTarget(markedTarget) ? markedTarget : null) ??
    getFocusableElements(panel)[0] ??
    panel;
  target.focus();
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
}

type DialogContextValue = {
  modal: boolean;
  hasModalAbove: boolean;
  titleId: string;
  descriptionId: string;
  descriptionCount: number;
  backdropDismissible: boolean;
  registerDescription: () => () => void;
  setPanel: (panel: HTMLDivElement | null) => void;
  dismissFromBackdrop: () => void;
};

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialogContext(componentName: string) {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error(`${componentName} must be rendered inside Dialog.`);
  }
  return context;
}

export function Dialog({
  open,
  modal = true,
  dismissible = true,
  closeOnEscape = true,
  closeOnBackdrop = true,
  restoreFocus = true,
  initialFocusRef,
  className = "",
  children,
  onDismiss,
}: DialogProps) {
  const entryIdRef = useRef(Symbol("dialog"));
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreTargetRef = useRef<HTMLElement | null>(null);
  const onDismissRef = useRef(onDismiss);
  const modalRef = useRef(modal);
  const dismissibleRef = useRef(dismissible);
  const closeOnEscapeRef = useRef(closeOnEscape);
  const closeOnBackdropRef = useRef(closeOnBackdrop);
  const initialFocusRefRef = useRef(initialFocusRef);
  const restoreFocusRef = useRef(restoreFocus);
  const titleId = useId();
  const descriptionId = useId();
  const [descriptionCount, setDescriptionCount] = useState(0);
  useSyncExternalStore(
    subscribeToStack,
    getStackVersion,
    getStackVersion
  );

  onDismissRef.current = onDismiss;
  modalRef.current = modal;
  dismissibleRef.current = dismissible;
  closeOnEscapeRef.current = closeOnEscape;
  closeOnBackdropRef.current = closeOnBackdrop;
  initialFocusRefRef.current = initialFocusRef;
  restoreFocusRef.current = restoreFocus;

  const setPanel = useCallback((panel: HTMLDivElement | null) => {
    panelRef.current = panel;
    updateDialog(entryIdRef.current, { panel });
  }, []);

  const registerDescription = useCallback(() => {
    setDescriptionCount((count) => count + 1);
    return () => setDescriptionCount((count) => Math.max(0, count - 1));
  }, []);

  useEffect(() => {
    if (!open) return;
    const id = entryIdRef.current;
    registerDialog({ id, modal: modalRef.current, panel: panelRef.current });
    return () => unregisterDialog(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    updateDialog(entryIdRef.current, { modal });
  }, [modal, open]);

  useEffect(() => {
    if (!open || !modal) return;
    const token = entryIdRef.current;
    acquireBodyLock(token);
    return () => releaseBodyLock(token);
  }, [modal, open]);

  useEffect(() => {
    if (!open) return;
    const id = entryIdRef.current;
    const restoreTarget =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    restoreTargetRef.current = restoreTarget;
    const focusFrame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (panel && isTopmostDialog(id)) {
        focusInitialTarget(panel, initialFocusRefRef.current);
      }
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      const shouldRestore = restoreFocusRef.current;
      const target = restoreTargetRef.current;
      window.requestAnimationFrame(() => {
        if (!shouldRestore) return;
        const topmost = dialogStack.at(-1);
        if (topmost?.panel) {
          if (isUsableFocusTarget(target) && topmost.panel.contains(target)) {
            target.focus();
          } else if (!topmost.panel.contains(document.activeElement)) {
            focusInitialTarget(topmost.panel);
          }
        } else if (isUsableFocusTarget(target)) {
          target.focus();
        }
      });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = entryIdRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isTopmostDialog(id)) return;

      if (event.key === "Escape") {
        if (event.defaultPrevented) return;
        if (!dismissibleRef.current || !closeOnEscapeRef.current) {
          if (modalRef.current) {
            event.preventDefault();
            event.stopPropagation();
          }
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        onDismissRef.current("escape");
        return;
      }

      if (event.key !== "Tab" || !modalRef.current) return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  const dismissFromBackdrop = useCallback(() => {
    if (
      !isTopmostDialog(entryIdRef.current) ||
      !dismissibleRef.current ||
      !closeOnBackdropRef.current
    ) {
      return;
    }
    onDismissRef.current("backdrop");
  }, []);

  const stackIndex = dialogStack.findIndex(
    (entry) => entry.id === entryIdRef.current
  );
  const hasModalAbove =
    stackIndex >= 0 &&
    dialogStack.slice(stackIndex + 1).some((entry) => entry.modal);
  const context = useMemo<DialogContextValue>(
    () => ({
      modal,
      hasModalAbove,
      titleId,
      descriptionId,
      descriptionCount,
      backdropDismissible: dismissible && closeOnBackdrop,
      registerDescription,
      setPanel,
      dismissFromBackdrop,
    }),
    [
      descriptionCount,
      descriptionId,
      dismissible,
      dismissFromBackdrop,
      hasModalAbove,
      modal,
      closeOnBackdrop,
      registerDescription,
      setPanel,
      titleId,
    ]
  );

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <DialogContext.Provider value={context}>
      <div
        data-dialog-layer="true"
        className={className}
        style={{ zIndex: 100 + Math.max(stackIndex, 0) * 10 }}
      >
        {children}
      </div>
    </DialogContext.Provider>,
    document.body
  );
}

export const DialogBackdrop = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function DialogBackdrop(
  { onPointerDown, "aria-label": ariaLabel = "Close dialog", ...props },
  ref
) {
  const { modal, backdropDismissible, dismissFromBackdrop } = useDialogContext(
    "DialogBackdrop"
  );
  if (!modal) return null;

  return (
    <button
      {...props}
      ref={ref}
      type="button"
      tabIndex={-1}
      disabled={!backdropDismissible}
      data-dialog-backdrop="true"
      aria-hidden={backdropDismissible ? undefined : "true"}
      aria-label={backdropDismissible ? ariaLabel : undefined}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (!event.defaultPrevented && event.target === event.currentTarget) {
          event.preventDefault();
          dismissFromBackdrop();
        }
      }}
    />
  );
});

type DialogPanelProps = HTMLAttributes<HTMLDivElement> & {
  role?: "dialog" | "alertdialog";
};

export const DialogPanel = forwardRef<HTMLDivElement, DialogPanelProps>(
  function DialogPanel(
    {
      role = "dialog",
      tabIndex = -1,
      "aria-labelledby": ariaLabelledBy,
      "aria-describedby": ariaDescribedBy,
      ...props
    },
    forwardedRef
  ) {
    const {
      modal,
      hasModalAbove,
      titleId,
      descriptionId,
      descriptionCount,
      setPanel,
    } = useDialogContext("DialogPanel");

    const panelRef = useCallback(
      (node: HTMLDivElement | null) => {
        setPanel(node);
        assignRef(forwardedRef, node);
      },
      [forwardedRef, setPanel]
    );

    return (
      <div
        {...props}
        ref={panelRef}
        role={role}
        tabIndex={tabIndex}
        aria-modal={modal ? "true" : undefined}
        aria-labelledby={ariaLabelledBy ?? titleId}
        aria-describedby={
          ariaDescribedBy ?? (descriptionCount > 0 ? descriptionId : undefined)
        }
        aria-hidden={hasModalAbove ? "true" : undefined}
        inert={hasModalAbove ? true : undefined}
      />
    );
  }
);

export const DialogTitle = forwardRef<
  HTMLHeadingElement,
  HTMLAttributes<HTMLHeadingElement>
>(function DialogTitle(props, ref) {
  const { titleId } = useDialogContext("DialogTitle");
  const { children, ...headingProps } = props;
  return (
    <h2 {...headingProps} ref={ref} id={props.id ?? titleId}>
      {children}
    </h2>
  );
});

export const DialogDescription = forwardRef<
  HTMLParagraphElement,
  HTMLAttributes<HTMLParagraphElement>
>(function DialogDescription(props, ref) {
  const { descriptionId, registerDescription } = useDialogContext(
    "DialogDescription"
  );

  useEffect(() => registerDescription(), [registerDescription]);

  return <p {...props} ref={ref} id={props.id ?? descriptionId} />;
});
