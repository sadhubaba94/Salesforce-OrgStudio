export const API_VERSION = "61.0";
export const OAUTH_SCOPES = ["api", "refresh_token", "offline_access", "web"];
export const LOGIN_ENDPOINTS = { production: "https://login.salesforce.com", sandbox: "https://test.salesforce.com" };
export const STORAGE_KEYS = { ORGS: "orgs", ACTIVE_ORG: "activeOrgId", PKCE: "pkce", SETTINGS: "settings", OPEN_TABS: "openTabs", RECENT: "recentFiles", SNAPSHOTS: "snapshots", CLIENT_ID: "connectedAppClientId", GITHUB: "githubConfig", SOQL_HISTORY: "soqlHistory", SOQL_FAVORITES: "soqlFavorites" };
export const GITHUB_API = "https://api.github.com";
export const COMPONENT_TYPES = {
  ApexClass: { label: "Apex Classes", lang: "apex", icon: "class" },
  ApexTrigger: { label: "Apex Triggers", lang: "apex", icon: "trigger" },
  ApexPage: { label: "Visualforce Pages", lang: "html", icon: "vf" },
  ApexComponent: { label: "VF Components", lang: "html", icon: "vf" },
  LightningComponentBundle: { label: "Lightning Web Components", lang: "mixed", icon: "lwc" },
  AuraDefinitionBundle: { label: "Aura Components", lang: "mixed", icon: "aura" },
  StaticResource: { label: "Static Resources", lang: "text", icon: "resource" },
};
export const POLL_INTERVAL_MS = 1200;
export const POLL_TIMEOUT_MS = 120000;
export const TOKEN_REFRESH_SKEW_SEC = 120;
export const PROFILE = { linkedin: "https://www.linkedin.com/in/subhrajyoti-sadhu/", trailblazer: "https://www.salesforce.com/trailblazer/subhrajyoti-sadhu", email: "subhrajyoti.sadhu@zohomail.in" };
export const MSG = { REFRESH_TOKEN: "orgstudio:refreshToken", READ_SESSION: "orgstudio:readSession", CONNECT_ACTIVE: "orgstudio:connectActive", OPEN_IDE: "orgstudio:openIde" };
