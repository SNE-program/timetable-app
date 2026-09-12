package app.timetable.mobile;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 提醒可靠性助手。
 *
 * Android 上「App 关掉之后还能准点提醒」取决于三件事，而且后两件各家 ROM 都不一样：
 *   1. 通知权限 + 精确闹钟（系统标准，插件已处理）
 *   2. 电池优化白名单（不加入的话系统会把闹钟推迟甚至冻结）
 *   3. 自启动 / 后台运行权限（国产 ROM 特有，不加的话重启或清理后台后闹钟全没）
 *
 * 这个插件负责检测第 2 项，并把用户送到各家 ROM 对应的设置页。
 */
@CapacitorPlugin(name = "Reliability")
public class ReliabilityPlugin extends Plugin {

    /** 各家 ROM 的自启动管理页，按顺序尝试，第一个能打开的就用 */
    private static final String[][] AUTO_START_PAGES = {
        // 小米 / 红米
        {"com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"},
        // 华为 / 荣耀
        {"com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity"},
        {"com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity"},
        // OPPO / 一加 / realme
        {"com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity"},
        {"com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity"},
        {"com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity"},
        // vivo / iQOO
        {"com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity"},
        {"com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity"},
        // 魅族
        {"com.meizu.safe", "com.meizu.safe.permission.SmartBGActivity"},
        // 三星
        {"com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity"},
        // 联想 / 乐视
        {"com.lenovo.security", "com.lenovo.security.purebackground.PureBackgroundActivity"},
        {"com.letv.android.letvsafe", "com.letv.android.letvsafe.AutobootManageActivity"},
    };

    private boolean start(Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /** 检测当前是否已经把本应用排除在电池优化之外 */
    @PluginMethod
    public void check(PluginCall call) {
        JSObject ret = new JSObject();
        boolean unrestricted = true;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
                unrestricted = pm != null && pm.isIgnoringBatteryOptimizations(getContext().getPackageName());
            }
        } catch (Exception e) {
            unrestricted = false;
        }
        ret.put("batteryUnrestricted", unrestricted);
        ret.put("manufacturer", Build.MANUFACTURER == null ? "" : Build.MANUFACTURER);
        ret.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    /** 打开电池优化白名单列表 */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (start(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))) {
                call.resolve();
                return;
            }
        }
        openAppDetails(call);
    }

    /** 打开各家 ROM 的自启动 / 后台运行管理页 */
    @PluginMethod
    public void openAutoStartSettings(PluginCall call) {
        for (String[] page : AUTO_START_PAGES) {
            Intent intent = new Intent();
            intent.setClassName(page[0], page[1]);
            if (start(intent)) {
                call.resolve();
                return;
            }
        }
        // 都不支持就退回到应用详情页，用户可以在那里找到权限入口
        openAppDetails(call);
    }

    /**
     * 重置通知排程。
     *
     * LocalNotifications 把排程记录存在 SharedPreferences 里，而且 cancelAll / getPending
     * 是逐条遍历读取的 —— 一旦记录累积到成百上千条，这些调用就会慢到像卡死。
     * 这个方法直接清库 + 取消所有已发出的通知，绕过插件，最坏情况下也能自救。
     */
    @PluginMethod
    public void resetNotifications(PluginCall call) {
        try {
            android.content.SharedPreferences prefs =
                getContext().getSharedPreferences("NOTIFICATION_STORE", Context.MODE_PRIVATE);
            prefs.edit().clear().commit();

            android.app.NotificationManager nm =
                (android.app.NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancelAll();

            JSObject ret = new JSObject();
            ret.put("cleared", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "重置失败" : e.getMessage());
        }
    }

    /**
     * 有没有"系统时间 / 时区变了，提醒需要重排"的待办标记。
     *
     * 标记由 SystemChangeReceiver 在收到广播时写下。这里只读不写 ——
     * 重排要等 JS 侧时间引擎跑完，详见那个类的注释。
     */
    @PluginMethod
    public void pendingReschedule(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            android.content.SharedPreferences p =
                getContext().getSharedPreferences(SystemChangeReceiver.PREFS, Context.MODE_PRIVATE);
            ret.put("pending", p.getBoolean(SystemChangeReceiver.KEY_PENDING, false));
            ret.put("reason", p.getString(SystemChangeReceiver.KEY_REASON, ""));
            ret.put("at", p.getLong(SystemChangeReceiver.KEY_AT, 0L));
        } catch (Exception e) {
            ret.put("pending", false);
            ret.put("reason", "");
            ret.put("at", 0L);
        }
        call.resolve(ret);
    }

    /** 重排完成后清掉标记 */
    @PluginMethod
    public void clearReschedule(PluginCall call) {
        try {
            getContext().getSharedPreferences(SystemChangeReceiver.PREFS, Context.MODE_PRIVATE)
                .edit()
                .remove(SystemChangeReceiver.KEY_PENDING)
                .remove(SystemChangeReceiver.KEY_REASON)
                .remove(SystemChangeReceiver.KEY_AT)
                .apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("清除失败");
        }
    }

    /** 打开本应用的应用详情页（最通用的兜底） */
    @PluginMethod
    public void openAppDetails(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        if (start(intent)) {
            call.resolve();
        } else {
            call.reject("无法打开应用设置页");
        }
    }
}
