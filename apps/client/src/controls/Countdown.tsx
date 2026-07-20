// Countdown (T-403 requirement 3): T-206's optional per-seat timer deadlines rendered as a live
// "Ns left" badge. Renders nothing when the server hasn't sent a deadline for this seat (timers
// off entirely, or this particular seat has none pending) — T-206 is optional, so this task only
// ever displays what the server actually sent, never invents its own clock.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../ui';

const LOW_TIME_THRESHOLD_SEC = 10;

/** Pure: seconds remaining until `deadline` (epoch ms), floored at 0 — never negative even if
 * `now` has already passed it (the server message that clears it just hasn't arrived yet). */
export function remainingSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export interface CountdownProps {
  /** Epoch-ms deadline for the seat this bar belongs to, or `null`/`undefined` when none is
   * currently active. */
  deadline: number | null | undefined;
}

export function Countdown({ deadline }: CountdownProps) {
  const { t } = useTranslation('game');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline == null) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline]);

  if (deadline == null) return null;

  const seconds = remainingSeconds(deadline, now);
  return (
    <Badge variant={seconds <= LOW_TIME_THRESHOLD_SEC ? 'danger' : 'default'} data-testid="countdown">
      {t('controls.countdown.label', { seconds })}
    </Badge>
  );
}
