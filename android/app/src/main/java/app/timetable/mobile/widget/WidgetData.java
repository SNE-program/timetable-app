package app.timetable.mobile.widget;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 小组件要显示的数据。由 Web 层生成 JSON，这里只负责解析与**按时间挑** ——
 * 不在这里做任何时间推算（单双周、调课、作息切换那些逻辑只在 Web 层有一份）。
 *
 * v1.9.2 起多了 `upcoming`：从现在起最多几节课，每一项都带着绝对的 startMs / endMs。
 * 于是"现在该显示哪一节"就是**一次线性比较**，不需要等应用推送 ——
 * 这正是"上完一节之后桌面还显示着那一节"的修法。
 */
public final class WidgetData {

    public static final class Item {
        public String title = "";
        public String start = "";
        public String end = "";
        public String location = "";
        public String period = "";
        public String dayLabel = "";
        /** 这一天（YYYY-MM-DD），由 Web 层给出 */
        public String date = "";
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
    /** 这份数据是哪一天生成的（YYYY-MM-DD） */
    public String todayIso = "";
    /** 今天还没结束的课（按开始时间） */
    public List<Item> today = new ArrayList<>();
    /** 从现在起最多 6 节（含之后的日子），按开始时间 */
    public List<Item> upcoming = new ArrayList<>();

    public static WidgetData parse(String json) {
        WidgetData d = new WidgetData();
        if (json == null || json.length() == 0) return d;
        try {
            JSONObject o = new JSONObject(json);
            d.term = o.optString("term", "");
            d.todayIso = o.optString("todayIso", "");
            d.today = list(o.optJSONArray("today"));
            d.upcoming = list(o.optJSONArray("upcoming"));
        } catch (Exception e) {
            /* JSON 坏了就当没有数据 —— 小组件显示"打开应用同步一次"，绝不崩 */
        }
        return d;
    }

    private static List<Item> list(JSONArray arr) {
        List<Item> out = new ArrayList<>();
        if (arr == null) return out;
        for (int i = 0; i < arr.length(); i++) {
            Item it = item(arr.optJSONObject(i));
            if (it != null) out.add(it);
        }
        return out;
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
        it.date = o.optString("date", "");
        it.startMs = o.optLong("startMs", 0L);
        it.endMs = o.optLong("endMs", 0L);
        it.courseId = o.optString("courseId", "");
        return it;
    }

    /**
     * 接下来该显示哪一节：upcoming 里第一项 endMs > now。
     *
     * 已经在上课的那一节也会被选中（它的 endMs 还没过）—— 于是桌面上会从
     * "距上课 x 分钟"自然变成"这节课正在进行"，而不是跳过去。
     */
    public Item pickNext(long now) {
        for (Item it : upcoming) {
            if (it.endMs > now) return it;
        }
        /* 老数据（没有 upcoming）时退回 today */
        for (Item it : today) {
            if (it.endMs > now) return it;
        }
        return null;
    }

    /** 今天还没结束的课 */
    public List<Item> todayRemaining(long now) {
        List<Item> out = new ArrayList<>();
        for (Item it : today) {
            if (it.endMs > now) out.add(it);
        }
        return out;
    }

    /**
     * 数据是不是"今天"的。
     *
     * 隔了几天没打开应用时，payload 里的 today 已经过期 —— 那时桌面应当只按
     * upcoming 显示下一节课（并带上"周几"），而不是把几天前的课当成"今天"。
     */
    public boolean isFresh(String todayLocalIso) {
        return todayIso != null && todayIso.length() > 0 && todayIso.equals(todayLocalIso);
    }
}
