export const MIN_PI_COACH_NODE_VERSION = "22.19.0";

export interface ParsedNodeVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseNodeVersion(version: string): ParsedNodeVersion {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);

  if (!match) {
    throw new Error(`Invalid Node version "${version}"`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

export function isNodeVersionAtLeast(version: string, minimumVersion: string): boolean {
  const current = parseNodeVersion(version);
  const minimum = parseNodeVersion(minimumVersion);

  if (current.major !== minimum.major) {
    return current.major > minimum.major;
  }

  if (current.minor !== minimum.minor) {
    return current.minor > minimum.minor;
  }

  return current.patch >= minimum.patch;
}

export function assertNodeSupportsPiCoach(nodeVersion: string = process.versions.node): void {
  if (!isNodeVersionAtLeast(nodeVersion, MIN_PI_COACH_NODE_VERSION)) {
    throw new Error(
      `firstrung-coach requires Node >=${MIN_PI_COACH_NODE_VERSION}; current Node is ${nodeVersion}.`
    );
  }
}
