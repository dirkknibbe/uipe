import type { Page } from 'playwright';
import { executeAction } from '../../browser/actions.js';
import { assertNavigableUrl } from '../../utils/url-guard.js';
import type { ScreencastRecorder } from '../capture/screencast-recorder.js';
import type { SiteMap } from '../sitemap/sitemap.js';
import type { ReducedMotionResult, Trigger } from '../types.js';
import { motionEnergy } from './measure.js';

export type { ReducedMotionResult };

const SIDE_EFFECT_ACTIONS = new Set(['type', 'pressKey']);

type NotReproducible = Extract<ReducedMotionResult, { status: 'not-reproducible' }>;
const no = (reason: NotReproducible['reason']): ReducedMotionResult => ({ status: 'not-reproducible', reason });

async function reissue(page: Page, trigger: Trigger): Promise<void> {
  if (trigger.action) await executeAction(page, trigger.action);
  else if (trigger.kind === 'scroll-step') await page.evaluate((y) => window.scrollTo(0, y), trigger.scrollY ?? 0);
  else await page.reload();
}

export async function replayReducedMotion(args: {
  page: Page; siteMap: SiteMap; stateId: string; trigger: Trigger;
  recorder: ScreencastRecorder; settleMs: number; normalMotion: number;
}): Promise<ReducedMotionResult> {
  const { page, siteMap, stateId, trigger, recorder, settleMs, normalMotion } = args;
  if (trigger.action && SIDE_EFFECT_ACTIONS.has(trigger.action.type)) return no('side-effect-risk');
  const path = siteMap.pathTo(stateId);
  if (!path) return no('unreachable-state');
  if (path.some((a) => SIDE_EFFECT_ACTIONS.has(a.type))) return no('side-effect-risk');

  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assertNavigableUrl(siteMap.startStateUrl);
    await page.goto(siteMap.startStateUrl);
    for (const action of path) {
      await executeAction(page, action);
      await page.waitForTimeout(settleMs);
    }
    // Only frames from the re-issued trigger should count.
    recorder.dropBefore(Number.POSITIVE_INFINITY);
    await reissue(page, trigger);
    await page.waitForTimeout(settleMs);
    const reduced = await motionEnergy(recorder.framesBetween(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY));
    return { status: 'measured', motionRatio: normalMotion > 0 ? reduced / normalMotion : 0 };
  } catch {
    return no('error');
  } finally {
    await page.emulateMedia({ reducedMotion: null }).catch(() => undefined);
  }
}
