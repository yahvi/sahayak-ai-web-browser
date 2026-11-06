import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Sahayak",
  description:
    "A user-controlled Chrome side-panel agent that reads the page and acts only after you approve.",
  version: "0.1.0",
  icons: {
    "16": "assets/icons/icon16.png",
    "48": "assets/icons/icon48.png",
    "128": "assets/icons/icon128.png",
  },
  action: {
    default_title: "Open Sahayak",
    default_icon: {
      "16": "assets/icons/icon16.png",
      "48": "assets/icons/icon48.png",
      "128": "assets/icons/icon128.png",
    },
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
    },
  ],
  permissions: [
    "sidePanel",
    "storage",
    "activeTab",
    "scripting",
    "contextMenus",
    "tabs",
  ],
  host_permissions: [
    "http://localhost/*",
    "http://127.0.0.1/*",
    "http://*/*",
    "https://*/*",
  ],
});
