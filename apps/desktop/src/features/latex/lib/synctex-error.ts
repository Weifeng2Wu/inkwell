export function isMissingSynctexData(error: unknown): boolean {
  return /SYNCTEX_DATA_MISSING|No SyncTeX available|No synctex file|synctex file not found/i.test(
    String(error),
  );
}
