import { describe, it, expect } from 'vitest';
import { BrowserRuntime } from '../../src/browser/runtime.js';

describe('Smoke test: full data capture', () => {
  it('captures screenshot + a11y tree + bounding boxes from example.com', async () => {
    const runtime = new BrowserRuntime({ headless: true });
    await runtime.launch();

    try {
      await runtime.navigate('https://example.com');

      const screenshot = await runtime.screenshot();
      expect(screenshot).toBeInstanceOf(Buffer);
      expect(screenshot.length).toBeGreaterThan(1000);

      const a11yTree = await runtime.getAccessibilityTree();
      expect(a11yTree).toContain('heading');

      const boxes = await runtime.getBoundingBoxes();
      expect(boxes.length).toBeGreaterThan(5);

      console.log('✓ Screenshot:', screenshot.length, 'bytes');
      console.log('✓ A11y tree:', a11yTree.split('\n').length, 'lines');
      console.log('✓ Bounding boxes:', boxes.length, 'elements');

    } finally {
      await runtime.close();
    }
  }, 30000);
});
