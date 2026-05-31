export type BrowserAction =
  | { type: 'click'; x: number; y: number }
  | { type: 'clickSelector'; selector: string; visible?: boolean }
  | { type: 'type'; text: string; selector?: string }
  | { type: 'scroll'; direction: 'up' | 'down'; amount?: number }
  | { type: 'hover'; x: number; y: number }
  | { type: 'wait'; ms: number }
  | { type: 'navigate'; url: string }
  | { type: 'back' }
  | { type: 'pressKey'; key: string }
  | { type: 'setViewport'; width: number; height: number };
