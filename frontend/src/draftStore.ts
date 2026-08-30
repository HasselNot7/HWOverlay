/** 未保存排版草稿的本地暂存（localStorage）。
 * 排版页卸载（切去别的页面）、甚至整个浏览器刷新都不丢；
 * 保存成功或点了「放弃改动」才清掉。 */

const KEY = "hwobs.draft.";

export function loadDraft(page: string): string | null {
  try { return localStorage.getItem(KEY + page); } catch { return null; }
}

export function saveDraft(page: string, layout: unknown) {
  try { localStorage.setItem(KEY + page, JSON.stringify(layout)); } catch { /* 存不下就算了 */ }
}

export function clearDraft(page: string) {
  try { localStorage.removeItem(KEY + page); } catch { /* ignore */ }
}
