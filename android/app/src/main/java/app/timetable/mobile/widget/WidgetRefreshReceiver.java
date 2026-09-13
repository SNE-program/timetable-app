package app.timetable.mobile.widget;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 到点了，把小组件重画一次。
 *
 * 闹钟由 {@link WidgetRefresh#scheduleNext} 排，收到之后重新渲染 ——
 * 渲染时会再排下一边界，于是**一整天的翻页都不需要应用在前台**：
 * 上课时倒计时指向下课，下课后自动换成下一节。
 */
public class WidgetRefreshReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            WidgetRefresh.all(context);
        } catch (Exception e) {
            /* 广播里出错不该让系统记一笔 ANR —— 什么都别做，下次打开应用还会重画 */
        }
    }
}
