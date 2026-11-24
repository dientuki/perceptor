import { SubtitleProviderKind } from '@prisma/client';

// Spec 123, REQ-14
export type ProvenanceAttempt = {
  providerFileName: string | null;
  provider: SubtitleProviderKind | null;
  providerSubtitleId: string;
};

// Spec 123, REQ-14
export const provenanceOf = (attempt: ProvenanceAttempt): string =>
  attempt.providerFileName ??
  `${(attempt.provider ?? SubtitleProviderKind.OPENSUBTITLES).toLowerCase()}:${attempt.providerSubtitleId}`;
