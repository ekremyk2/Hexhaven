// `/lobby/:gameId` room screen (T-401 requirement 3): room code + invite link, one seat card per
// `config.playerCount` seat, the own ready toggle, and the host-only Start button (D-025). Leaves
// for `/game/:gameId` automatically once `game.started` flips `lobby.started` (store/index.ts).
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { RoomConfig } from '@hexhaven/shared';
import { Badge, Button, Card, Panel, PlayerChip } from '../ui';
import { BugReportButton } from '../components/BugReportButton';
import { useLobbyState, useStore } from '../store';
import { gameModeSummary, isCkAddonOn } from '../options/OptionsPanel';
import { buildInviteHash, canStartGame } from './lobbyForms';

interface LobbyLocationState {
  config?: RoomConfig;
}

export default function Lobby() {
  const { t } = useTranslation(['lobby', 'common']);
  const { gameId } = useParams<'gameId'>();
  const navigate = useNavigate();
  const location = useLocation();
  const lobby = useLobbyState();
  const sendLobbyMessage = useStore((s) => s.sendLobbyMessage);
  const [copyFeedback, setCopyFeedback] = useState<'code' | 'link' | null>(null);

  // Only the client that just created this room (this browser tab, this navigation) ever knows
  // the full RoomConfig — `lobby.state` doesn't carry it back (docs/02 §5 lists no `config` field
  // on that payload). See Implementation notes: flagged as a small protocol gap for a joining
  // client, who only ever sees the player count (reliably derivable from `seats.length` below).
  const knownConfig = (location.state as LobbyLocationState | null)?.config;

  useEffect(() => {
    if (lobby.started && lobby.gameId) {
      navigate(`/game/${lobby.gameId}`);
    }
  }, [lobby.started, lobby.gameId, navigate]);

  const mySeat = lobby.mySeat;
  const isHost = mySeat !== null && mySeat === lobby.hostSeat;
  const myReady = mySeat !== null ? (lobby.seats[mySeat]?.ready ?? false) : false;
  const canStart = isHost && canStartGame(lobby.seats);

  function toggleReady() {
    sendLobbyMessage({ type: 'lobby.ready', payload: { ready: !myReady } });
  }

  function start() {
    sendLobbyMessage({ type: 'lobby.start', payload: {} });
  }

  // T-411 §1: host-only seat management. There is no difficulty selector — every bot is the single
  // strongest engine (T-410) — so these two messages carry nothing beyond the target seat.
  function addBot(seat: number) {
    sendLobbyMessage({ type: 'lobby.addBot', payload: { seat: seat as 0 | 1 | 2 | 3 | 4 | 5 } });
  }

  function removeBot(seat: number) {
    sendLobbyMessage({ type: 'lobby.removeBot', payload: { seat: seat as 0 | 1 | 2 | 3 | 4 | 5 } });
  }

  async function copyText(text: string, kind: 'code' | 'link') {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(kind);
    } catch {
      setCopyFeedback(null);
    }
  }

  const code = lobby.code ?? gameId ?? '';
  const inviteUrl = typeof window !== 'undefined' ? `${window.location.origin}/${buildInviteHash(code)}` : '';

  const modeSummary = knownConfig ? gameModeSummary(knownConfig) : null;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <Panel>
        <h1 className="font-display text-24 font-semibold text-ink">{t('lobby:room.heading')}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {/* T-501 e2e: the OTHER 3 seats must read this exact code off seat 0's screen to join —
              no existing testid/role distinguishes it from the rest of the room-code UI. */}
          <span className="font-ui text-20 font-semibold tracking-widest text-ink" data-testid="room-code">
            {code}
          </span>
          <Button variant="subtle" size="sm" onClick={() => void copyText(code, 'code')}>
            {copyFeedback === 'code' ? t('lobby:room.copied') : t('lobby:room.copyCode')}
          </Button>
          <Button variant="subtle" size="sm" onClick={() => void copyText(inviteUrl, 'link')}>
            {copyFeedback === 'link' ? t('lobby:room.copied') : t('lobby:room.copyLink')}
          </Button>
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {lobby.seats.map((seat, index) => {
          const seatNumber = index as 0 | 1 | 2 | 3 | 4 | 5;
          const connected = lobby.presence[seatNumber] ?? true;
          const isBot = seat?.occupant === 'bot';
          // T-411 §1: bots never carry a literal display string from the server — the localized
          // "Bot N" label is built here from the seat index, same as every other lobby copy.
          const displayName = isBot ? t('lobby:room.botName', { number: index + 1 }) : (seat?.nickname ?? '');

          return (
            // T-501 e2e: ready-gating/seat-fill assertions need to address one specific seat's
            // card (ready badge, connection dot) — no existing testid covers a lobby seat row.
            <Card key={index} data-testid={`lobby-seat-${index}`}>
              {seat ? (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <PlayerChip seat={seatNumber} name={displayName} />
                    {isBot ? <Badge>{t('lobby:room.botBadge')}</Badge> : null}
                    {lobby.hostSeat === index ? <Badge variant="gold">{t('lobby:room.hostBadge')}</Badge> : null}
                    {isBot ? null : (
                      <>
                        <span
                          aria-hidden="true"
                          className={`h-2 w-2 rounded-full ${connected ? 'bg-accent' : 'bg-danger'}`}
                        />
                        <span className="sr-only">
                          {connected ? t('lobby:room.connected') : t('lobby:room.disconnected')}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={seat.ready ? 'gold' : 'default'}>
                      {seat.ready ? t('lobby:room.readyBadge') : t('lobby:room.notReadyBadge')}
                    </Badge>
                    {isBot && isHost ? (
                      <Button variant="subtle" size="sm" onClick={() => removeBot(index)}>
                        {t('lobby:room.removeBotButton')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : isHost ? (
                <div className="flex items-center justify-between gap-2">
                  <p className="font-ui text-14 text-ink-soft">{t('lobby:room.seatEmpty')}</p>
                  <Button variant="subtle" size="sm" onClick={() => addBot(index)}>
                    {t('lobby:room.addBotButton')}
                  </Button>
                </div>
              ) : (
                <p className="font-ui text-14 text-ink-soft">{t('lobby:room.seatEmpty')}</p>
              )}
            </Card>
          );
        })}
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-18 font-semibold text-ink">{t('lobby:room.summaryHeading')}</h2>
          <span className="font-ui text-14 text-ink-soft">
            {t('lobby:room.summaryPlayers', { count: lobby.seats.length })}
          </span>
        </div>
        {knownConfig && modeSummary ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {/* The same game-mode summary the Home field shows, so the room echoes the chosen game. */}
            <Badge variant="gold">
              {t(modeSummary.nameKey)}
              {modeSummary.detailKey ? ` · ${t(modeSummary.detailKey)}` : ''}
            </Badge>
            {isCkAddonOn(knownConfig) ? <Badge>{t('lobby:options.gameMode.ckBadge')}</Badge> : null}
            <span className="font-ui text-12 text-ink-soft">
              {knownConfig.timers.timers ? t('lobby:room.summaryTimersOn') : t('lobby:room.summaryTimersOff')}
            </span>
            {knownConfig.expansions.fiveSix ? (
              <span className="font-ui text-12 text-ink-soft">
                {t('lobby:room.summaryTurnRule', {
                  rule: t(
                    knownConfig.variants?.fiveSixTurnRule === 'pairedPlayers'
                      ? 'lobby:turnRule.pairedPlayers.name'
                      : 'lobby:turnRule.sbp.name'
                  ),
                })}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="mt-1 font-ui text-12 text-ink-soft">{t('lobby:room.summaryUnavailable')}</p>
        )}
      </Panel>

      <div className="flex items-center gap-3">
        <Button variant={myReady ? 'subtle' : 'primary'} onClick={toggleReady}>
          {myReady ? t('lobby:room.readyToggleOff') : t('lobby:room.readyToggleOn')}
        </Button>
        {isHost ? (
          <Button variant="primary" disabled={!canStart} onClick={start}>
            {t('lobby:room.startButton')}
          </Button>
        ) : null}
      </div>
      {isHost && !canStart ? <p className="font-ui text-12 text-ink-soft">{t('lobby:room.startHint')}</p> : null}

      {/* Unobtrusive footer affordance — opens a prefilled GitHub issue (no API/token; static client). */}
      <div className="flex justify-end">
        <BugReportButton screen="lobby" details={{ roomCode: lobby.code, gameId: lobby.gameId }} />
      </div>
    </main>
  );
}
