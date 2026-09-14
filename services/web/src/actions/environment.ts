'use server'

import { redirectToClearSession } from '@/lib/auth-session';
import { fetchGraphQL } from '@/lib/graphql-client';
import { translateGraphQLError } from '@/lib/graphql-error';
import { EnvironmentInfo } from '@/types/environment';

const ENVIRONMENT_INFO_QUERY = `
  query EnvironmentInfo {
    environmentInfo {
      useTraefik
      domain
      endpoints {
        id
        port
        url
      }
      expectedUploadEndpoint
    }
  }
`;

export async function getEnvironmentInfo(): Promise<EnvironmentInfo> {
  const { data, errors } = await fetchGraphQL<{ environmentInfo: EnvironmentInfo }>(
    ENVIRONMENT_INFO_QUERY,
  );

  if (errors && errors.length > 0) {
    // Called directly from SettingsPage's Server Component render — cookie
    // mutation is illegal there, so hand off to the Route Handler instead.
    redirectToClearSession(errors);
    throw new Error(await translateGraphQLError(errors[0]));
  }

  return (
    data?.environmentInfo ?? {
      useTraefik: false,
      domain: null,
      endpoints: [],
      expectedUploadEndpoint: null,
    }
  );
}
