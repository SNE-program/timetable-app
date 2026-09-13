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
 * 宽的那个小组件：下一节课倒计时 + 接下来几节课。
 *
 * 「接下来几节课」是 Web 层算好传过来的 —— 这里只负责**按当前时间挑**与摆位置。
 * 之所以不在原生侧算，是因为"接下来还有哪些课"要经过作息方案、调课、停课、
 * 单双周一整套逻辑，在原生里再实现一遍必然会和主应用对不上。
 *
 * 行是**布局里写死的**，这里只切可见性与文字，不用 RemoteViews.addView ——
 * 那个 API 在部分桌面实现上会抛异常，一旦抛出整次 onUpdate 就废掉，
 * 小组件会停在 initialLayout 上什么都不显示（4×2 全白就是这个原因）。
 *
 * ## v1.9.6：按桌面给的尺寸排版
 *
 * 之前不管桌面给多大，都按"三行"排：窄了课程名那一列被挤成 0 宽（屏幕上只剩时间和地点，
 * 看起来就像"什么都不显示"），矮了后两行被裁到组件外面。现在交给 {@link WidgetSize}：
 * 窄了收起地点列，矮了少列几行、高了多列几行，并且**尺寸一变就重排**
 * （见 {@link #onAppWidgetOptionsChanged}）。
 */
public class TimetableWidgetProvider extends AppWidgetProvider {

    /** 布局里预置的行数，改布局时这里要跟着改 */
    private static final int ROWS = 3;
    /** 没拿到桌面尺寸时的兜底（与 widget_timetable_info.xml 里的声明一致） */
    private static final int BASE_W = 250;
    private static final int BASE_H = 110;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        WidgetData d = WidgetData.parse(WidgetStore.load(ctx));
        for (int id : ids) {
            try {
                mgr.updateAppWidget(id, build(ctx, d, WidgetSize.of(ctx, id, BASE_W, BASE_H)));
            } catch (Exception e) {
                try { mgr.updateAppWidget(id, fallback(ctx)); } catch (Exception ignored) { }
            }
        }
        /* 下课 / 上课 / 跨天时自己重画一次（见 WidgetRefresh） */
        WidgetRefresh.scheduleNext(ctx, d);
    }

    /**
     * 桌面上把组件拉大拉小了。
     *
     * 少了这一步，用户拉大之后看到的还是原来那一版排版：多出来的地方空着，
     * 而挤窄之后课程名会消失 —— "拉大了没用、拉小了看不见"。
     */
    @Override
    public void onAppWidgetOptionsChanged(Context ctx, AppWidgetManager mgr, int id, Bundle newOptions) {
        try {
            WidgetData d = WidgetData.parse(WidgetStore.load(ctx));
            mgr.updateAppWidget(id, build(ctx, d, WidgetSize.of(ctx, id, BASE_W, BASE_H)));
        } catch (Exception e) {
            try { mgr.updateAppWidget(id, fallback(ctx)); } catch (Exception ignored) { }
        }
        /* 尺寸变了，下一节的边界也可能变了（能显示的行数不同） */
        WidgetRefresh.scheduleNext(ctx, WidgetData.parse(WidgetStore.load(ctx)));
    }

    static RemoteViews fallback(Context ctx) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_timetable);
        v.setTextViewText(R.id.widget_term, "课表助手");
        v.setTextViewText(R.id.widget_hint, "打开应用同步一次");
        v.setViewVisibility(R.id.widget_next_row, View.GONE);
        for (int i = 1; i <= ROWS; i++) v.setViewVisibility(rowBox(i), View.GONE);
        v.setOnClickPendingIntent(R.id.widget_root, openApp(ctx, 1, ""));
        return v;
    }

    static RemoteViews build(Context ctx, WidgetData d, WidgetSize size) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_timetable);
        v.setTextViewText(R.id.widget_term, d.term.length() > 0 ? d.term : "课表助手");
        v.setOnClickPendingIntent(R.id.widget_root, openApp(ctx, 1, ""));

        long now = System.currentTimeMillis();
        WidgetData.Item next = d.pickNext(now);
        boolean fresh = d.isFresh(WidgetRender.todayIso());

        v.setViewVisibility(R.id.widget_next_row, next != null ? View.VISIBLE : View.GONE);
        if (next != null) {
            v.setTextViewText(R.id.widget_next_title, next.title);
            v.setTextViewText(R.id.widget_next_where, next.subtitle());
            long target = next.startMs > now ? next.startMs : next.endMs;
            v.setChronometerCountDown(R.id.widget_next_count, true);
            v.setChronometer(R.id.widget_next_count, WidgetRender.chronometerBase(target), null, true);
            v.setOnClickPendingIntent(R.id.widget_next_row, openApp(ctx, 10, next.courseId));
        }

        /*
         * 行里放什么：
         *   数据是今天的 → 今天还没结束的课（正常情况）；
         *   数据过期了（几天没打开应用）→ 接下来的几节课，带上"周几"，别把旧课当今天。
         */
        List<WidgetData.Item> pool = fresh ? d.todayRemaining(now) : d.upcoming;
        /*
         * 顶部那一节已经从 pool 里去掉：它已经单独显示在上面了，再列一遍就是同一节课出现两次。
         * Web 层的预览用同一套取法（src/platform/widgetLayout.ts 的 previewRows，那边有单测）。
         */
        List<WidgetData.Item> rows = new java.util.ArrayList<>();
        for (WidgetData.Item it : pool) {
            if (next != null && it.startMs == next.startMs && it.title.equals(next.title)) continue;
            rows.add(it);
        }
        /* 能列几行由桌面给的高度决定 —— 矮了硬塞会被裁掉，看起来就是"什么都没有" */
        int capacity = size.listRows(ROWS);
        int n = Math.min(rows.size(), capacity);
        boolean narrow = size.narrow();
        for (int i = 0; i < ROWS; i++) {
            if (i < n) {
                WidgetData.Item it = rows.get(i);
                v.setViewVisibility(rowBox(i + 1), View.VISIBLE);
                v.setTextViewText(rowTime(i + 1), fresh ? it.start : it.dayLabel + ' ' + it.start);
                v.setTextViewText(rowTitle(i + 1), it.title);
                /*
                 * 窄的时候把地点收起来：它是 wrap_content 的一列，不收的话课程名会被挤成 0 宽 ——
                 * 屏幕上只剩时间和地点，用户看到的就是"没显示课程"。
                 */
                v.setViewVisibility(rowWhere(i + 1), narrow ? View.GONE : View.VISIBLE);
                if (!narrow) {
                    v.setTextViewText(rowWhere(i + 1),
                            it.location == null || it.location.length() == 0 ? it.period : it.location);
                }
                /* 每一行点进各自那门课；request code 必须各不相同，否则 PendingIntent 会互相覆盖 */
                v.setOnClickPendingIntent(rowBox(i + 1), openApp(ctx, 20 + i, it.courseId));
            } else {
                v.setViewVisibility(rowBox(i + 1), View.GONE);
            }
        }

        /*
         * 什么都没得显示时说一句，而不是留一片空白让人以为是坏了。
         * "没有下一节、也没有别的课"才需要这句 —— 只剩上面那一节时不必再解释，
         * 否则会出现"上面明明写着高等数学，下面却说今天没有课了"这种自相矛盾。
         */
        boolean empty = next == null && n == 0;
        v.setViewVisibility(R.id.widget_hint, empty ? View.VISIBLE : View.GONE);
        if (empty) {
            v.setTextViewText(R.id.widget_hint,
                    WidgetStore.load(ctx) == null ? "打开应用同步一次"
                            : (fresh ? "今天没有课了" : "接下来没有课了"));
        }

        int more = rows.size() - n;
        v.setViewVisibility(R.id.widget_more, more > 0 ? View.VISIBLE : View.GONE);
        if (more > 0) v.setTextViewText(R.id.widget_more, "还有 " + more + " 节 · 拉大一点能多显示几节");

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
