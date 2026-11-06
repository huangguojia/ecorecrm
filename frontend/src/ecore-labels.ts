/**
 * ECORE 界面词表。
 *
 * 精简版把「商机」这一模块从界面上整体拿掉了（数据表与后端路由仍在）。
 * 但权限目录、历史活动记录、导入模板等地方还带着旧词，直接展示会让用户
 * 看到一个没有入口的概念。这里只做**显示层**改写：数据库里的名称、权限码
 * 与授权关系一律不动，避免保存角色或成员授权时误伤已有数据。
 */
const LEGACY_DISPLAY_TERMS: Array<[string, string]> = [["商机", "成交"]];

export function ecoreDisplayName(text: string): string {
  return LEGACY_DISPLAY_TERMS.reduce((acc, [from, to]) => acc.split(from).join(to), text);
}
