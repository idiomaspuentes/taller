/**
 * Port of the `_read_tsv` half of idiomas-puentes-docs/scripts/fcr_prep/inventory.py.
 * Minimal RFC4180-ish delimited-text reader (tab by default, comma if no tab
 * appears in a sample and a comma does — matching csv.Sniffer's dialect pick
 * for the same two candidates).
 */

function detectDelimiter(sample: string): "\t" | "," {
  if (!sample.includes("\t") && sample.includes(",")) return ",";
  return "\t";
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  function pushField() {
    row.push(field);
    field = "";
  }
  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field.length || row.length) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export type TsvTable = {
  headers: string[];
  rows: Record<string, string>[];
};

/** Read a TSV/CSV file into headers + {header: value} rows, all trimmed. */
export function parseTsvTable(text: string): TsvTable {
  const sample = text.slice(0, 2048);
  const delimiter = detectDelimiter(sample);
  const rows = parseDelimited(text, delimiter);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  const out: Record<string, string>[] = [];
  for (const raw of rows.slice(1)) {
    const record: Record<string, string> = {};
    headers.forEach((header, idx) => {
      record[header] = (raw[idx] ?? "").trim();
    });
    out.push(record);
  }
  return { headers, rows: out };
}

/** Read a TSV/CSV file's text into an array of {header: value} rows, all trimmed. */
export function readTsv(text: string): Record<string, string>[] {
  return parseTsvTable(text).rows;
}

function escapeTsvField(value: string): string {
  if (/[\t\n\r"]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Write a TSV (tab) from headers + rows. */
export function serializeTsv(headers: string[], rows: Record<string, string>[]): string {
  const lines = [
    headers.join("\t"),
    ...rows.map((row) => headers.map((h) => escapeTsvField(row[h] ?? "")).join("\t")),
  ];
  return `${lines.join("\n")}\n`;
}
