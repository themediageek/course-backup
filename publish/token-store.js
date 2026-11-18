// Where the publish page keeps the faculty member's GitHub token and the name
// of the repository it connects to: for the browser session by default, or on
// the computer when they tick "Remember on this computer". Blocked storage
// never breaks the page.
const KEY = 'cbs-github-token';
const REPO = 'cbs-github-repo';

export function createTokenStore({ session, local }) {
  const get = (store, key) => { try { return store.getItem(key); } catch { return null; } };
  const set = (store, key, value) => { try { store.setItem(key, value); } catch { /* blocked */ } };
  const drop = (store, key) => { try { store.removeItem(key); } catch { /* blocked */ } };
  return {
    save(token, remember, repo = null) {
      for (const key of [KEY, REPO]) drop(remember ? session : local, key);
      const keep = remember ? local : session;
      set(keep, KEY, token);
      if (repo) set(keep, REPO, repo); else drop(keep, REPO);
    },
    load() {
      return get(local, KEY) || get(session, KEY) || null;
    },
    // The repository saved with the key in use, or null.
    repo() {
      const store = get(local, KEY) ? local : session;
      return get(store, REPO) || null;
    },
    remembered() {
      return Boolean(get(local, KEY));
    },
    clear() {
      for (const key of [KEY, REPO]) {
        drop(local, key);
        drop(session, key);
      }
    },
  };
}
