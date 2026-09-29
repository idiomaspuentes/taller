export declare class USFMParser {
  constructor(options?: { silentConsole?: boolean });
  parse(input?: string): this;
  toJSON(): { type: string; version?: string; content: unknown[] };
}
