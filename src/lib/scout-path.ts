export function isScoutPath(path: string) {
  return /^(?:\/entry)?\/(?:api\/)?scout(?:\/|$)/.test(path);
}
