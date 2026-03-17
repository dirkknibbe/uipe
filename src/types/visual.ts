import type { BoundingBox } from './common.js';

export interface VisualElement {
  id: string;
  label: string;           // "button", "input", "link", "image", "text", "icon", "dropdown"
  confidence: number;      // 0–1 detection confidence
  boundingBox: BoundingBox;
  text?: string;           // visible text (from OCR or detection)
  isInteractable?: boolean;  // from OmniParser V2 interactability prediction
  description?: string;      // from Florence-2 caption or visual model description
  visualProperties: {
    dominantColor?: string;
    hasIcon?: boolean;
    isHighlighted?: boolean;
    estimatedFontSize?: string;
  };
}

export interface TextRegion {
  text: string;
  boundingBox: BoundingBox;
  confidence: number;
}

export type AnalysisDepth = 'detect' | 'understand' | 'deep';

export interface VisualUnderstanding {
  visualHierarchy: { primaryFocus: string; readingFlow: string[] };
  contrastIssues: Array<{ element: string; issue: string; estimatedRatio?: string }>;
  spacingIssues: Array<{ area: string; issue: string }>;
  affordanceIssues: Array<{ element: string; issue: string }>;
  stateIndicators: Array<{ type: string; element: string; description: string }>;
  overallAssessment: string;
}

export interface VisualAnalysis {
  elements: VisualElement[];
  analysis: VisualUnderstanding | null;
  deepAnalysis: string | null;
}
