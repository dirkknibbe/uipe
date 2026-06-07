export type ClassificationSource = 'rules' | 'vlm' | 'storybook';

export interface IndexedComponent {
  signature: string;                       // 16 hex chars
  classification: string;                  // e.g. "Button", "ProductCard", "Unknown"
  classificationSource: 'rules' | 'vlm';
  firstSeen: string;                       // ISO timestamp
  lastSeen: string;
  occurrences: number;
  domSample: string;                       // outerHTML truncated to ~500 chars
  source: 'first-traversal' | 'storybook'; // 'storybook' is forward-compat (v2)
}

export interface ComponentIndex {
  version: 1;
  origin: string;
  entries: Record<string, IndexedComponent>;
}

export type ComponentField =
  | { name: string; source: ClassificationSource; signature: string }
  | { name: null; status: 'pending'; signature: string };
