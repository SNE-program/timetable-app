package app.timetable.mobile;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 系统级变化的记录员。
 *
 * ## 为什么要有这个类
 *
 * 提醒是按"绝对时刻"（epoch 毫秒）排给系统闹钟的。用户在设置里把时间往前拨一小时，
 * 或者坐飞机换了时区，那些绝对时刻对应的**墙上时间**就全变了 ——
 * 闹钟还是会准时响，但响在错误的时间点。
 *
 * 排程逻辑在 JS 侧（时间引擎在那儿），而广播是原生收到的，所以这里只做一件事：
 * **把一个"待重排"标记写进 SharedPreferences**。应用下次回到前台时，
 * JS 通过 Reliability.pendingReschedule() 读到标记，重排一遍并清掉它。
 *
 * 为什么不在广播里直接重排：WebView 里的 JS 在应用没启动时根本不存在，
 * 想在原生侧重排就得把整个时间引擎再实现一遍 —— 那是两份必须永远保持一致的逻辑，
 * 迟早会分叉。宁可晚一步（用户下次打开应用时），也不要两份真相。
 *
 * 开机重排不在这里做：LocalNotifications 插件自带的 LocalNotificationRestoreReceiver
 * 已经处理 BOOT_COMPLETED / LOCKED_BOOT_COMPLETED。
 */
public class SystemChangeReceiver extends BroadcastReceiver {

    public static final String PREFS = "timetable.system";
    public static final String KEY_PENDING = "pendingReschedule";
    public static final String KEY_REASON = "reason";
    public static final String KEY_AT = "at";

    /** 广播 action → 给用户看的原因 */
    static String describe(String action) {
        if (Intent.ACTION_TIME_CHANGED.equals(action)) return "系统时间被修改";
        if (Intent.ACTION_TIMEZONE_CHANGED.equals(action)) return "时区变化";
        if (Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return "应用已更新";
        if (Intent.ACTION_DATE_CHANGED.equals(action)) return "日期变化";
        return "系统设置变化";
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null) return;
        String action = intent.getAction() == null ? "" : intent.getAction();

        try {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .putBoolean(KEY_PENDING, true)
                .putString(KEY_REASON, describe(action))
                .putLong(KEY_AT, System.currentTimeMillis())
                .apply();
        } catch (Exception e) {
            /* 广播接收器里抛异常会让系统杀掉进程，这里必须吞掉 */
        }
    }
}
