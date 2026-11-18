// Files for the packing page's Preview: read straight from the unencrypted
// export in memory. Nothing is uploaded.

export function createMemorySource(zip, built) {
  const paths = new Map(built.packFiles.map((f) => [f.fileId, f.path]));
  const { files } = built.course;
  return {
    url: () => null,
    async blob(fileId) {
      const entry = files[fileId];
      const path = paths.get(entry.same || fileId);
      const bytes = await zip.bytes(path);
      return new Blob([bytes], { type: entry.mime });
    },
  };
}
