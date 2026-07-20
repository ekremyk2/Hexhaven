// Card primitive (T-307 requirement 4): a smaller parchment surface for list items / compact
// groupings, distinct from Panel's bigger radius (docs/11 §1: "Radius: panels 12px ... cards 10px").
import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={['rounded-card border border-panel-edge bg-panel p-3 text-ink shadow-soft', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </div>
  );
}
