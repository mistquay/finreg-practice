async (page) => {
  const ids = IDS_PLACEHOLDER;
  const result = { metadata: [], keypoints: {}, batches: [] };
  for (let offset = 0; offset < ids.length; offset += 30) {
    const batch = ids.slice(offset, offset + 30);
    for (const path of ["question/meta", "solution/keypoints"]) {
      const response = await page.request.get(
        "https://tiku.fenbi.com/api/xingce/" + path + "?ids=" + batch.join(",") +
        "&app=web&kav=131&av=134&hav=128&version=3.0.0.0"
      );
      if (!response.ok()) throw new Error("HTTP " + response.status());
      const data = await response.json();
      if (!Array.isArray(data) || data.length !== batch.length) {
        throw new Error("Response count mismatch; refusing a positional join");
      }
      result.batches.push({ path, ids: batch, response: data });
      if (path === "question/meta") result.metadata.push(...data);
      else batch.forEach((id, index) => result.keypoints[id] = data[index]);
      await new Promise(resolve => setTimeout(resolve, 750));
    }
  }
  return result;
}
