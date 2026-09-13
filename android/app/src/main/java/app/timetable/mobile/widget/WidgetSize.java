package app.timetable.mobile.widget;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.os.Bundle;

/**
 * 小组件**当前在桌面上有多大**，以及据此决定"这一屏能摆几行"。
 *
 * ## 为什么需要它
 *
 * v1.9.5 之前，4×2 那个小组件是**按固定行数画的**：不管桌面给它多少地方，都按
 * "下一节 + 三行课"排版。于是用户把它拉成 2 列宽（或者拉高）之后：
 *
 *   - 宽度不够时，行内的「时间 + 课程名 + 地点」三列里，课程名那一列权重被挤成 0 ——
 *     屏幕上只剩下时间和地点，看起来就是"什么都不显示"；
 *   - 高度不够时，后两行被裁到小组件外面，用户根本看不到。
 *
 * 现在改成**按尺寸排版**：窄了就把地点那列收起来、把宽度让给课程名；
 * 矮了就少列几行，高了就多列几行。判据集中在这个类里。
 *
 * ## 与 Web 层保持一致
 *
 * 同一套判据在 Web 层也有一份（{@code src/platform/widgetLayout.ts}，那里有单测），
 * 因为应用内要按同样的规则画**尺寸预览** —— 预览和桌面必须是同一套排版，
 * 否则预览就成了骗人的东西。改这里的常数时，那边要一起改。
 */
public final class WidgetSize {

    /** 一个桌面格子的长度（dp）。系统自己的公式就是 (dp + 30) / 70 */
    private static final float CELL = 70f;
    /** 系统在格数与 dp 之间做换算时的固定补偿 */
    private static final float GUTTER = 30f;

    /** 大组件（4×2）固定部分占的高度：内边距 + 学期行 + 下一节那一块 + 分隔线 */
    private static final int FIXED_TALL_BLOCK = 72;
    /** 大组件里每一行课占的高度 */
    private static final int ROW_H = 18;
    /** 小组件（2×2）头部（倒计时那一大块）占的高度 */
    private static final int FIXED_SMALL_BLOCK = 96;
    /** 小组件被拉高之后，每多一行课占的高度 */
    private static final int SMALL_ROW_H = 20;

    /** 窄于这个宽度就摆不下「时间 + 课程名 + 地点」三列，地点那列要收起来 */
    private static final int NARROW_DP = 230;

    public final int widthDp;
    public final int heightDp;
    /** 估算的格数，只用于自检与日志 */
    public final int cols;
    public final int rows;

    private WidgetSize(int widthDp, int heightDp) {
        this.widthDp = widthDp;
        this.heightDp = heightDp;
        this.cols = Math.max(1, Math.round((widthDp + GUTTER) / CELL));
        this.rows = Math.max(1, Math.round((heightDp + GUTTER) / CELL));
    }

    /**
     * 读这个实例当前占的地方。
     *
     * 取的是 **min** 而不是 max：min 是保证放得下的下界，按它排出来的东西一定不会被裁掉。
     * 桌面上取不到（options 为空，刚添加时常见）就用调用方给的默认尺寸。
     */
    public static WidgetSize of(Context ctx, int appWidgetId, int defWidthDp, int defHeightDp) {
        int w = defWidthDp;
        int h = defHeightDp;
        try {
            Bundle o = AppWidgetManager.getInstance(ctx).getAppWidgetOptions(appWidgetId);
            if (o != null) {
                int minW = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 0);
                int minH = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
                int maxW = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0);
                int maxH = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 0);
                if (minW > 0) w = minW; else if (maxW > 0) w = maxW;
                if (minH > 0) h = minH; else if (maxH > 0) h = maxH;
            }
        } catch (Exception e) {
            /* 拿不到就按默认尺寸排 —— 宁可少显示一行，也不能不显示 */
        }
        return new WidgetSize(Math.max(60, w), Math.max(60, h));
    }

    /** 窄到必须把「地点」那列收起来，把宽度让给课程名 */
    public boolean narrow() { return widthDp < NARROW_DP; }

    /** 大组件还能列几行课 */
    public int listRows(int max) {
        return clamp((heightDp - FIXED_TALL_BLOCK) / ROW_H, 0, max);
    }

    /** 小组件被拉高之后，还能补几行课（2×2 时是 0，拉高才出现） */
    public int extraRows(int max) {
        return clamp((heightDp - FIXED_SMALL_BLOCK) / SMALL_ROW_H, 0, max);
    }

    private static int clamp(int v, int lo, int hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    /** 自检用的一句话描述 */
    public String describe() {
        return widthDp + "x" + heightDp + "dp ≈ " + cols + "x" + rows + " 格"
                + (narrow() ? "（窄：收起地点列）" : "");
    }
}
