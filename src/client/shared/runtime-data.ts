let appData = null;
let appDataRequest = null;
const liveSnapshots = new Map();
const liveRequests = new Map();

export function cachedAppData() {
  return appData;
}

export function loadAppData({ force = false } = {}) {
  if (!force && appData) return Promise.resolve(appData);
  if (appDataRequest) return appDataRequest;

  appDataRequest = fetch('/api/data')
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(data => {
      appData = data;
      return data;
    })
    .finally(() => {
      appDataRequest = null;
    });
  return appDataRequest;
}

export function cachedLiveSnapshot(windowMinutes) {
  return liveSnapshots.get(windowMinutes) || null;
}

export function loadLiveSnapshot(windowMinutes, { force = false } = {}) {
  if (!force && liveSnapshots.has(windowMinutes)) {
    return Promise.resolve(liveSnapshots.get(windowMinutes));
  }
  if (liveRequests.has(windowMinutes)) return liveRequests.get(windowMinutes);

  const request = fetch(`/api/live?windowMinutes=${encodeURIComponent(windowMinutes)}`)
    .then(response => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then(snapshot => {
      liveSnapshots.set(windowMinutes, snapshot);
      return snapshot;
    })
    .finally(() => {
      liveRequests.delete(windowMinutes);
    });
  liveRequests.set(windowMinutes, request);
  return request;
}

export function prepareRoute(pathname) {
  return pathname === '/live'
    ? loadLiveSnapshot(1440, { force: true })
    : loadAppData({ force: true });
}
