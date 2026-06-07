import type { SceneNode, ActionPrediction, StateTransition } from '../../types/index.js';

export function predictActions(node: SceneNode, history: StateTransition[]): ActionPrediction[] {
  if (node.isDisabled || node.interactionType === 'static') return [];

  switch (node.interactionType) {
    case 'clickable':
      return [inferClickPrediction(node, history)];
    case 'typeable':
      return [{ action: 'typeable', predictedOutcome: 'Updates field value', confidence: 0.9 }];
    case 'scrollable':
      return [{ action: 'scrollable', predictedOutcome: 'Scrolls content within element', confidence: 0.95 }];
    case 'hoverable':
      return [{ action: 'hoverable', predictedOutcome: 'Shows tooltip or hover state', confidence: 0.75 }];
    case 'draggable':
      return [{ action: 'draggable', predictedOutcome: 'Drags element to new position', confidence: 0.8 }];
    default:
      return [];
  }
}

function inferClickPrediction(node: SceneNode, history: StateTransition[]): ActionPrediction {
  const role = node.role.toLowerCase();
  const tag = node.tag.toLowerCase();

  if (tag === 'a' || role === 'link') {
    return { action: 'clickable', predictedOutcome: 'Navigates to linked page', confidence: 0.85 };
  }
  if (role === 'checkbox' || role === 'radio') {
    return { action: 'clickable', predictedOutcome: 'Toggles selection state', confidence: 0.95 };
  }
  if (role === 'tab') {
    return { action: 'clickable', predictedOutcome: 'Switches to tab panel', confidence: 0.9 };
  }
  if (role === 'menuitem') {
    return { action: 'clickable', predictedOutcome: 'Selects menu option', confidence: 0.85 };
  }

  if (role === 'button' || tag === 'button') {
    const hasFormFeedback = history.some(t => t.type === 'form_feedback');
    const hasModalOpen = history.some(t => t.type === 'modal_open');

    if (hasFormFeedback) {
      return { action: 'clickable', predictedOutcome: 'Submits form and shows validation feedback', confidence: 0.7 };
    }
    if (hasModalOpen) {
      return { action: 'clickable', predictedOutcome: 'Triggers modal or dialog', confidence: 0.65, sideEffects: ['modal_open'] };
    }
    return { action: 'clickable', predictedOutcome: 'Triggers action or opens dialog', confidence: 0.6 };
  }

  return { action: 'clickable', predictedOutcome: 'Triggers unknown action', confidence: 0.3 };
}
