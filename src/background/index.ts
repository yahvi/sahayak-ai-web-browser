import { startContextMenus } from "./context-menus";
import { startMessaging } from "./messaging";
import { startTabTracking } from "./tab-tracker";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

startTabTracking();
startMessaging();
startContextMenus();
