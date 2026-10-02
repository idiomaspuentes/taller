/**
 * Checks, against the published API description of a Door43 server, that every call Taller makes exists there with the
 * fields it sends. Read-only: it downloads `swagger.v1.json` and compares. Run it before relying on a call that was
 * only tried on the mock:
 *
 *   node scripts/check-door43-api.mjs                        (git.door43.org)
 *   node scripts/check-door43-api.mjs https://qa.door43.org
 */
const HOST = (process.argv[2] || "https://git.door43.org").replace(/\/+$/, "");

// Every endpoint the app calls (packages/dcs-client and src/dcs), as the API names it.
const CALLS = [
  ["GET", "/user"],
  ["GET", "/user/teams"],
  ["GET", "/user/orgs"],
  ["GET", "/user/repos"],
  ["GET", "/orgs/{org}"],
  ["GET", "/orgs/{org}/teams"],
  ["POST", "/orgs/{org}/teams"],
  ["GET", "/orgs/{org}/members"],
  ["GET", "/orgs/{org}/repos"],
  ["GET", "/teams/{id}"],
  ["GET", "/teams/{id}/members"],
  ["PUT", "/teams/{id}/members/{username}"],
  ["DELETE", "/teams/{id}/members/{username}"],
  ["GET", "/teams/{id}/repos"],
  ["PUT", "/teams/{id}/repos/{org}/{repo}"],
  ["GET", "/repos/{owner}/{repo}"],
  ["GET", "/repos/{owner}/{repo}/contents/{filepath}"],
  ["POST", "/repos/{owner}/{repo}/contents/{filepath}"],
  ["PUT", "/repos/{owner}/{repo}/contents/{filepath}"],
  ["DELETE", "/repos/{owner}/{repo}/contents/{filepath}"],
  ["GET", "/repos/{owner}/{repo}/raw/{filepath}"],
  ["GET", "/repos/{owner}/{repo}/branches"],
  ["POST", "/repos/{owner}/{repo}/branches"],
  ["GET", "/repos/{owner}/{repo}/branches/{branch}"],
  ["GET", "/repos/{owner}/{repo}/git/refs/{ref}"],
  ["GET", "/repos/{owner}/{repo}/git/blobs/{sha}"],
  ["GET", "/repos/{owner}/{repo}/commits"],
  ["GET", "/repos/{owner}/{repo}/compare/{basehead}"],
  ["GET", "/repos/{owner}/{repo}/issues"],
  ["POST", "/repos/{owner}/{repo}/issues"],
  ["GET", "/repos/{owner}/{repo}/issues/{index}"],
  ["PATCH", "/repos/{owner}/{repo}/issues/{index}"],
  ["GET", "/repos/{owner}/{repo}/issues/{index}/comments"],
  ["POST", "/repos/{owner}/{repo}/issues/{index}/comments"],
  ["GET", "/repos/{owner}/{repo}/issues/comments"],
  ["POST", "/repos/{owner}/{repo}/issues/{index}/labels"],
  ["DELETE", "/repos/{owner}/{repo}/issues/{index}/labels/{id}"],
  ["GET", "/repos/{owner}/{repo}/labels"],
  ["POST", "/repos/{owner}/{repo}/labels"],
  ["GET", "/repos/{owner}/{repo}/milestones"],
  ["POST", "/repos/{owner}/{repo}/milestones"],
  ["GET", "/repos/{owner}/{repo}/pulls"],
  ["POST", "/repos/{owner}/{repo}/pulls"],
  ["GET", "/repos/{owner}/{repo}/pulls/{index}"],
  ["PATCH", "/repos/{owner}/{repo}/pulls/{index}"],
  ["POST", "/repos/{owner}/{repo}/pulls/{index}/merge"],
  ["GET", "/repos/{owner}/{repo}/pulls/{index}/files"],
  ["GET", "/repos/{owner}/{repo}/pulls/{index}/reviews"],
  ["POST", "/repos/{owner}/{repo}/pulls/{index}/reviews"],
  ["GET", "/repos/{owner}/{repo}/releases"],
  ["POST", "/repos/{owner}/{repo}/releases"],
  ["GET", "/repos/issues/search"],
  ["GET", "/notifications"],
  ["PUT", "/notifications"],
  ["GET", "/notifications/new"],
  ["POST", "/users/{username}/tokens"],
];

// Fields the app sends in a request body, by the API's name for that body.
const BODIES = {
  CreateFileOptions: ["content", "message", "branch", "new_branch"],
  UpdateFileOptions: ["content", "message", "branch", "new_branch", "sha"],
  CreateBranchRepoOption: ["new_branch_name", "old_ref_name"],
  CreateIssueOption: ["title", "body", "labels", "milestone", "assignees"],
  EditIssueOption: ["title", "body", "state", "assignees"],
  CreateIssueCommentOption: ["body"],
  IssueLabelsOption: ["labels"],
  CreateLabelOption: ["name", "color"],
  CreateMilestoneOption: ["title"],
  CreatePullRequestOption: ["head", "base", "title", "body"],
  MergePullRequestOption: ["Do"],
  CreatePullReviewOptions: ["event", "body"],
  CreateReleaseOption: ["tag_name", "target_commitish", "name", "body"],
  CreateTeamOption: ["name", "permission", "units"],
};

const spec = await (await fetch(`${HOST}/swagger.v1.json`)).json();
const paths = spec.paths;
const definitions = spec.definitions ?? {};
const problems = [];
for (const [method, path] of CALLS) {
  if (!paths[path] || !paths[path][method.toLowerCase()]) problems.push(`no existe ${method} ${path}`);
}
for (const [name, fields] of Object.entries(BODIES)) {
  const properties = definitions[name]?.properties;
  if (!properties) {
    problems.push(`no existe el cuerpo ${name}`);
    continue;
  }
  // The server reads field names without regard to case («Do» and «do» are the same field).
  const known = new Set(Object.keys(properties).map((key) => key.toLowerCase()));
  for (const field of fields) if (!known.has(field.toLowerCase())) problems.push(`${name} no tiene el campo «${field}»`);
}

console.log(`${HOST}  ·  API ${spec.info?.version}  ·  ${Object.keys(paths).length} rutas`);
console.log(`${CALLS.length} llamadas y ${Object.values(BODIES).flat().length} campos comprobados`);
if (problems.length) {
  console.log("PROBLEMAS:");
  for (const problem of problems) console.log(" -", problem);
  process.exit(1);
}
console.log("Todo lo que usa la app existe en esta API.");
