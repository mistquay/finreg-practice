// Serialize saves so rapid selection/navigation cannot reorder drafts on the server.
export function sessionSync(id, snapshot, status) {
  let saved = "",
    queue = Promise.resolve(),
    debounce;
  function save(keepalive = false) {
    clearTimeout(debounce);
    const data = snapshot();
    if (!data) return Promise.resolve();
    const body = JSON.stringify(data);
    queue = queue
      .catch(() => {})
      .then(async () => {
        if (body === saved) return;
        status("正在保存…");
        try {
          const response = await fetch(`/api/session/${id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            keepalive,
          });
          if (!response.ok)
            throw new Error("进度暂未同步，草稿已保留在此浏览器，请重试");
          saved = body;
          status("已自动保存");
        } catch (error) {
          status("草稿在此浏览器 · 待同步");
          throw error;
        }
      });
    return queue;
  }
  return {
    save,
    schedule(onError) {
      clearTimeout(debounce);
      debounce = setTimeout(() => save().catch(onError), 1000);
    },
    cancel() {
      clearTimeout(debounce);
    },
  };
}
