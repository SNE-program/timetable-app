package app.timetable.mobile;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import app.timetable.mobile.widget.WidgetData;
import app.timetable.mobile.widget.NextClassWidgetProvider;
import app.timetable.mobile.widget.TimetableWidgetProvider;
import app.timetable.mobile.widget.WidgetRefresh;
import app.timetable.mobile.widget.WidgetStore;

/**
 * 桌面小组件的数据桥。
 *
 * 只做一件事：Web 层把要显示的课推过来，这里存下并通知小组件刷新。
 * 刻意不做查询接口 —— 小组件不反向问 Web 层要数据，避免在应用没起来的时候
 * 出现"要等引擎算"的路径。
 */
@CapacitorPlugin(name = "TimetableWidget")
public class WidgetPlugin extends Plugin {

    /**
     * 设备端体检：把"小组件到底有没有在用、数据推到了没"一次说清。
     *
     * 为什么要有它：小组件活在桌面进程里，出了问题在应用里看不出任何异常 ——
     * 用户说"两个都用不了"，而我这边既看不到桌面上放了几个实例、
     * 也看不到最后一次推送成功没有。这个接口把这些事实原样报给界面。
     */
    @PluginMethod
    public void debugState(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        try {
            String payload = WidgetStore.load(ctx);
            WidgetData d = WidgetData.parse(payload);
            ret.put("instancesNext", WidgetRefresh.idsOf(ctx, NextClassWidgetProvider.class).length);
            ret.put("instancesTimetable", WidgetRefresh.idsOf(ctx, TimetableWidgetProvider.class).length);
            ret.put("updatedAt", WidgetStore.updatedAt(ctx));
            ret.put("scheduledAt", WidgetRefresh.scheduledAt(ctx));
            ret.put("payloadBytes", payload == null ? 0 : payload.length());
            ret.put("term", d.term);
            ret.put("todayIso", d.todayIso);
            ret.put("todayCount", d.today.size());
            ret.put("upcomingCount", d.upcoming.size());
            WidgetData.Item nx = d.pickNext(System.currentTimeMillis());
            ret.put("nextTitle", nx == null ? "" : nx.title);
            ret.put("nextStartMs", nx == null ? 0L : nx.startMs);
            ret.put("sdk", Build.VERSION.SDK_INT);
        } catch (Exception e) {
            ret.put("error", String.valueOf(e.getMessage()));
        }
        call.resolve(ret);
    }

    /** 写入小组件数据并刷新 */
    @PluginMethod
    public void update(PluginCall call) {
        String payload = call.getString("payload");
        if (payload == null) {
            call.reject("缺少 payload");
            return;
        }
        Context ctx = getContext();
        WidgetStore.save(ctx, payload);
        refreshAll(ctx);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /** 清空（课表被删光时用） */
    @PluginMethod
    public void clear(PluginCall call) {
        Context ctx = getContext();
        WidgetStore.clear(ctx);
        refreshAll(ctx);
        JSObject ret = new JSObject();
        ret.put("ok", true);
        call.resolve(ret);
    }

    /**
     * 取走"小组件点了某一门课"的待办。
     *
     * 小组件只能发 Intent，课程详情是 Web 层的弹层，中间隔着启动流程 ——
     * 所以用 SharedPreferences 当接力棒（见 PendingOpen）。
     * 返回空字符串表示这次不是从小组件点进来的。
     */
    @PluginMethod
    public void consumePendingOpen(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("courseId", PendingOpen.take(getContext()));
        call.resolve(ret);
    }

    /** 桌面上到底有没有放小组件 —— 没有的话 Web 层就不用白算数据 */
    @PluginMethod
    public void hasWidgets(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        ret.put("has", hasAny(ctx, TimetableWidgetProvider.class) || hasAny(ctx, NextClassWidgetProvider.class));
        call.resolve(ret);
    }

    private static boolean hasAny(Context ctx, Class<?> provider) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, provider));
        return ids != null && ids.length > 0;
    }

    /** 刷新两个小组件（和闹钟到点自刷新走的是同一段代码，见 WidgetRefresh） */
    private static void refreshAll(Context ctx) {
        WidgetRefresh.all(ctx);
    }
}
