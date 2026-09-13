package app.timetable.mobile.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import java.util.List;

import app.timetable.mobile.MainActivity;
import app.timetable.mobile.PendingOpen;
import app.timetable.mobile.R;

/**
 * 小的那个小组件：下一节课 + 实时倒计时；**拉高之后**再多列两节。
 *
 * 倒计时用 RemoteViews 里的 Chronometer，它在**桌面进程里自己走**，
 * 不需要我们每分钟去刷新一次 —— 用广播推动的倒计时既费电又会被系统限流，
 * 到时候秒数卡住不动才是最尴尬的。
 *
 * "下一节"是**每次渲染时按当前时间现挑的**（`pickNext`），不是推送时定死的：
 * 于是两次推送之间，桌面自己就能从"距上课"翻到"正在上课"，再翻到下一节。
 * 到点由 {@link WidgetRefresh#scheduleNext} 排的闹钟把这次渲染叫醒。
 *
 * ## v1.9.6：拉大之后不再是一片空白
 *
 * 原来这个组件在桌面上被拉高（比如 2×3）之后，多出来的地方**什么也不显示** ——
 * 布局里根本没有能放课的地方。现在下面补了三行（时间 + 课程名），
 * 由 {@link WidgetSize#extraRows} 按高度决定显示几行：2×2 时是 0 行（保持原来的样子），
 * 拉高之后自动多列出来。点行同样进对应课程详情。
 */
public class NextClassWidgetProvider extends AppWidgetProvider {

    /** 布局里预置的"拉高之后才有"的行数 */
    private static final int EXTRA_ROWS = 2;
    /** 没拿到桌面尺寸时的兜底（与 widget_next_info.xml 里的声明一致） */
    private static final int BASE_W = 110;
    private static final int BASE_H = 110;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        WidgetData d = WidgetData.parse(WidgetStore.load(ctx));
        for (int id : ids) {
            /* 单个实例失败不该连累其余，而且失败时要退回一句人话，不能留一片空白 */
            try {
                mgr.updateAppWidget(id, build(ctx, d, WidgetSize.of(ctx, id, BASE_W, BASE_H)));
            } catch (Exception e) {
                try { mgr.updateAppWidget(id, fallback(ctx)); } catch (Exception ignored) { }
            }
        }
        /* 渲染完把下一次"自己重画"排上 —— 桌面不靠应用在前台也能翻页 */
        WidgetRefresh.scheduleNext(ctx, d);
    }

    /** 桌面上把组件拉大拉小了 —— 高度变了就该多列或少列几节 */
    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle newOptions) {
        try {
            WidgetData d = WidgetData.parse(WidgetStore.load(ctx));
            mgr.updateAppWidget(id, build(ctx, d, WidgetSize.of(ctx, id, BASE_W, BASE_H)));
        } catch (Exception e) {
            try { mgr.updateAppWidget(id, fallback(ctx)); } catch (Exception ignored) { }
        }
    }

    /** 出错时至少显示一句人话 */
    static RemoteViews fallback(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_next);
        v.setTextViewText(R.id.widget_term, "课表助手");
        v.setViewVisibility(R.id.widget_body, View.GONE);
        v.setViewVisibility(R.id.widget_extras, View.GONE);
        v.setViewVisibility(R.id.widget_empty, View.VISIBLE);
        v.setTextViewText(R.id.widget_empty, "打开应用同步一次");
        v.setOnClickPendingIntent(R.id.widget_root, openApp(ctx, 0, ""));
        return v;
    }

    static RemoteViews build(Context ctx, WidgetData d, WidgetSize size) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_next);
        v.setTextViewText(R.id.widget_term, d.term.length() > 0 ? d.term : "课表助手");

        long now = System.currentTimeMillis();
        WidgetData.Item nx = d.pickNext(now);
        if (nx == null) {
            v.setViewVisibility(R.id.widget_body, View.GONE);
            v.setViewVisibility(R.id.widget_empty, View.VISIBLE);
            v.setTextViewText(R.id.widget_empty,
                    WidgetStore.load(ctx) == null ? "打开应用同步一次" : "接下来没有课了");
        } else {
            v.setViewVisibility(R.id.widget_empty, View.GONE);
            v.setViewVisibility(R.id.widget_body, View.VISIBLE);
            v.setTextViewText(R.id.widget_course, nx.title);
            v.setTextViewText(R.id.widget_where, nx.subtitle());

            /* 还没开始就倒计时到上课；已经开始了就倒计时到下课，比显示负数有用 */
            long target = nx.startMs > now ? nx.startMs : nx.endMs;
            v.setChronometerCountDown(R.id.widget_count, true);
            v.setChronometer(R.id.widget_count, WidgetRender.chronometerBase(target), null, true);
        }

        /* 拉高之后补上"接下来两节" —— 2×2 时这里是隐藏的，保持原来的样子 */
        List<WidgetData.Item> rest = d.upcoming;
        int shown = 0;
        int capacity = size.extraRows(EXTRA_ROWS);
        for (int i = 0; i < rest.size() && shown < capacity; i++) {
            WidgetData.Item it = rest.get(i);
            /* 头顶那一节已经单独显示了，列表里跳过它 */
            if (nx != null && it.startMs == nx.startMs && it.title.equals(nx.title)) continue;
            shown++;
            int slot = shown;
            v.setViewVisibility(extraBox(slot), View.VISIBLE);
            v.setTextViewText(extraTime(slot), it.start);
            v.setTextViewText(extraTitle(slot), it.title);
            v.setOnClickPendingIntent(extraBox(slot), openApp(ctx, 30 + slot, it.courseId));
        }
        for (int i = shown + 1; i <= EXTRA_ROWS; i++) {
            v.setViewVisibility(extraBox(i), View.GONE);
        }
        v.setViewVisibility(R.id.widget_extras, shown > 0 ? View.VISIBLE : View.GONE);

        /* 点卡片直接进这节课的详情，而不是只把应用拉到前台（计划书 6.5 节的要求） */
        v.setOnClickPendingIntent(R.id.widget_root, openApp(ctx, 0, nx == null ? "" : nx.courseId));
        return v;
    }

    private static int extraBox(int n) { return n == 1 ? R.id.widget_x1_box : R.id.widget_x2_box; }
    private static int extraTime(int n) { return n == 1 ? R.id.widget_x1_time : R.id.widget_x2_time; }
    private static int extraTitle(int n) { return n == 1 ? R.id.widget_x1_title : R.id.widget_x2_title; }

    private static PendingIntent openApp(Context ctx, int req, String courseId) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (courseId != null && courseId.length() > 0) i.putExtra(PendingOpen.EXTRA_COURSE, courseId);
        return PendingIntent.getActivity(ctx, req, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
