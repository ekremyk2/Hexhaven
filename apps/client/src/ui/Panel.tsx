// Panel primitive (T-307 requirement 3/4): the parchment side-panel/hand-tray/card treatment
// (docs/11 §1-§2). Applies the canonical `.hexhaven-panel` recipe from theme/tokens.css directly, so
// the CSS recipe has one home and this component is just "mount it + let children through".
import type { HTMLAttributes, ReactNode } from 'react';

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Panel({ children, className, ...rest }: PanelProps) {
  return (
    <div {...rest} className={['hexhaven-panel p-4', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}
