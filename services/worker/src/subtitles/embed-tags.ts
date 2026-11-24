import { buildTrackGroup, renderTag } from '../tags/perceptor-tags';
import type { TrackTagFacts } from '../tags/perceptor-tags';

export { sanitizeTagValue } from '../tags/perceptor-tags';

// Spec 123, REQ-9
export function buildTrackTagsXml(facts: Omit<TrackTagFacts, 'trackUid'>): string | null {
  const nodes = buildTrackGroup({ trackUid: 0, ...facts });
  return nodes.length === 0 ? null : renderTag('<Targets/>', nodes);
}
