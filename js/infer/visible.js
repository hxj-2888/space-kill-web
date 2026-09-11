/* 可见性过滤（v21 改动清单 #11）：公告/日志 scope 过滤的投递侧唯一实现。
   此前 ui.js（记事本）与 view.js（视图构建）各持一份相同判断，现收敛到这里——
   消费侧一律调用 SKVisible.canSee(viewer, e)，杜绝两处口径漂移。
   scope 语义（对齐 v4.1 公告口径）：
     'alien'     —— 仅异形阵营可见（如 ⑪ 类异形私有通道）
     'non-alien' —— 异形阵营外可见（如 ⑫ 医生清除感染出手）
     其余        —— 全体可见 */
(function (global) {
  function canSee(viewer, e) {
    if (!e) return true;
    if (e.scope === 'alien') return !!viewer && viewer.faction === 'alien';
    if (e.scope === 'non-alien') return !viewer || viewer.faction !== 'alien';
    return true;
  }

  global.SKVisible = { canSee };
})(typeof window !== 'undefined' ? window : globalThis);
