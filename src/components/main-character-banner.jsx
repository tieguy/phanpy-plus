import './main-character-banner.css';

import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'preact/hooks';
import { useSnapshot } from 'valtio';

import { api } from '../utils/api';
import { getOtherNetworkAccounts } from '../utils/bluesky';
import { findMainCharacter } from '../utils/main-character';
import { createMergedTimelineIterator } from '../utils/merged-timeline';
import { muteWordEverywhere } from '../utils/mute-word';
import showToast from '../utils/show-toast';
import states from '../utils/states';
import store from '../utils/store';

import Icon from './icon';

const ANALYZE_TTL = 20 * 60 * 1000; // re-analyze at most every 20 min
const SAMPLE_LIMIT = 120;
const DAY = 24 * 60 * 60; // seconds

// Module-level cache: analyzing the feed is a real fetch, so don't repeat it on
// every home mount / navigation.
let analysis = { at: 0, promise: null, result: null };

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function analyzeFeed(merged) {
  const { masto, instance } = api();
  const sources = [
    {
      instance,
      makeIterator: () => masto.v1.timelines.home.list({ limit: 40 }).values(),
    },
    ...(merged
      ? getOtherNetworkAccounts().map((account) => {
          const { masto: m, instance: inst } = api({ account });
          return {
            instance: inst,
            makeIterator: () =>
              m.v1.timelines.home.list({ limit: 40 }).values(),
          };
        })
      : []),
  ];
  const iterator = createMergedTimelineIterator(sources);
  const all = [];
  for (let i = 0; i < 4 && all.length < SAMPLE_LIMIT; i++) {
    const { done, value } = await iterator.next(40);
    if (value?.length) all.push(...value);
    if (done) break;
  }
  return findMainCharacter(all);
}

function getAnalysis(merged) {
  const now = Date.now();
  if (analysis.promise) return analysis.promise;
  if (analysis.at && now - analysis.at < ANALYZE_TTL) {
    return Promise.resolve(analysis.result);
  }
  analysis.promise = analyzeFeed(merged)
    .then((result) => {
      analysis = { at: Date.now(), promise: null, result };
      return result;
    })
    .catch((e) => {
      console.error('Main character analysis failed', e);
      analysis = { at: Date.now(), promise: null, result: null };
      return null;
    });
  return analysis.promise;
}

function invalidateAnalysis() {
  analysis = { at: 0, promise: null, result: null };
}

function isDismissed(key) {
  const state = store.account.get('mainCharacter') || {};
  if (state.date !== today()) return false;
  return (state.dismissed || []).includes(key);
}
function rememberDismissed(key) {
  const state = store.account.get('mainCharacter') || {};
  const dismissed = state.date === today() ? state.dismissed || [] : [];
  if (!dismissed.includes(key)) dismissed.push(key);
  store.account.set('mainCharacter', { date: today(), dismissed });
}

function MainCharacterBanner() {
  const { t } = useLingui();
  const snapStates = useSnapshot(states);
  const [mc, setMC] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAnalysis(snapStates.settings.mergedTimeline !== false).then((result) => {
      if (cancelled || !result) return;
      if (!isDismissed(result.key)) setMC(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!mc || hidden) return null;

  const mute = async (expiresIn) => {
    setBusy(true);
    try {
      const instances = await muteWordEverywhere(mc.keyword, { expiresIn });
      if (!instances.length) throw new Error('No mute applied');
      rememberDismissed(mc.key);
      invalidateAnalysis();
      setHidden(true);
      showToast(
        instances.length > 1
          ? t`Muted “${mc.keyword}” on ${instances.length} accounts`
          : t`Muted “${mc.keyword}”`,
      );
    } catch (e) {
      showToast(t`Couldn’t mute. Try again.`);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    rememberDismissed(mc.key);
    setHidden(true);
  };

  return (
    <div class="main-character-banner">
      <div class="mc-text">
        <Icon icon="alert" size="l" class="mc-icon" alt="" />
        <span>
          <b>{mc.label}</b> <Trans>is all over your feed today</Trans>{' '}
          <span class="mc-count">
            <Trans>
              — {mc.postCount} of {mc.total} recent posts
            </Trans>
          </span>
        </span>
      </div>
      <div class="mc-actions">
        <button
          type="button"
          class="plain2"
          disabled={busy}
          onClick={() => mute(DAY)}
        >
          <Icon icon="mute" size="s" alt="" /> <Trans>Mute for a day</Trans>
        </button>
        <button
          type="button"
          class="plain4 small"
          disabled={busy}
          onClick={() => mute(0)}
        >
          <Trans>Forever</Trans>
        </button>
        <button
          type="button"
          class="plain4 small"
          disabled={busy}
          onClick={dismiss}
        >
          <Trans>Not now</Trans>
        </button>
      </div>
    </div>
  );
}

export default MainCharacterBanner;
