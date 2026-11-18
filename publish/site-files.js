// Reads the files that make up this site (listed in site-files.json) so the
// publish page can copy them into a faculty member's repository. A site with
// no list copies nothing.
export async function loadSiteFiles(root, fetchImpl = (...a) => fetch(...a)) {
  const list = await fetchImpl(`${root}site-files.json`, { cache: 'no-cache' });
  if (!list.ok) return [];
  const { files } = await list.json();
  const out = [];
  for (const path of files) {
    const response = await fetchImpl(`${root}${path}`, { cache: 'no-cache' });
    if (!response.ok) throw new Error(`The site file ${path} could not be read (${response.status}).`);
    out.push({ path, data: new Uint8Array(await response.arrayBuffer()) });
  }
  return out;
}
