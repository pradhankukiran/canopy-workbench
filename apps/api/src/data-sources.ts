import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Mirror of the Scala `canopy.data.registry.DataArtifact.defaultArtifacts`
 * so the API can report cache status without shelling out to the JVM.
 * Keep the lists in sync manually; tests cover the shape.
 */
export interface DataArtifact {
  id: string;
  kind: string;
  description: string;
  url: string;
  sha256: string; // empty string = accept any bytes (bootstrap mode)
  localFileName: string;
  approximateMb: number;
  license: string;
}

export const DEFAULT_ARTIFACTS: DataArtifact[] = [
  {
    id: "natural-earth-10m-land",
    kind: "coastline",
    description: "Natural Earth 1:10m physical land polygons (coastline)",
    url: "https://naciscdn.org/naturalearth/10m/physical/ne_10m_land.zip",
    sha256: "",
    localFileName: "ne_10m_land.zip",
    approximateMb: 2,
    license: "public-domain (Natural Earth)"
  },
  {
    id: "slosh-meow-gulf",
    kind: "surge",
    description: "NOAA SLOSH MEOW surge envelope, Gulf basin",
    url: "https://www.nhc.noaa.gov/nationalsurge/data/slosh_meow_gulf.zip",
    sha256: "",
    localFileName: "slosh_meow_gulf.zip",
    approximateMb: 20,
    license: "public-domain (NOAA)"
  },
  {
    id: "etopo-2022-60s",
    kind: "bathymetry",
    description: "ETOPO 2022 global 60-arc-second ice-surface elevation",
    url: "https://www.ngdc.noaa.gov/thredds/fileServer/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc",
    sha256: "",
    localFileName: "etopo_2022_60s.nc",
    approximateMb: 90,
    license: "public-domain (NOAA NCEI)"
  }
];

export function resolveCacheDir(): string {
  const envDir = process.env.CANOPY_DATA_CACHE_DIR?.trim();
  if (envDir) return envDir;
  const home = process.env.HOME || ".";
  return path.join(home, ".canopy-workbench", "data");
}

export type ArtifactState = "ready" | "missing" | "unavailable";

export interface ArtifactStatus {
  id: string;
  kind: string;
  state: ArtifactState;
  description: string;
  url: string;
  license: string;
  approximateMb: number;
  path?: string;
  sizeBytes?: number;
  sha256?: string;
  reason?: string;
}

export interface DataSourcesSummary {
  cacheDir: string;
  artifacts: ArtifactStatus[];
}

async function sha256Of(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) hash.update(chunk as Buffer);
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function statusOf(
  artifact: DataArtifact,
  cacheDir: string
): Promise<ArtifactStatus> {
  const filePath = path.join(cacheDir, artifact.localFileName);
  try {
    const stat = await fs.stat(filePath);
    const digest = await sha256Of(filePath);
    if (!artifact.sha256 || artifact.sha256.toLowerCase() === digest.toLowerCase()) {
      return {
        id: artifact.id,
        kind: artifact.kind,
        state: "ready",
        description: artifact.description,
        url: artifact.url,
        license: artifact.license,
        approximateMb: artifact.approximateMb,
        path: filePath,
        sizeBytes: stat.size,
        sha256: digest
      };
    }
    return {
      id: artifact.id,
      kind: artifact.kind,
      state: "unavailable",
      description: artifact.description,
      url: artifact.url,
      license: artifact.license,
      approximateMb: artifact.approximateMb,
      reason: `sha256 mismatch: expected ${artifact.sha256} got ${digest}`
    };
  } catch {
    return {
      id: artifact.id,
      kind: artifact.kind,
      state: "missing",
      description: artifact.description,
      url: artifact.url,
      license: artifact.license,
      approximateMb: artifact.approximateMb
    };
  }
}

export async function summarizeDataSources(
  artifacts: DataArtifact[] = DEFAULT_ARTIFACTS,
  cacheDir: string = resolveCacheDir()
): Promise<DataSourcesSummary> {
  const statuses = await Promise.all(artifacts.map((a) => statusOf(a, cacheDir)));
  return { cacheDir, artifacts: statuses };
}
