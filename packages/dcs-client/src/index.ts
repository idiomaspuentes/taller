export type { DcsClientConfig } from "./config.js";
export { QA_HOST, PRODUCTION_HOST, apiBase, resolvedUserAgent } from "./config.js";

export { DcsApiError } from "./errors.js";
export { encodeBase64, decodeBase64 } from "./base64.js";
export { request } from "./http.js";
export type { RequestOptions } from "./http.js";

export {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  getAuthenticatedUser,
  createUserToken,
  deleteUserToken,
  signInWithPassword,
} from "./auth.js";
export type {
  AuthorizeUrlParams,
  ExchangeCodeParams,
  OAuthTokenResponse,
  DcsUser,
  CreateUserTokenParams,
  DcsToken,
  PasswordSignInParams,
  PasswordSignInResult,
} from "./auth.js";

export { getContents, getRawContent, createOrUpdateContents, createOrUpdateBinaryContents, deleteContents } from "./content.js";
export type {
  ContentsResponse,
  GetContentsParams,
  CreateOrUpdateContentsParams,
  CreateOrUpdateContentsResponse,
  CreateOrUpdateBinaryContentsParams,
  DeleteContentsParams,
} from "./content.js";

export {
  searchCatalog,
  listCatalogLanguages,
  listCatalogSubjects,
  listCatalogOwners,
  getCatalogEntry,
} from "./catalog.js";
export type { CatalogEntry, CatalogSearchParams, CatalogSearchResponse, CatalogLanguage } from "./catalog.js";

export {
  createUserRepo,
  createOrgRepo,
  listOrgRepos,
  getUserOrgs,
  getOrg,
  createOrg,
  listOrgMembers,
  getRepo,
  forkRepo,
  mergeUpstreamRepo,
  setRepoTopics,
  searchReposByTopic,
} from "./repos.js";
export type {
  DcsRepo,
  CreateRepoParams,
  ListOrgReposParams,
  DcsOrg,
  CreateOrgParams,
  DcsOrgMember,
  ForkRepoParams,
  MergeUpstreamParams,
  MergeUpstreamResult,
  SearchReposParams,
} from "./repos.js";

export { listReleases, createRelease } from "./releases.js";
export type { DcsRelease, ListReleasesParams, CreateReleaseParams } from "./releases.js";

export {
  getUserTeams,
  listOrgTeams,
  getTeam,
  createTeam,
  editTeam,
  addTeamRepo,
  removeTeamRepo,
  listTeamRepos,
  listTeamMembers,
  checkTeamMember,
  addTeamMember,
  removeTeamMember,
} from "./teams.js";
export type {
  DcsTeam,
  CreateTeamParams,
  EditTeamParams,
  DcsTeamMember,
  ListOrgTeamsParams,
  ListTeamReposParams,
  ListTeamMembersParams,
} from "./teams.js";

export { listCommits, compareCommits } from "./commits.js";
export type { DcsCommit, ListCommitsParams, CompareResult } from "./commits.js";

export {
  listRepoIssues,
  searchIssues,
  createIssue,
  getIssue,
  editIssue,
  addIssueAssignees,
  removeIssueAssignees,
  listIssueComments,
  createIssueComment,
  addIssueLabels,
  replaceIssueLabels,
} from "./issues.js";
export type {
  DcsIssue,
  DcsIssueUser,
  DcsIssueLabel,
  DcsIssueMilestone,
  DcsIssueComment,
  ListRepoIssuesParams,
  SearchIssuesParams,
  CreateIssueParams,
  EditIssueParams,
} from "./issues.js";

export { listLabels, createLabel, editLabel } from "./labels.js";
export type { ListLabelsParams, CreateLabelParams, EditLabelParams, DcsLabel } from "./labels.js";

export { listMilestones, createMilestone, editMilestone } from "./milestones.js";
export type {
  ListMilestonesParams,
  CreateMilestoneParams,
  EditMilestoneParams,
  DcsMilestone,
} from "./milestones.js";

export { getNewNotificationCount } from "./notifications.js";
export type { NewNotifications } from "./notifications.js";
