export const JIANYING_DIALOG_OPEN_EVENT = "jianying:dialog:open";

export function openJianyingDialog() {
  window.dispatchEvent(new Event(JIANYING_DIALOG_OPEN_EVENT));
}
