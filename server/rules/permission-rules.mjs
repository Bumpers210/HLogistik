export const USER_GROUPS = Object.freeze(["lager", "buero", "tablet", "verwaltung"]);

export const ROLE_PERMISSIONS = Object.freeze({
  storageMutation: Object.freeze(["buero", "tablet", "verwaltung"]),
  articleMutation: Object.freeze(["buero", "verwaltung"]),
  tabletMutation: Object.freeze(["tablet"]),
  orderDelete: Object.freeze(["buero", "lager", "tablet", "verwaltung"]),
});

export function normalizeUserGroup(value) {
  const group = String(value || "").trim().toLowerCase();
  return USER_GROUPS.includes(group) ? group : "";
}

export function hasGroupPermission(group, allowedGroups) {
  return allowedGroups.includes(normalizeUserGroup(group));
}

