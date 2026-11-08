// 标定来源：work/test-runs/stability-calibration/results-seed{202,303,101}.json，2026-11-05。
export const THRESHOLDS = {
  // Source: eh-twitter-style_user.js:705 (30,000 ms) + 2,000 ms drain margin.
  readerWatchdogTimeoutMs: 30_000,
  readerWatchdogDrainMarginMs: 2_000,
  readerWatchdogDrainMs: 30_000 + 2_000,
  // Source: eh-twitter-style_user.js:707–708; two retries [800, 1,800] ms + 500 ms stable margin.
  readerAutoRetryDelaysMs: [800, 1_800],
  readerAutoRetryStableMarginMs: 500,
  // One initial request plus the source retry limit at line 707.
  readerAutoRetryExpectedAttempts: 1 + 2,
  // A 逐片段 series，去掉每遍前2个样本后最小二乘斜率；阈值=2×三次 full 的最大斜率（41.979, -27.779, 55.520），绝对上限=2×最大 Nodes (55,179, 55,388, 64,269)。A 本身按遍间相对差断言，此字段供有界增长指标使用。
  nodes: { maxSlopePerStep: 111.1, maxAbs: 128_538 },
  // A pass 2→3 heap 正增量三次 full 的最大观测为 253,752 / 295,784 / 326,588 B；阈值=2×326,588。
  soakHeapPassDeltaBytes: 653_176,
  // A 逐片段 listener 总量去掉每遍前2个样本后的最大斜率为 0.2585 / -0.2401 / 0.3119；绝对最大值为 480 / 529 / 547。阈值均为2×最大观测。
  listeners: { maxSlopePerStep: 0.624, maxAbs: 1_094 },
  // A observer alive 总量斜率为 0.008694 / -0.005262 / 0.005334，绝对最大值为 10 / 9 / 8；阈值=2×最大观测。
  observers: { maxSlopePerStep: 0.01739, maxAbs: 20 },
  // A intervals 斜率三次均为0、最大值均为1；阈值按2×最大观测。B/H 的存活数精确相等断言仍保持精确。
  intervals: { maxSlopePerStep: 0, maxAbs: 2 },
  // A heap slope 为 6,035 / 1,213 / 7,729 B/step；2×最大值低于20 KiB/step下限，故取20 KiB。绝对最大值为 11,040,332 / 11,146,368 / 11,653,464 B，阈值=2×最大值。
  heapBytes: { maxSlopePerStep: 20 * 1024, maxAbs: 23_306_928 },
  // C fetch/XHR inflight 峰值三次 full 均为5；阈值=2×最大观测。
  inflight: { max: 10 },
  // 正常 A/G reload 场景的 localStorage 三次 full 最大值均为5 keys / 78,666 B；阈值=2×最大观测。不含故障注入专用的1 MiB数据。
  storage: { maxKeys: 10, maxBytes: 157_332 },
  // PROVISIONAL：三份 full 的 stability.json 未记录 D 每轮 reader image DOM 数，不能从备份恢复；历史单次45不用于本次标定。已补 annotation，需未来 full 采样后再标定。
  readerImages: { maxNodes: 90 },
  // PROVISIONAL：三份 full 未记录 J 的 pre-change baseline 与正增长峰值；已补 annotation，需未来 full 采样后再标定。
  viewportCounterGrowth: 10
};
