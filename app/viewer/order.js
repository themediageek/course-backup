// The order a student moves through the course with Previous and Next:
// module order, skipping text headers and links to outside websites.

export function readingOrder(course) {
  const order = [];
  const seen = new Set();
  for (const m of course.modules) {
    for (const item of m.items) {
      if (item.type === 'header' || item.type === 'link' || !item.ref || seen.has(item.ref)) continue;
      seen.add(item.ref);
      order.push({ ...item, moduleId: m.id, moduleTitle: m.title, moduleUnlockAt: m.unlockAt });
    }
  }
  return order;
}

export function neighbors(course, ref) {
  const order = readingOrder(course);
  const i = order.findIndex((e) => e.ref === ref);
  if (i === -1) return { prev: null, next: null };
  return { prev: order[i - 1] || null, next: order[i + 1] || null };
}

// The first module that holds this item, for the breadcrumb.
export function placement(course, ref) {
  return readingOrder(course).find((e) => e.ref === ref) || null;
}
