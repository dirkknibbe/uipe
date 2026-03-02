import type { BoundingBox } from './common.js';

export interface VisualElement {
  id: string;
  label: string;           // "button", "input", "link", "image", "text", "icon", "dropdown"
  confidence: number;      // 0–1 detection confidence
  boundingBox: BoundingBox;
  text?: string;           // visible text (from OCR or detection)
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
