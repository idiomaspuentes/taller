import type { DcsClientConfig } from "./config.js";
import { request } from "./http.js";

export interface NewNotifications {
  /** Count of unread notifications. */
  new: number;
}

/** GET /notifications/new — unread notification count for the authenticated user. */
export function getNewNotificationCount(
  config: DcsClientConfig,
  token: string,
): Promise<NewNotifications> {
  return request<NewNotifications>(config, {
    path: "/notifications/new",
    token,
  });
}
