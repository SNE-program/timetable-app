package app.timetable.mobile.widget;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * 小组件的数据中转站。
 *
 * 计划书 6.5 节定的方案：**由 Web 层把「未来要显示的课」写成 JSON 存进来，
 * 小组件只读**。这么做是为了让小组件里不跑时间引擎 —— 引擎一旦有两份实现，
 * 两边的边界情况迟早会不一致（单双周、调课、作息切换），到时候"小组件显示的
 * 是错的"会成为最说不清的一类 bug。
 *
 * 所以这里的职责只有一个：存一段字符串、取一段字符串。
 */
public final class WidgetStore {

    private static final String PREF = "timetable_widget";
    private static final String KEY_PAYLOAD = "payload";
    private static final String KEY_UPDATED = "updated_at";

    private WidgetStore() { }

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getApplicationContext().getSharedPreferences(PREF, Context.MODE_PRIVATE);
    }

    public static void save(Context ctx, String json) {
        prefs(ctx).edit()
                .putString(KEY_PAYLOAD, json)
                .putLong(KEY_UPDATED, System.currentTimeMillis())
                .apply();
    }

    public static String load(Context ctx) {
        return prefs(ctx).getString(KEY_PAYLOAD, null);
    }

    public static long updatedAt(Context ctx) {
        return prefs(ctx).getLong(KEY_UPDATED, 0L);
    }

    public static void clear(Context ctx) {
        prefs(ctx).edit().remove(KEY_PAYLOAD).remove(KEY_UPDATED).apply();
    }
}
