/**
 * One subtask per chapter for a task of a project that was cut by passage (see `src/domain/regroupByChapter.ts`). By
 * default it only says what it would do; with `--write` it writes to that Door43, which on production needs the OK of
 * whoever manages. Run again, it goes on where it stopped.
 *
 *   npm run regroup-by-chapter -- EZR desafios-tps                 what it would do
 *   DCS_TOKEN=… npm run regroup-by-chapter -- EZR desafios-tps --write
 *
 * Options: --host (https://git.door43.org), --org (es-419_gl), --lang (es-419), --content-org (the org, by default),
 * --user (the login the token is of; only said in the messages).
 */
import { regroupTaskByChapter } from "../src/dcs/issues";
import type { GtSession } from "../src/dcs/auth";

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1]! : fallback;
};
const valued = new Set(["--host", "--org", "--lang", "--content-org", "--user"]);
const [projectId, taskId] = args.filter((arg, i) => !arg.startsWith("--") && !valued.has(args[i - 1] ?? ""));
if (!projectId || !taskId) throw new Error("Uso: regroup-by-chapter <PROYECTO> <tarea> [--write]");
const write = args.includes("--write");
const token = process.env.DCS_TOKEN ?? "";
if (write && !token) throw new Error("--write necesita DCS_TOKEN: escribe en las subtareas de ese Door43");

const org = option("org", "es-419_gl");
const session = { host: option("host", "https://git.door43.org"), username: option("user", "taller"), token } as GtSession;
const summary = await regroupTaskByChapter({
  session,
  org,
  lang: option("lang", "es-419"),
  contentOrg: option("content-org", org),
  projectId: projectId.toUpperCase(),
  taskId,
  dry: !write,
  say: (line) => console.log(line),
});
for (const [label, rows] of Object.entries({ "Se abren": summary.opened, "Se cierran como terminadas": summary.finished, "Ya estaban": summary.already, "Porciones que se juntan": summary.gathered })) {
  if (rows.length) console.log(`\n${label} (${rows.length}):\n${rows.map((row) => `  ${row}`).join("\n")}`);
}
if (!write) console.log("\nNo se escribió nada. Con --write (y DCS_TOKEN) se hace.");
