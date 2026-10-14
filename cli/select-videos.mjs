export function selectApprovedVideos(videos, { ids = '', limit = '' } = {}) {
  let selected = videos.filter((video) => video.approved);
  if (ids) {
    const requested = new Set(ids.split(',').filter(Boolean));
    if (!requested.size) throw new Error('請提供有效的 --ids');
    selected = selected.filter((video) => requested.has(video.id));
    for (const video of selected) requested.delete(video.id);
    if (requested.size) throw new Error(`影片不存在或尚未確認：${[...requested].join(', ')}`);
  }
  if (limit !== '') {
    const count = Number(limit);
    if (!Number.isSafeInteger(count) || count <= 0) throw new Error('--limit 必須是正整數');
    selected = selected.slice(0, count);
  }
  return selected;
}
