import React from 'react';

/**
 * 分钟对齐的时钟。
 *
 * 课表界面只精确到分钟 ——「还有 12 分钟下课」、上课进度条、「现在」那条横线，
 * 全都是分钟级的。之前 TodayView 用 `setInterval(..., 1000)` 每秒 setState 一次，
 * 每渲染一次就把 expandDay / conflictsOf / freeSlots / resolvePalette
 * 全部重算一遍 —— 一天开着这一页就是八万多次无谓的整树重建。
 *
 * 这里改成**对齐到下一个整分**：分钟一变立刻刷新，中间一秒都不浪费。
 * 既准确（不会出现"分钟已经跳了但界面还没动"），又只有 1/60 的开销。
 */
export function useMinuteClock(): Date {
  const [now, setNow] = React.useState<Date>(function () { return new Date(); });

  React.useEffect(function () {
    let id = 0;
    let alive = true;

    function msToNextMinute(): number {
      const d = new Date();
      /* 多留 50ms，避开定时器精度导致的"还差几毫秒没跳分" */
      return 60000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 50;
    }
    function tick(): void {
      if (!alive) return;
      setNow(new Date());
      id = window.setTimeout(tick, msToNextMinute());
    }

    id = window.setTimeout(tick, msToNextMinute());
    return function () { alive = false; window.clearTimeout(id); };
  }, []);

  return now;
}

/** 同一时刻只算一次的对象索引，供 `data.courses.find(...)` 这类循环查找用 */
export function useCourseMap<T extends { id: string }>(courses: T[]): Map<string, T> {
  return React.useMemo(function () {
    const m = new Map<string, T>();
    for (const c of courses) m.set(c.id, c);
    return m;
  }, [courses]);
}
