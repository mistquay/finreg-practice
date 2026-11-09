async (page) => {
  let pending = IDS_PLACEHOLDER;
  const records = {}, batches = [];
  for (let depth = 0; depth < 8 && pending.length; depth++) {
    const next = new Set();
    for (let offset = 0; offset < pending.length; offset += 30) {
      const ids = pending.slice(offset, offset + 30);
      const response = await page.request.get(
        "https://tiku.fenbi.com/api/xingce/keypoints?ids=" + ids.join(",") +
        "&app=web&kav=131&av=134&hav=128&version=3.0.0.0"
      );
      if (!response.ok()) throw new Error("HTTP " + response.status());
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Unexpected keypoint response");
      batches.push({ ids, response: data });
      for (const item of data) {
        records[item.id] = item;
        if (item.parentId > 0 && !records[item.parentId]) next.add(item.parentId);
      }
      await new Promise(resolve => setTimeout(resolve, 750));
    }
    pending = [...next].filter(id => !records[id]);
  }
  return { records, batches };
}
