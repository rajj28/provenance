import { githubAdapter } from "./github";
import { gitlabAdapter } from "./gitlab";
import { npmAdapter } from "./npm";
import { pypiAdapter } from "./pypi";
import { devtoAdapter } from "./devto";
import { arxivAdapter } from "./arxiv";
import { orcidAdapter } from "./orcid";
import { kaggleAdapter } from "./kaggle";
import type { SourceAdapter, SourceType } from "./types";

const adapters: Record<string, SourceAdapter> = {
  github: githubAdapter,
  gitlab: gitlabAdapter,
  npm: npmAdapter,
  pypi: pypiAdapter,
  devto: devtoAdapter,
  arxiv: arxivAdapter,
  orcid: orcidAdapter,
  kaggle: kaggleAdapter,
};

export function getAdapter(type: SourceType): SourceAdapter {
  const adapter = adapters[type];
  if (!adapter) throw new Error(`No live adapter for ${type}`);
  return adapter;
}
