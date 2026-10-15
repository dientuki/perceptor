import { registerEnumType } from '@nestjs/graphql';

// Spec 092, REQ-3
export enum GrainMode {
  INHERIT = 'INHERIT',
  ON = 'ON',
  OFF = 'OFF',
}

registerEnumType(GrainMode, {
  name: 'GrainMode',
  description: "A title's own override of the installation's grain-optimization switch.",
});

// Spec 092, REQ-6
export enum EffectiveGrainMode {
  AUTO = 'AUTO',
  ON = 'ON',
  OFF = 'OFF',
}

registerEnumType(EffectiveGrainMode, {
  name: 'EffectiveGrainMode',
  description: 'The value the worker consumes — already resolved, never INHERIT.',
});
