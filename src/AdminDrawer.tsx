import { useEffect, useRef, type ReactNode } from "react";
export default function AdminDrawer({
  open,
  locked,
  preview,
  onRequestClose,
  children,
}: {
  open: boolean;
  locked: boolean;
  preview: boolean;
  onRequestClose: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    returnFocus.current = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    const frame = requestAnimationFrame(() => {
      const focus = element.querySelector<HTMLElement>(
        preview ? "audio" : "input",
      );
      if (focus) {
        if (preview) {
          focus.tabIndex = 0;
          focus.scrollIntoView({ block: "center" });
        }
        focus.focus();
      }
    });
    return () => {
      cancelAnimationFrame(frame);
      element.close();
      document.body.style.overflow = overflow;
      const target = returnFocus.current?.isConnected
        ? returnFocus.current
        : document.querySelector<HTMLElement>("[data-admin-tab].active");
      target?.focus();
    };
  }, [open, preview]);
  return (
    <dialog
      ref={dialog}
      className="admin-drawer"
      aria-label="作品编辑面板"
      onCancel={(event) => {
        event.preventDefault();
        if (!locked) onRequestClose();
      }}
    >
      <div className="drawer-top">
        <span>作品编辑与预览</span>
        <button
          className="secondary"
          disabled={locked}
          aria-label="关闭作品编辑面板"
          onClick={onRequestClose}
        >
          关闭 ✕
        </button>
      </div>
      {open && children}
    </dialog>
  );
}
