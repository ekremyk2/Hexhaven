// `/` home screen (T-401 requirement 1): create/join cards + the game-options panel. Talks to the
// server exclusively through the store's `sendLobbyMessage` (never a raw transport, docs/02 §8)
// and reacts to `lobby.state`/`lobby.lastError` to navigate into the room or show an inline error.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { RoomConfig } from '@hexhaven/shared';
import { Badge, Button, Card, TextInput } from '../ui';
import {
  DEFAULT_ROOM_CONFIG,
  countEnabledModifiers,
  gameModeSummary,
  isCkAddonOn,
} from '../options/OptionsPanel';
import { GameModeDialog } from '../options/GameModeDialog';
import { ModifiersDialog } from '../options/ModifiersDialog';
import { ConfigPresets } from '../options/ConfigPresets';
import { useLobbyState, useStore } from '../store';
import {
  buildCreatePayload,
  buildJoinPayload,
  isPasswordErrorCode,
  isValidNickname,
  isValidRoomCode,
  parseJoinHash,
  readStoredNickname,
  readStoredRoomConfig,
  sanitizeRoomCode,
  saveStoredNickname,
  saveStoredRoomConfig,
} from './lobbyForms';

/** `lobby.lastError` only ever means "reply to the flow the user just submitted" (there is no
 * request-id correlation on the wire — docs/02 §5's `game.error` is just `{code, message}`), so
 * Home tracks which card is awaiting a reply and only that card renders the error. */
type PendingFlow = 'create' | 'join' | null;

export default function Home() {
  const { t } = useTranslation(['common', 'lobby', 'errors']);
  const navigate = useNavigate();
  const lobby = useLobbyState();
  const sendLobbyMessage = useStore((s) => s.sendLobbyMessage);
  const setLobbyError = useStore((s) => s.setLobbyError);
  const leaveGame = useStore((s) => s.leaveGame);

  const [nickname, setNickname] = useState(() => readStoredNickname());
  // Restore the last-used game settings from localStorage (falling back to defaults), and persist
  // every change so they survive a reload / return visit.
  const [roomConfig, setRoomConfig] = useState(() => readStoredRoomConfig() ?? DEFAULT_ROOM_CONFIG);
  const updateRoomConfig = (next: RoomConfig) => {
    setRoomConfig(next);
    saveStoredRoomConfig(next);
  };
  const [createPassword, setCreatePassword] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [pendingFlow, setPendingFlow] = useState<PendingFlow>(null);
  const [localNicknameError, setLocalNicknameError] = useState(false);
  const [localCodeError, setLocalCodeError] = useState(false);
  const [gameModeOpen, setGameModeOpen] = useState(false);
  const [modifiersOpen, setModifiersOpen] = useState(false);

  // Invite-link round trip: the copyable link is now the clean path `<base>/join/CODE` (matched by
  // the `/join/:code` route → this component). The legacy `#/join/CODE` hash form is still honored so
  // old links keep working.
  const { code: joinCodeParam } = useParams<{ code?: string }>();
  useEffect(() => {
    const code = joinCodeParam ? joinCodeParam.toUpperCase() : parseJoinHash(window.location.hash);
    if (code) setJoinCode(code);
  }, [joinCodeParam]);

  // Once create/join succeeds (a `lobby.state` assigned us a seat), leave for the room. Guarded on
  // `pendingFlow` so mounting Home while already seated (e.g. browser back button) doesn't bounce
  // the user straight back out.
  useEffect(() => {
    if (pendingFlow && lobby.gameId && lobby.mySeat !== null) {
      navigate(`/lobby/${lobby.gameId}`, { state: { config: pendingFlow === 'create' ? roomConfig : undefined } });
    }
  }, [pendingFlow, lobby.gameId, lobby.mySeat, navigate, roomConfig]);

  const serverError = lobby.lastError;

  function submitCreate() {
    if (!isValidNickname(nickname)) {
      setLocalNicknameError(true);
      return;
    }
    setLocalNicknameError(false);
    // Wipe any finished-game state (view/toasts/lobby + persisted session) before starting fresh,
    // so a new game can't bounce back to the previous one or replay its toasts.
    leaveGame();
    setLobbyError(null);
    saveStoredNickname(nickname.trim());
    setPendingFlow('create');
    sendLobbyMessage(buildCreatePayload(nickname, roomConfig, createPassword));
  }

  function submitJoin() {
    const nicknameOk = isValidNickname(nickname);
    const codeOk = isValidRoomCode(joinCode);
    setLocalNicknameError(!nicknameOk);
    setLocalCodeError(!codeOk);
    if (!nicknameOk || !codeOk) return;
    leaveGame();
    setLobbyError(null);
    saveStoredNickname(nickname.trim());
    setPendingFlow('join');
    sendLobbyMessage(buildJoinPayload(joinCode, nickname, joinPassword));
  }

  const createServerError = pendingFlow === 'create' ? serverError : null;
  const joinServerError = pendingFlow === 'join' ? serverError : null;
  const showCreatePassword = createServerError ? isPasswordErrorCode(createServerError.code) : false;
  const showJoinPassword = joinServerError ? isPasswordErrorCode(joinServerError.code) : false;

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-3">
      <header>
        <h1 className="font-display text-24 font-semibold text-ink-ondark">{t('common:home.heading')}</h1>
        <p className="font-ui text-14 text-ink-ondark/80">{t('common:home.tagline')}</p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* T-501 e2e: both cards render a "Nickname" TextInput with the same label, so Playwright
            can't disambiguate them via role/label alone — a minimal, justified data-testid per
            CLAUDE.md's "avoid touching app source except a data-testid if a selector genuinely
            needs one" allowance. */}
        <Card data-testid="home-create-card">
          <h2 className="mb-3 font-display text-20 font-semibold text-ink">
            {t('lobby:home.createCard.title')}
          </h2>
          <div className="flex flex-col gap-3">
            <TextInput
              label={t('lobby:home.nicknameLabel')}
              placeholder={t('lobby:home.nicknamePlaceholder')}
              value={nickname}
              maxLength={20}
              onChange={(e) => {
                setNickname(e.target.value);
                setLocalNicknameError(false);
              }}
              error={localNicknameError ? t('lobby:home.validation.nicknameInvalid') : undefined}
            />
            {/* The "PUBG-style" game-mode field: one prominent control that opens the picker
                (board world + C&K add-on + player count + scenario). Everything that used to stack
                inline on this card now lives in the GameModeDialog so Home fits one screen. */}
            <GameModeField
              config={roomConfig}
              onOpen={() => setGameModeOpen(true)}
              label={t('lobby:options.gameMode.fieldLabel')}
            />
            <Button
              variant="subtle"
              aria-haspopup="dialog"
              data-testid="modifiers-open-button"
              onClick={() => setModifiersOpen(true)}
            >
              {t('lobby:options.modifiersButton', { count: countEnabledModifiers(roomConfig) })}
            </Button>
            <ConfigPresets value={roomConfig} onLoad={updateRoomConfig} />
            <GameModeDialog
              open={gameModeOpen}
              onClose={() => setGameModeOpen(false)}
              value={roomConfig}
              onChange={updateRoomConfig}
            />
            <ModifiersDialog
              open={modifiersOpen}
              onClose={() => setModifiersOpen(false)}
              value={roomConfig}
              onChange={updateRoomConfig}
            />
            {showCreatePassword ? (
              <TextInput
                label={t('lobby:home.passwordLabel')}
                placeholder={t('lobby:home.passwordPlaceholder')}
                type="password"
                value={createPassword}
                onChange={(e) => setCreatePassword(e.target.value)}
                error={createServerError ? t(`errors:${createServerError.code}`) : undefined}
              />
            ) : createServerError ? (
              <p role="alert" className="font-ui text-12 text-danger">
                {t(`errors:${createServerError.code}`)}
              </p>
            ) : null}
            <Button onClick={submitCreate}>{t('lobby:home.createCard.submit')}</Button>
          </div>
        </Card>

        <Card data-testid="home-join-card">
          <h2 className="mb-3 font-display text-20 font-semibold text-ink">
            {t('lobby:home.joinCard.title')}
          </h2>
          <div className="flex flex-col gap-3">
            <TextInput
              label={t('lobby:home.nicknameLabel')}
              placeholder={t('lobby:home.nicknamePlaceholder')}
              value={nickname}
              maxLength={20}
              onChange={(e) => {
                setNickname(e.target.value);
                setLocalNicknameError(false);
              }}
              error={localNicknameError ? t('lobby:home.validation.nicknameInvalid') : undefined}
            />
            <TextInput
              label={t('lobby:home.joinCard.codeLabel')}
              placeholder={t('lobby:home.joinCard.codePlaceholder')}
              value={joinCode}
              maxLength={5}
              onChange={(e) => {
                setJoinCode(sanitizeRoomCode(e.target.value));
                setLocalCodeError(false);
              }}
              error={localCodeError ? t('lobby:home.validation.codeInvalid') : undefined}
            />
            {showJoinPassword ? (
              <TextInput
                label={t('lobby:home.passwordLabel')}
                placeholder={t('lobby:home.passwordPlaceholder')}
                type="password"
                value={joinPassword}
                onChange={(e) => setJoinPassword(e.target.value)}
                error={joinServerError ? t(`errors:${joinServerError.code}`) : undefined}
              />
            ) : joinServerError ? (
              <p role="alert" className="font-ui text-12 text-danger">
                {t(`errors:${joinServerError.code}`)}
              </p>
            ) : null}
            <Button onClick={submitJoin}>{t('lobby:home.joinCard.submit')}</Button>
          </div>
        </Card>
      </div>

      <p className="font-ui text-14 text-ink-ondark/80">
        <Link to="/hotseat" className="underline">
          {t('common:home.hotseatLink')}
        </Link>
      </p>
    </main>
  );
}

/** Decorative glyphs referenced (not inlined) so the i18n raw-text guard treats them as chrome, not
 *  translatable copy (same pattern as ThemeToggle's glyph map). */
const CHEVRON_GLYPH = '▾';
const DETAIL_SEP = ' · ';

/** The prominent "game mode" field on the create card: a single button showing the live selection
 *  (board world · scenario · +C&K · N players) that opens the GameModeDialog. */
function GameModeField({
  config,
  onOpen,
  label,
}: {
  config: RoomConfig;
  onOpen: () => void;
  label: string;
}) {
  const { t } = useTranslation(['lobby']);
  const { nameKey, detailKey } = gameModeSummary(config);
  const ck = isCkAddonOn(config);

  return (
    <div>
      <p className="mb-1 font-ui text-12 font-semibold uppercase text-ink-soft">{label}</p>
      <button
        type="button"
        aria-haspopup="dialog"
        data-testid="game-mode-field"
        onClick={onOpen}
        className="flex w-full items-center justify-between gap-3 rounded-card border-2 border-accent/70 bg-accent/10 p-3 text-left transition-colors hover:bg-accent/20"
      >
        <span className="min-w-0">
          <span className="block truncate font-ui text-15 font-semibold text-ink">
            {t(nameKey)}
            {detailKey ? <span className="font-normal text-ink-soft">{DETAIL_SEP}{t(detailKey)}</span> : null}
          </span>
          <span className="mt-0.5 flex items-center gap-2">
            {ck ? <Badge variant="gold">{t('lobby:options.gameMode.ckBadge')}</Badge> : null}
            <span className="font-ui text-12 text-ink-soft">
              {t('lobby:options.gameMode.fieldPlayers', { count: config.playerCount })}
            </span>
          </span>
        </span>
        <span aria-hidden="true" className="shrink-0 font-ui text-18 text-ink-soft">{CHEVRON_GLYPH}</span>
      </button>
    </div>
  );
}
