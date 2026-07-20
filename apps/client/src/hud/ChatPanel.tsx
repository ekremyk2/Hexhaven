// ChatPanel (QoL: in-game chat): the message list + composer for the sidebar's Chat tab. The wire
// (chat.send / chat.message), server relay, and store slice already exist end-to-end — this is just
// the UI over `useChatMessages()` + the store's `sendChatMessage`. Works pre-start (lobby) and mid-
// game since chat is a session-level, not engine, feature. Sender names are colour-coded by seat.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PLAYER_COLORS } from '../board/palette';
import { useChatMessages, useStore } from '../store';
import { Button, TextInput } from '../ui';

const MAX_CHAT_LENGTH = 300; // mirrors ChatSendPayloadSchema (packages/shared/src/protocol/messages.ts)
// Punctuation, not copy — a const so the i18n-guard doesn't flag it as hardcoded user-facing text.
const NAME_SEP = ': ';

export function ChatPanel() {
  const { t } = useTranslation('game');
  const messages = useChatMessages();
  const sendChatMessage = useStore((s) => s.sendChatMessage);
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as they arrive.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const send = () => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    sendChatMessage(trimmed.slice(0, MAX_CHAT_LENGTH));
    setText('');
  };

  return (
    // p-1.5: the composer input sits flush against the sidebar's left/bottom edges, whose
    // `overflow-hidden` clipped the input's focus ring (ring-2 + ring-offset-2 ≈ 4px) on those two
    // sides (playtest: "the orange outline doesn't show up on the left or bottom"). This inset gives
    // the ring room to render fully inside the clip region.
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-1.5" data-testid="chat-panel">
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-card border border-panel-edge p-2">
        {messages.length === 0 ? (
          <p className="font-ui text-12 italic text-ink-soft">{t('chat.empty')}</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1">
              {messages.map((m) => (
                <li key={m.id} className="font-ui text-12 text-ink">
                  <span className="font-semibold" style={{ color: PLAYER_COLORS[m.seat] }}>
                    {m.nickname}
                  </span>
                  <span className="text-ink-soft">{NAME_SEP}</span>
                  <span className="break-words">{m.text}</span>
                </li>
              ))}
            </ul>
            <div ref={endRef} />
          </>
        )}
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="flex-1">
          <TextInput
            label={t('chat.inputLabel')}
            value={text}
            maxLength={MAX_CHAT_LENGTH}
            placeholder={t('chat.placeholder')}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <Button type="submit" variant="subtle" disabled={text.trim() === ''} data-testid="chat-send">
          {t('chat.send')}
        </Button>
      </form>
    </div>
  );
}
