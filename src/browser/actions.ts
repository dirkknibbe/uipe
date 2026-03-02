import type { Page } from 'playwright';
import type { BrowserAction } from '../types/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ActionExecutor');

export async function executeAction(page: Page, action: BrowserAction): Promise<void> {
  logger.info('Executing action', action);

  switch (action.type) {
    case 'click':
      await page.mouse.click(action.x, action.y);
      break;
    case 'clickSelector':
      await page.locator(action.selector).click();
      break;
    case 'type':
      if (action.selector) {
        await page.locator(action.selector).fill(action.text);
      } else {
        await page.keyboard.type(action.text);
      }
      break;
    case 'scroll':
      await page.mouse.wheel(
        0,
        action.direction === 'down' ? (action.amount ?? 300) : -(action.amount ?? 300)
      );
      break;
    case 'hover':
      await page.mouse.move(action.x, action.y);
      break;
    case 'wait':
      await page.waitForTimeout(action.ms);
      break;
    case 'navigate':
      await page.goto(action.url, { waitUntil: 'domcontentloaded' });
      break;
    case 'back':
      await page.goBack({ waitUntil: 'domcontentloaded' });
      break;
    case 'pressKey':
      await page.keyboard.press(action.key);
      break;
    default: {
      const exhaustive: never = action;
      throw new Error(`Unknown action type: ${(exhaustive as { type: string }).type}`);
    }
  }
}
