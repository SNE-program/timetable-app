package app.timetable.mobile;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 本地插件必须在 super.onCreate 之前注册
        registerPlugin(ReliabilityPlugin.class);
        registerPlugin(WidgetPlugin.class);
        registerPlugin(UpdatePlugin.class);
        super.onCreate(savedInstanceState);
        // 从桌面小组件点进来时，Intent 里带着要打开的课程
        PendingOpen.fromIntent(this, getIntent());
    }

    /**
     * 应用已经在后台时再点小组件，走的是这里（不会重新 onCreate）。
     * 少了这个方法，第二次点小组件就只会把应用切到前台、不跳课程。
     */
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        PendingOpen.fromIntent(this, intent);
    }
}
