import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Spec 002, REQ-4
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
