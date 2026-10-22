import { registerEnumType } from '@nestjs/graphql';

// Spec 093, REQ-6
export enum MovieReleaseType {
  THEATRICAL = 'THEATRICAL',
  DIGITAL = 'DIGITAL',
  PHYSICAL = 'PHYSICAL',
}

registerEnumType(MovieReleaseType, { name: 'MovieReleaseType' });
