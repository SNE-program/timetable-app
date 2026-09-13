package app.timetable.mobile.widget;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
 * ## v1.9.11：重画改成**直接调用**，不再靠广播
 *
 * 原来这里是 `sendBroadcast(ACTION_APPWIDGET_UPDATE)`，让系统再把广播转给 provider。
 * 逻辑没错，但"两个小组件都用不了"这个反馈让我意识到它多绕了一层：
 * 广播是**异步**的，而且在国内几家 ROM（省电策略、后台限制）上，
 * 刚被"清理"过的应用发出去的广播可能被推迟甚至丢掉 —— 表现就是桌面一直停在
 * 「打开应用同步一次」，而应用里看一切都正常。
 *
 * 现在改成：拿到每个实例的 id，**直接构造 RemoteViews 交给 AppWidgetManager**（一次 binder 调用，
 * 系统立刻落盘并通知桌面）。少一层转发，少一类只在真机上出现的失败。
 */
public final class WidgetRefresh {

    private static final String PREF = "timetable_widget";
    private static final String KEY_SCHEDULED_AT = "next_refresh_at";

    private WidgetRefresh() { }

    /** 立刻重画两个小组件（直接更新，不发广播） */
    public static void all(Context ctx) {
        WidgetData d = WidgetData.parse(WidgetStore.load(ctx));
        int n = 0;
        n += renderNext(ctx, d);
        n += renderTimetable(ctx, d);
        if (n > 0) WidgetRefresh.scheduleNext(ctx, d);
    }

    /** 桌面上放了几个小组件（两个组件加起来）；界面上的自检要看这个数 */
    public static int instanceCount(Context ctx) {
        return idsOf(ctx, NextClassWidgetProvider.class).length + idsOf(ctx, TimetableWidgetProvider.class).length;
    }

    public static int[] idsOf(Context ctx, Class<?> provider) {
        try {
            AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
            int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, provider));
            return ids == null ? new int[0] : ids;
        } catch (Exception e) {
            return new int[0];
        }
    }

    private static int renderNext(Context ctx, WidgetData d) {
        int done = 0;
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : idsOf(ctx, NextClassWidgetProvider.class)) {
            try {
                mgr.updateAppWidget(id, NextClassWidgetProvider.build(ctx, d, WidgetSize.of(ctx, id, 110, 110)));
                done++;
            } catch (Exception e) {
                try { mgr.updateAppWidget(id, NextClassWidgetProvider.fallback(ctx)); done++; } catch (Exception ignored) { }
            }
        }
        return done;
    }

    private static int renderTimetable(Context ctx, WidgetData d) {
        int done = 0;
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : idsOf(ctx, TimetableWidgetProvider.class)) {
            try {
                mgr.updateAppWidget(id, TimetableWidgetProvider.build(ctx, d, WidgetSize.of(ctx, id, 250, 110)));
                done++;
            } catch (Exception e) {
                try { mgr.updateAppWidget(id, TimetableWidgetProvider.fallback(ctx)); done++; } catch (Exception ignored) { }
            }
        }
        return done;
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
            /*
             * 把"下一次该刷新的时刻"记下来：
             * 界面上那个小组件面板要显示它，用户才能判断"它到底会不会自己翻页"。
             * 原来这个值只存在于闹钟里，界面上看不到，出问题时无从核对。
             */
            try {
                SharedPreferences.Editor e = ctx.getApplicationContext()
                        .getSharedPreferences(PREF, Context.MODE_PRIVATE).edit();
                e.putLong(KEY_SCHEDULED_AT, at);
                e.apply();
            } catch (Exception ignored) { }
        } catch (Exception e) {
            /* 排不上就算了：下次打开应用还会重排 */
        }
    }

    /** 上一次排定的自刷新时刻（0 表示没排过） */
    public static long scheduledAt(Context ctx) {
        try {
            return ctx.getApplicationContext()
                    .getSharedPreferences(PREF, Context.MODE_PRIVATE).getLong(KEY_SCHEDULED_AT, 0L);
        } catch (Exception e) {
            return 0L;
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