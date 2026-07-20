// Tooltip primitive (T-307 requirement 4): shows on hover + keyboard focus. `content` is
// caller-resolved i18n copy. The trigger gets `aria-describedby` wired via cloneElement so screen
// readers announce it.
//
// Playtest (user): the tooltip used to be an in-flow `absolute` span, so an ancestor scroll container
// (`overflow-y-auto`/`overflow-x-hidden` on the sidebar sections) CLIPPED it — a wide tooltip near a
// panel edge was cut off ("stuck behind other stuff"). It now renders through a PORTAL to
// `document.body` at a fixed, viewport-relative position measured from the trigger, with a very high
// z-index — so it always floats above every panel and escapes all overflow/stacking contexts. It's
// only in the DOM while open (hover/focus); the trigger's `aria-describedby` still points at its id.
import { cloneElement, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { createPortal } from 'react-dom';

export interface TooltipProps {
  content: string;
  children: ReactElement;
  /** Make the trigger wrapper a full-width block instead of `inline-flex`, so a `fullWidth` button
   * wrapped for its disabled-reason tooltip still stretches to fill its grid/flex cell (matching an
   * un-wrapped enabled sibling). Default keeps the inline-flex wrapper. */
  block?: boolean;
}

export function Tooltip({ content, children, block = false }: TooltipProps) {
  const tooltipId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    setCoords({ top: r.top, left: r.left + r.width / 2 });
  }, []);

  const show = useCallback(() => {
    measure();
    setOpen(true);
  }, [measure]);
  const hide = useCallback(() => setOpen(false), []);

  // Re-measure once the tooltip has mounted (its own width isn't needed to place it — it's centered
  // over the trigger via transform — but this keeps the position correct if layout shifted between
  // the hover event and paint).
  useLayoutEffect(() => {
    if (open) measure();
  }, [open, measure]);

  const trigger = cloneElement(children, { 'aria-describedby': open ? tooltipId : undefined });

  const canPortal = typeof document !== 'undefined';

  return (
    <span
      ref={wrapRef}
      className={block ? 'flex w-full' : 'inline-flex'}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {trigger}
      {open && canPortal
        ? createPortal(
            <span
              ref={tipRef}
              role="tooltip"
              id={tooltipId}
              style={{ position: 'fixed', top: coords.top, left: coords.left, transform: 'translate(-50%, calc(-100% - 0.5rem))', zIndex: 1000 }}
              className="pointer-events-none max-w-[16rem] whitespace-normal rounded-button bg-ink px-2 py-1 font-ui text-12 text-panel shadow-soft"
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
