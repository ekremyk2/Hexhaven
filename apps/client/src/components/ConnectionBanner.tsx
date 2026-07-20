// Connection status banner (T-301 §6). Rendered once in the app shell; colors are placeholder
// Tailwind palette classes until the T-307 design tokens exist (noted in Implementation notes).
import { useTranslation } from 'react-i18next';
import { useConnectionStatus } from '../store';
import type { ConnectionStatus } from '../store/types';

const STATUS_KEY: Record<ConnectionStatus, string> = {
  connecting: 'connection.connecting',
  open: 'connection.open',
  reconnecting: 'connection.reconnecting',
  closed: 'connection.closed',
};

const STATUS_CLASS: Record<ConnectionStatus, string> = {
  connecting: 'bg-amber-100 text-amber-900',
  open: 'bg-emerald-100 text-emerald-900',
  reconnecting: 'bg-amber-100 text-amber-900',
  closed: 'bg-red-100 text-red-900',
};

export function ConnectionBanner() {
  const { t } = useTranslation('common');
  const status = useConnectionStatus();
  return (
    <div
      data-testid="connection-banner"
      className={`px-4 py-1 text-sm font-medium ${STATUS_CLASS[status]}`}
    >
      {t(STATUS_KEY[status])}
    </div>
  );
}
