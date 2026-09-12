package app.timetable.mobile.widget;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 小组件要显示的数据。由 Web 层生成 JSON，这里只负责解析 ——
 * 不在这里做任何时间计算，理由见 WidgetStore 的注释。
 */
public final class WidgetData {

    public static final class Item {
        public String title = "";
        public String start = "";
        public String end = "";
        public String location = "";
        public String period = "";
        public String dayLabel = "";
        public long startMs = 0L;
        public long endMs = 0L;
        /** 点这一条时打开哪门课的详情（Web 层传过来的） */
        public String courseId = "";

        /** 地点为空时不显示那个分隔点 */
        public String subtitle() {
            StringBuilder sb = new StringBuilder();
            if (location != null && location.length() > 0) sb.append(location);
            if (start != null && start.length() > 0) {
                if (sb.length() > 0) sb.append(" · ");
                sb.append(start).append("-").append(end);
            }
            return sb.toString();
        }
    }

    public String term = "";
    public List<Item> today = new ArrayList<>();
    public Item next = null;

    public static WidgetData parse(String json) {
        WidgetData d = new WidgetData();
        if (json == null || json.length() == 0) return d;
        try {
            JSONObject o = new JSONObject(json);
            d.term = o.optString("term", "");
            JSONArray arr = o.optJSONArray("today");
            if (arr != null) {
                for (int i = 0; i < arr.length(); i++) {
                    Item it = item(arr.optJSONObject(i));
                    if (it != null) d.today.add(it);
                }
            }
            JSONObject nx = o.optJSONObject("next");
            d.next = item(nx);
        } catch (Exception e) {
            /* JSON 坏了就当没有数据 —— 小组件显示"打开应用同步一下"，绝不崩 */
        }
        return d;
    }

    private static Item item(JSONObject o) {
        if (o == null) return null;
        Item it = new Item();
        it.title = o.optString("title", "");
        it.start = o.optString("start", "");
        it.end = o.optString("end", "");
        it.location = o.optString("location", "");
        it.period = o.optString("period", "");
        it.dayLabel = o.optString("dayLabel", "");
        it.startMs = o.optLong("startMs", 0L);
        it.endMs = o.optLong("endMs", 0L);
        it.courseId = o.optString("courseId", "");
        return it;
    }
}
