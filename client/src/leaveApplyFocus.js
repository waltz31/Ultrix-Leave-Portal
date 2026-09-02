/** Last roster cell HR clicked — used to prefill global A / A.P / P.A apply shortcuts. */

let focus = null;

export function setLeaveApplyFocus(next) {
  focus =
    next && next.userId && next.dayYmd
      ? { userId: String(next.userId), dayYmd: String(next.dayYmd) }
      : null;
}

export function getLeaveApplyFocus() {
  return focus;
}
