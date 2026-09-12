package app.timetable.mobile.widget;

import android.os.SystemClock;

/** 小组件渲染里两个容易踩坑的地方，集中放这里。 */
public final class WidgetRender {

    private WidgetRender() { }

    /**
     * Chronometer 的时基换算。
     *
     * `RemoteViews.setChronometer(viewId, base, ...)` 里的 base 用的是
     * **SystemClock.elapsedRealtime()**（开机以来的毫秒），不是墙上时钟的 epoch 毫秒。
     * 直接把 epoch 塞进去，Chronometer 会算 `base - elapsedRealtime()`，
     * 而开机时长相对 epoch 可以忽略 —— 结果就是倒计时显示成
     * 「496963:41:52」这种几十万小时的天文数字（1.789e12 毫秒 ≈ 496963 小时，
     * 正好等于当时的 epoch）。
     *
     * 所以要把「目标墙钟时刻」先换算成「从现在起还有多久」，再叠加到 elapsedRealtime 上。
     *
     * @param targetEpochMs 目标时刻（System.currentTimeMillis() 口径）
     * @return 可直接交给 setChronometer 的 base
     */
    public static long chronometerBase(long targetEpochMs) {
        long delta = targetEpochMs - System.currentTimeMillis();
        /* 已经到点了就别显示负数或 0 —— 给 1 秒，让它停在一个合理的读数上 */
        if (delta < 1000L) delta = 1000L;
        return SystemClock.elapsedRealtime() + delta;
    }
}
