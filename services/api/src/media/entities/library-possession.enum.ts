import { registerEnumType } from '@nestjs/graphql';

export enum LibraryPossession {
  ALL = 'ALL',
  DOWNLOADED = 'DOWNLOADED',
  ADDED = 'ADDED',
}

registerEnumType(LibraryPossession, {
  name: 'LibraryPossession',
  valuesMap: {
    ALL: { description: "Every title in the caller's library." },
    DOWNLOADED: { description: 'status COMPLETED (117 REQ-4).' },
    ADDED: { description: 'Any status other than COMPLETED (117 REQ-4).' },
  },
});
