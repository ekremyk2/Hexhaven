// Dev-only /styleguide route (T-307 requirement 5): every ui/ primitive in every state, plus the
// token palette — this is the PM's screenshot-review surface (docs/11 §7) and the visual
// regression reference for later tasks. Gated behind import.meta.env.DEV in App.tsx.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Button,
  Card,
  IconButton,
  Meter,
  Modal,
  Panel,
  PlayerChip,
  SegmentedControl,
  StatTile,
  Tabs,
  TextInput,
  Tooltip,
} from '../ui';
import { StyleguidePanels } from './StyleguidePanels';

const SURFACE_SWATCHES = [
  ['tableA', 'bg-table-a'],
  ['tableB', 'bg-table-b'],
  ['panel', 'bg-panel'],
  ['panelEdge', 'bg-panel-edge'],
  ['ink', 'bg-ink'],
  ['inkSoft', 'bg-ink-soft'],
  ['accent', 'bg-accent'],
  ['accentGold', 'bg-accent-gold'],
  ['danger', 'bg-danger'],
] as const;

const SEAT_SWATCHES = [
  ['seat0', 'bg-seat-0'],
  ['seat1', 'bg-seat-1'],
  ['seat2', 'bg-seat-2'],
  ['seat3', 'bg-seat-3'],
  ['seat4', 'bg-seat-4'],
  ['seat5', 'bg-seat-5'],
] as const;

const TERRAIN_SWATCHES = [
  ['hills', 'bg-terrain-hills'],
  ['forest', 'bg-terrain-forest'],
  ['pasture', 'bg-terrain-pasture'],
  ['fields', 'bg-terrain-fields'],
  ['mountains', 'bg-terrain-mountains'],
  ['desert', 'bg-terrain-desert'],
] as const;

function Swatch({ label, className }: { label: string; className: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`h-12 w-12 rounded-card border border-panel-edge shadow-soft ${className}`} />
      <span className="font-ui text-12 text-ink-soft">{label}</span>
    </div>
  );
}

export default function Styleguide() {
  const { t } = useTranslation('common');
  const [segment, setSegment] = useState('a');
  const [modalOpen, setModalOpen] = useState(false);
  const [nickname, setNickname] = useState('');
  const [tab, setTab] = useState('tab1');

  const seatNames = [
    t('styleguide.playerChips.sample0'),
    t('styleguide.playerChips.sample1'),
    t('styleguide.playerChips.sample2'),
    t('styleguide.playerChips.sample3'),
    t('styleguide.playerChips.sample4'),
    t('styleguide.playerChips.sample5'),
  ] as const;

  return (
    <div className="hexhaven-table px-6 py-10">
      <div className="mx-auto flex max-w-4xl flex-col gap-10">
        <header>
          <h1 className="font-display text-28 font-semibold text-ink-ondark">{t('styleguide.heading')}</h1>
          <p className="mt-1 font-ui text-14 text-ink-ondark/80">{t('styleguide.tagline')}</p>
        </header>

        <Panel>
          <h2 className="font-display text-20 font-semibold text-ink">{t('styleguide.sections.tokens')}</h2>
          <div className="mt-4 flex flex-col gap-6">
            <div>
              <h3 className="font-ui text-14 font-semibold text-ink-soft">
                {t('styleguide.tokenGroups.surfaces')}
              </h3>
              <div className="mt-2 flex flex-wrap gap-4">
                {SURFACE_SWATCHES.map(([key, className]) => (
                  <Swatch key={key} label={t(`styleguide.tokenNames.${key}`)} className={className} />
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-ui text-14 font-semibold text-ink-soft">
                {t('styleguide.tokenGroups.seats')}
              </h3>
              <div className="mt-2 flex flex-wrap gap-4">
                {SEAT_SWATCHES.map(([key, className]) => (
                  <Swatch key={key} label={t(`styleguide.tokenNames.${key}`)} className={className} />
                ))}
              </div>
            </div>
            <div>
              <h3 className="font-ui text-14 font-semibold text-ink-soft">
                {t('styleguide.tokenGroups.terrain')}
              </h3>
              <div className="mt-2 flex flex-wrap gap-4">
                {TERRAIN_SWATCHES.map(([key, className]) => (
                  <Swatch key={key} label={t(`styleguide.tokenNames.${key}`)} className={className} />
                ))}
              </div>
            </div>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-20 font-semibold text-ink">{t('styleguide.sections.buttons')}</h2>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button variant="primary">{t('styleguide.buttons.primary')}</Button>
            <Button variant="subtle">{t('styleguide.buttons.subtle')}</Button>
            <Button variant="danger">{t('styleguide.buttons.danger')}</Button>
            <Button variant="primary" disabled>
              {t('styleguide.buttons.disabled')}
            </Button>
            <Button variant="primary" size="sm">
              {t('styleguide.buttons.primary')}
            </Button>
            <Button variant="primary" size="lg">
              {t('styleguide.buttons.primary')}
            </Button>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-20 font-semibold text-ink">{t('styleguide.sections.surfaces')}</h2>
          <div className="mt-4 flex flex-wrap gap-4">
            <Card>{t('styleguide.surfaces.cardBody')}</Card>
            <Panel>{t('styleguide.surfaces.panelBody')}</Panel>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-20 font-semibold text-ink">{t('styleguide.sections.inputs')}</h2>
          <div className="mt-4 flex flex-wrap gap-4">
            <TextInput
              label={t('styleguide.inputs.label')}
              placeholder={t('styleguide.inputs.placeholder')}
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
            />
            <TextInput
              label={t('styleguide.inputs.errorLabel')}
              placeholder={t('styleguide.inputs.placeholder')}
              error={t('styleguide.inputs.errorMessage')}
            />
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-20 font-semibold text-ink">{t('styleguide.sections.modal')}</h2>
          <div className="mt-4">
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              {t('styleguide.modal.openButton')}
            </Button>
            <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('styleguide.modal.title')}>
              <p className="font-ui text-14 text-ink">{t('styleguide.modal.body')}</p>
            </Modal>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-20 font-semibold text-ink">{t('styleguide.sections.segmented')}</h2>
          <div className="mt-4">
            <SegmentedControl
              ariaLabel={t('styleguide.segmented.ariaLabel')}
              value={segment}
              onChange={setSegment}
              options={[
                { value: 'a', label: t('styleguide.segmented.optionA') },
                { value: 'b', label: t('styleguide.segmented.optionB') },
                { value: 'c', label: t('styleguide.segmented.optionC') },
              ]}
            />
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-20 font-semibold text-ink">{t('styleguide.sections.tooltip')}</h2>
          <div className="mt-4">
            <Tooltip content={t('styleguide.tooltip.content')}>
              <Button variant="subtle">{t('styleguide.tooltip.trigger')}</Button>
            </Tooltip>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-20 font-semibold text-ink">{t('styleguide.sections.badges')}</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <Badge variant="default">{t('styleguide.badges.default')}</Badge>
            <Badge variant="gold">{t('styleguide.badges.gold')}</Badge>
            <Badge variant="danger">{t('styleguide.badges.danger')}</Badge>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-20 font-semibold text-ink">
            {t('styleguide.sections.playerChips')}
          </h2>
          <div className="mt-4 flex flex-wrap gap-3">
            {([0, 1, 2, 3, 4, 5] as const).map((seat) => (
              <PlayerChip key={seat} seat={seat} name={seatNames[seat]} active={seat === 0} />
            ))}
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-20 font-semibold text-ink">{t('styleguide.sections.tabs')}</h2>
          <div className="mt-4">
            <Tabs
              ariaLabel={t('styleguide.tabs.ariaLabel')}
              activeId={tab}
              onChange={setTab}
              tabs={[
                { id: 'tab1', label: t('styleguide.tabs.tab1') },
                { id: 'tab2', label: t('styleguide.tabs.tab2'), badge: 3 },
                { id: 'tab3', label: t('styleguide.tabs.tab3') },
              ]}
            />
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-20 font-semibold text-ink">{t('styleguide.sections.meter')}</h2>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Meter value={2} max={5} color="#c9a227" trailing="2/5" />
            <span className="font-ui text-12 text-ink-soft">{t('styleguide.meter.label')}</span>
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-20 font-semibold text-ink">{t('styleguide.sections.iconButton')}</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            <IconButton icon="⚔️" label={t('styleguide.iconButton.sample1')} />
            <IconButton icon="🔀" label={t('styleguide.iconButton.sample2')} active />
            <IconButton icon="✖" label={t('styleguide.iconButton.sample3')} disabled />
          </div>
        </Panel>

        <Panel>
          <h2 className="font-display text-20 font-semibold text-ink">{t('styleguide.sections.statTile')}</h2>
          <div className="mt-4 flex flex-wrap gap-4">
            <StatTile icon="🧱">{t('styleguide.statTile.sample')}</StatTile>
          </div>
        </Panel>

        <StyleguidePanels />
      </div>
    </div>
  );
}
