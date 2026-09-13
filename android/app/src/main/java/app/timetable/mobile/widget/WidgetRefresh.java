package app.timetable.mobile.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import java.util.Calendar;
import java.util.List;

/**
 * 小组件的"刷新"这件事，两处都要用，所以集中放这里：
 *
 *   1. **应用推送数据之后** —— 立刻重画（{@link #all}）；
 *   2. **到点自己重画** —— 小组件活在桌面进程里，应用不会正好在下课那一刻被打开，
 *      所以必须自己定闹钟（{@link #scheduleNext}）。
 *
 * 第 2 条是 v1.9.2 补上的：在这之前，上午上完一节之后桌面会**一直显示着那一节**，
 * 直到用户再打开一次应用。这不是"数据错了"，而是"没人叫它重画"。
 */
public final class WidgetRefresh {

    private WidgetRefresh() { }

    /** 立刻重画两个小组件 */
    public static void all(Context ctx) {
        ping(ctx, TimetableWidgetProvider.class);
        ping(ctx, NextClassWidgetProvider.class);
    }

    private static void ping(Context ctx, Class<?> provider) {
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, provider));
            if (ids == null || ids.length == 0) return;
            Intent intent = new Intent(ctx, provider);
            intent.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
            intent.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
            ctx.sendBroadcast(intent);
        } catch (Exception e) {
            /* 刷新失败不该影响主流程 —— 小组件只是锦上添花 */
        }
    }

    /**
     * 把下一次"自己重画"排上：定在**最近的边界**上。
     *
     * 边界 = 下一节的开始 / 当前这节的结束 / 今天零点（跨天要让"今天剩下的课"归位）。
     * 到点由 {@link WidgetRefreshReceiver} 收到，重新渲染一次并把下一边界再排上 ——
     * 于是一整天的翻页都不需要应用在前台。
     */
    public static void scheduleNext(Context ctx, WidgetData d) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            long at = nextBoundary(d, System.currentTimeMillis());
            Intent i = new Intent(ctx, WidgetRefreshReceiver.class);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 0, i,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            boolean exact = true;
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms()) exact = false;
            } catch (Exception e) {
                exact = false;
            }
            try {
                if (exact) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
                else am.set(AlarmManager.RTC_WAKEUP, at, pi);
            } catch (Exception e) {
                /* 精确闹钟没被允许时退回不精确的 —— 晚几分钟也比不刷新好 */
                am.set(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (Exception e) {
            /* 排不上就算了：下次打开应用还会重排 */
        }
    }

    /** 最近的边界时刻（毫秒） */
    static long nextBoundary(WidgetData d, long now) {
        long next = Long.MAX_VALUE;
        WidgetData.Item nx = d.pickNext(now);
        if (nx != null) {
            if (nx.startMs > now) next = Math.min(next, nx.startMs);
            if (nx.endMs > now) next = Math.min(next, nx.endMs);
        }
        List<WidgetData.Item> rows = d.todayRemaining(now);
        for (WidgetData.Item it : rows) {
            if (it.startMs > now) next = Math.min(next, it.startMs);
            if (it.endMs > now) next = Math.min(next, it.endMs);
        }
        /* 跨天：零点之后"今天剩下的课"要换成新的一天 */
        Calendar c = Calendar.getInstance();
        c.set(Calendar.HOUR_OF_DAY, 0);
        c.set(Calendar.MINUTE, 0);
        c.set(Calendar.SECOND, 0);
        c.set(Calendar.MILLISECOND, 0);
        next = Math.min(next, c.getTimeInMillis() + 86400000L);

        /* 兜底：没有任何课也要隔一阵看一次（最多 6 小时），别让闹钟排到几周以后 */
        long cap = now + 6 * 3600 * 1000L;
        if (next == Long.MAX_VALUE || next <= now + 1000L) next = now + 30 * 60 * 1000L;
        return Math.min(next, cap);
    }
}
