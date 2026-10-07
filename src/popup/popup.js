document.getElementById('open-panel-btn')?.addEventListener('click', async () => {
  if (chrome.sidePanel && chrome.sidePanel.open) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.windowId) {
      chrome.sidePanel.open({ windowId: tab.windowId });
      window.close();
    }
  }
});
