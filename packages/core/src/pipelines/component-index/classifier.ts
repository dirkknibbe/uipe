import type { StructuralNode } from '../../types/index.js';

/**
 * Tier-1 (synchronous, free) classifier. Returns a PascalCase classification
 * string or null. Null signals "no rule matched — escalate to VLM."
 *
 * Rules are evaluated in declaration order; first match wins.
 */
export function classifyByRules(node: StructuralNode): string | null {
  if (node.tag === 'button' || node.role === 'button') return 'Button';
  if (node.tag === 'a' && typeof node.attributes['href'] === 'string') return 'Link';
  if (node.tag === 'input') {
    // <input> defaults to type=text per HTML spec.
    const type = node.attributes['type'] ?? 'text';
    if (type === 'text') return 'TextInput';
    if (type === 'password') return 'PasswordInput';
    if (type === 'checkbox') return 'Checkbox';
    if (type === 'radio') return 'RadioButton';
    // Other input types (email, number, date, ...) fall through to VLM.
    return null;
  }
  if (node.tag === 'textarea') return 'TextArea';
  if (node.tag === 'select') return 'Select';
  if (node.tag === 'form') return 'Form';
  if (node.tag === 'dialog' || node.role === 'dialog') return 'Modal';
  if (node.tag === 'nav' || node.role === 'navigation') return 'Nav';
  if (node.tag === 'article' || node.role === 'article') return 'Card';
  if (node.tag === 'header') return 'Header';
  if (node.tag === 'footer') return 'Footer';
  if (node.tag === 'main') return 'Main';
  if (node.tag === 'section') return 'Section';
  return null;
}
