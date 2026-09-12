package app.timetable.mobile;

import android.content.Context;
import android.content.Intent;

/**
 * 小组件点击 → 打开对应课程详情 的"接力棒"。
 *
 * 小组件是桌面进程渲染的，它只能发一个 Intent；而课程详情是 Web 层的一个弹层。
 * 中间隔着 Capacitor 的启动流程，没有现成的通道，所以用最简单可靠的办法：
 * 把要打开的课程 id 存进 SharedPreferences，Web 层启动后**取走并清掉**。
 *
 * 用 take（读+清）而不是 get，是因为"打开课程详情"是一次性动作：
 * 留着的话用户下次正常打开应用会被莫名其妙地弹进某个课程详情。
 */
public final class PendingOpen {

    private static final String PREFS = "timetable.system";
    private static final String KEY_COURSE = "pendingCourseId";

    /** 小组件 Intent 里带课程 id 用的键 */
    public static final String EXTRA_COURSE = "timetable.courseId";

    private PendingOpen() { }

    public static void set(Context ctx, String courseId) {
        if (ctx == null || courseId == null || courseId.length() == 0) return;
        try {
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(KEY_COURSE, courseId).apply();
        } catch (Exception e) {
            /* 写不进去最多是"点了没跳到详情"，不该让启动路径崩掉 */
        }
    }

    /** 从 Intent 里取出课程 id 并记下（MainActivity 的 onCreate / onNewIntent 都会调） */
    public static void fromIntent(Context ctx, Intent intent) {
        if (ctx == null || intent == null) return;
        try {
            set(ctx, intent.getStringExtra(EXTRA_COURSE));
        } catch (Exception e) {
            /* 忽略 */
        }
    }

    /** 取走并清除 */
    public static String take(Context ctx) {
        if (ctx == null) return "";
        try {
            android.content.SharedPreferences p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String v = p.getString(KEY_COURSE, "");
            if (v != null && v.length() > 0) p.edit().remove(KEY_COURSE).apply();
            return v == null ? "" : v;
        } catch (Exception e) {
            return "";
        }
    }
}
