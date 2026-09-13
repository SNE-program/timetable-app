package app.timetable.mobile.widget;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;

import app.timetable.mobile.MainActivity;
import app.timetable.mobile.PendingOpen;
import app.timetable.mobile.R;

/**
 * 2×2：下一节课 + 实时倒计时。
 *
 * 倒计时用 RemoteViews 里的 Chronometer，它在**桌面进程里自己走**，
 * 不需要我们每分钟去刷新一次 —— 用广播推动的倒计时既费电又会被系统限流，
 * 到时候秒数卡住不动才是最尴尬的。
 *
 * "下一节"是**每次渲染时按当前时间现挑的**（`pickNext`），不是推送时定死的：
 * 于是两次推送之间，桌面自己就能从"距上课"翻到"正在上课"，再翻到下一节。
 * 到点由 {@link WidgetRefresh#scheduleNext} 排的闹钟把这次渲染叫醒。
 */
public class NextClassWidgetProvider extends AppWidgetProvider {

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        WidgetData d = WidgetData.parse(WidgetStore.load(ctx));
        for (int id : ids) {
            /* 单个实例失败不该连累其余，而且失败时要退回一句人话，不能留一片空白 */
            try {
                mgr.updateAppWidget(id, build(ctx, d));
            } catch (Exception e) {
                try { mgr.updateAppWidget(id, fallback(ctx)); } catch (Exception ignored) { }
            }
        }
        /* 渲染完把下一次"自己重画"排上 —— 桌面不靠应用在前台也能翻页 */
        WidgetRefresh.scheduleNext(ctx, d);
    }

    /** 出错时至少显示一句人话 */
    static RemoteViews fallback(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_next);
        v.setTextViewText(R.id.widget_term, "课表助手");
        v.setViewVisibility(R.id.widget_body, View.GONE);
        v.setViewVisibility(R.id.widget_empty, View.VISIBLE);
        v.setTextViewText(R.id.widget_empty, "打开应用同步一次");
        v.setOnClickPendingIntent(R.id.widget_root, openApp(ctx, 0, ""));
        return v;
    }

    static RemoteViews build(Context ctx, WidgetData d) {
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

        /* 点卡片直接进这节课的详情，而不是只把应用拉到前台（计划书 6.5 节的要求） */
        v.setOnClickPendingIntent(R.id.widget_root, openApp(ctx, 0, nx == null ? "" : nx.courseId));
        return v;
    }

    private static PendingIntent openApp(Context ctx, int req, String courseId) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (courseId != null && courseId.length() > 0) i.putExtra(PendingOpen.EXTRA_COURSE, courseId);
        return PendingIntent.getActivity(ctx, req, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
