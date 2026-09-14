// Mirrors the api's environmentInfo query by hand — no codegen. Every
// nullable field here is typed `| null`; see
// docs/spec/features/055-environment-panel/spec.md's GraphQL Contract Delta.

export type EnvironmentEndpoint = {
  id: string;
  port: number | null;
  url: string | null;
};

export type EnvironmentInfo = {
  useTraefik: boolean;
  domain: string | null;
  endpoints: EnvironmentEndpoint[];
  expectedUploadEndpoint: string | null;
};
