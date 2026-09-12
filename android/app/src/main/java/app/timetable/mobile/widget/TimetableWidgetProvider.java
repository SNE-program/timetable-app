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
 * 4×2：下一节课倒计时 + 今天剩下的课。
 *
 * 「今天剩下的课」是 Web 层算好传过来的 —— 这里只负责摆位置。
 * 之所以不在原生侧算，是因为"今天还剩哪些课"要经过作息方案、调课、停课、
 * 单双周一整套逻辑，在原生里再实现一遍必然会和主应用对不上。
 *
 * 三行课程是**布局里写死的**，这里只切可见性和文字，不用 RemoteViews.addView ——
 * 那个 API 在部分桌面实现上会抛异常，一旦抛出整次 onUpdate 就废掉，
 * 小组件会停在 initialLayout 上什么都不显示。
 */
public class TimetableWidgetProvider extends AppWidgetProvider {

    /** 布局里预置的行数，改布局时这里要跟着改 */
    private static final int ROWS = 3;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        WidgetData d = WidgetData.parse(WidgetStore.load(ctx));
        for (int id : ids) {
            try {
                mgr.updateAppWidget(id, build(ctx, d));
            } catch (Exception e) {
                try { mgr.updateAppWidget(id, fallback(ctx)); } catch (Exception ignored) { }
            }
        }
    }

    static RemoteViews fallback(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_timetable);
        v.setTextViewText(R.id.widget_term, "课表助手");
        v.setTextViewText(R.id.widget_hint, "打开应用同步一次");
        for (int i = 1; i <= ROWS; i++) v.setViewVisibility(rowBox(i), View.GONE);
        v.setOnClickPendingIntent(R.id.widget_root, openApp(ctx, 1, ""));
        return v;
    }

    static RemoteViews build(Context ctx, WidgetData d) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_timetable);
        v.setTextViewText(R.id.widget_term, d.term.length() > 0 ? d.term : "课表助手");
        v.setOnClickPendingIntent(R.id.widget_root, openApp(ctx, 1, ""));

        boolean hasNext = d.next != null;
        v.setViewVisibility(R.id.widget_next_row, hasNext ? View.VISIBLE : View.GONE);
        if (hasNext) {
            v.setTextViewText(R.id.widget_next_title, d.next.title);
            v.setTextViewText(R.id.widget_next_where, d.next.subtitle());
            long now = System.currentTimeMillis();
            long target = d.next.startMs > now ? d.next.startMs : d.next.endMs;
            v.setChronometerCountDown(R.id.widget_next_count, true);
            v.setChronometer(R.id.widget_next_count, WidgetRender.chronometerBase(target), null, true);
            /* 点"下一节课"那一行 → 直接进这门课的详情 */
            v.setOnClickPendingIntent(R.id.widget_next_row, openApp(ctx, 10, d.next.courseId));
        }

        /* 今天剩下的课：有几行显示几行，多余的藏起来 */
        int n = Math.min(d.today.size(), ROWS);
        for (int i = 0; i < ROWS; i++) {
            if (i < n) {
                WidgetData.Item it = d.today.get(i);
                v.setViewVisibility(rowBox(i + 1), View.VISIBLE);
                v.setTextViewText(rowTime(i + 1), it.start);
                v.setTextViewText(rowTitle(i + 1), it.title);
                v.setTextViewText(rowWhere(i + 1),
                        it.location == null || it.location.length() == 0 ? it.period : it.location);
                /* 每一行点进各自那门课；request code 必须各不相同，否则 PendingIntent 会互相覆盖 */
                v.setOnClickPendingIntent(rowBox(i + 1), openApp(ctx, 20 + i, it.courseId));
            } else {
                v.setViewVisibility(rowBox(i + 1), View.GONE);
            }
        }

        /* 一行都没有时说一句，而不是留一片空白让人以为是坏了 */
        boolean empty = n == 0;
        v.setViewVisibility(R.id.widget_hint, empty ? View.VISIBLE : View.GONE);
        if (empty) {
            v.setTextViewText(R.id.widget_hint,
                    WidgetStore.load(ctx) == null ? "打开应用同步一次"
                            : (hasNext ? "今天没有其他课了" : "今天没有课"));
        }

        int more = d.today.size() - n;
        v.setViewVisibility(R.id.widget_more, more > 0 ? View.VISIBLE : View.GONE);
        if (more > 0) v.setTextViewText(R.id.widget_more, "还有 " + more + " 节");

        return v;
    }

    /* 三行各有一套独立 id —— 用 <include> 复用会让 RemoteViews 永远只命中第一行 */
    private static int rowBox(int n) { return rowId(n, 0); }
    private static int rowTime(int n) { return rowId(n, 1); }
    private static int rowTitle(int n) { return rowId(n, 2); }
    private static int rowWhere(int n) { return rowId(n, 3); }

    private static int rowId(int n, int which) {
        switch (n) {
            case 1: return which == 0 ? R.id.widget_r1_box : which == 1 ? R.id.widget_r1_time : which == 2 ? R.id.widget_r1_title : R.id.widget_r1_where;
            case 2: return which == 0 ? R.id.widget_r2_box : which == 1 ? R.id.widget_r2_time : which == 2 ? R.id.widget_r2_title : R.id.widget_r2_where;
            default: return which == 0 ? R.id.widget_r3_box : which == 1 ? R.id.widget_r3_time : which == 2 ? R.id.widget_r3_title : R.id.widget_r3_where;
        }
    }

    private static PendingIntent openApp(Context ctx, int req, String courseId) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        if (courseId != null && courseId.length() > 0) i.putExtra(PendingOpen.EXTRA_COURSE, courseId);
        return PendingIntent.getActivity(ctx, req, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
