/**
 * Wraps every non-2xx DCS response. `status` lets a caller follow the
 * table in API_DCS.md §5 (404 -> "no progress yet, use POST"; 409/422 ->
 * "reread, merge, retry"; 429 -> "back off"; etc.) without re-parsing
 * strings.
 */
export class DcsApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "DcsApiError";
  }
}
