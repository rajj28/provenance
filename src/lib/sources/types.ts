export type SourceType =
  | "github"
  | "gitlab"
  | "npm"
  | "pypi"
  | "devto"
  | "hashnode"
  | "arxiv"
  | "orcid"
  | "kaggle"
  | "manual";

export type EvidenceKind =
  | "role"
  | "project"
  | "contribution"
  | "article"
  | "package"
  | "publication"
  | "certification"
  | "achievement";

export type ConnectionCredentials = Record<string, string>;

export type DiscoveredItem = {
  sourceType: SourceType;
  kind: EvidenceKind;
  externalId: string;
  url?: string;
  title: string;
  summary?: string;
  occurredAt?: Date;
  payload: Record<string, unknown>;
};

export type FetchContext = {
  credentials: ConnectionCredentials;
  displayName?: string;
};

export type SourceAdapter = {
  type: SourceType;
  fetch(ctx: FetchContext): Promise<DiscoveredItem[]>;
  identity?(ctx: FetchContext): Promise<{
    externalUserId: string;
    displayName: string;
    profileUrl?: string;
  }>;
};

export type SourceCatalogEntry = {
  type: SourceType | "linkedin" | "devpost" | "notion" | "gdrive" | "youtube";
  /**
   * Publishing-only integrations (LinkedIn) are not `live` as a discovery
   * source but still have a real OAuth connect flow. `publish` marks that so
   * the Sources page can render a connect button without implying the platform
   * can be read from.
   */
  publish?: boolean;
  name: string;
  blurb: string;
  live: boolean;
  auth: "oauth" | "token" | "public-id" | "manual";
  fields: { key: string; label: string; secret?: boolean; optional?: boolean; placeholder?: string }[];
  apiNotes: string;
};

export function fingerprintOf(item: Pick<DiscoveredItem, "sourceType" | "kind" | "externalId">) {
  return `${item.sourceType}:${item.kind}:${item.externalId}`.toLowerCase();
}
