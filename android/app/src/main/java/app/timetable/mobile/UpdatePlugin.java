package app.timetable.mobile;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * 应用内更新：下载新的安装包，然后交给系统安装器。
 *
 * ## 为什么不能"全自动"
 *
 * 安卓**不允许**普通应用静默安装自己的更新 —— 只有应用商店、设备管理员（DPC）
 * 和系统应用有这个能力。所以这条路能省掉的是"去浏览器下载、再翻文件管理器找安装包"
 * 这两步，最后一下「安装」仍然必须由用户点。这不是偷懒，是平台规定。
 *
 * ## 为什么自己写而不是用现成插件
 *
 * 这个项目从第一天起就不引第三方运行时依赖。这里要的东西也很小：
 * 一次流式下载 + 一个 ACTION_VIEW intent + 拿 FileProvider 授权读那个文件。
 *
 * ## 关于权限
 *
 * Android 8.0 起安装未知来源应用需要「安装未知应用」这一项授权，
 * 用户可能没开。所以先问 canRequestPackageInstalls()，没开就把他送到那个设置页 ——
 * 而不是让他点了「安装」之后对着一个失败弹窗发愣。
 */
@CapacitorPlugin(name = "AppUpdate")
public class UpdatePlugin extends Plugin {

    /** 安装包放在应用缓存里：FileProvider 已经覆盖 cache 目录，且系统随时可以回收 */
    private File updateDir() {
        File dir = new File(getContext().getCacheDir(), "update");
        if (!dir.exists() && !dir.mkdirs()) {
            // 建不出来就让调用方拿到失败，别硬撑着往下走
            return null;
        }
        return dir;
    }

    /** 这个应用有没有被允许安装未知来源应用 */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject ret = new JSObject();
        boolean allowed = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            allowed = getContext().getPackageManager().canRequestPackageInstalls();
        }
        ret.put("allowed", allowed);
        ret.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(ret);
    }

    /** 跳到「安装未知应用」设置页（各家 ROM 的入口不同，这里用系统标准那一页） */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
            } else {
                intent = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("打不开系统设置页：" + e.getMessage());
        }
    }

    /** 删掉上次下载残留的安装包（换版本时用，省点空间） */
    @PluginMethod
    public void clearDownloaded(PluginCall call) {
        File dir = new File(getContext().getCacheDir(), "update");
        File[] files = dir.listFiles();
        if (files != null) {
            for (File f : files) {
                //noinspection ResultOfMethodCallIgnored
                f.delete();
            }
        }
        call.resolve();
    }

    /**
     * 下载并调起安装器。
     *
     * 下载放后台线程（9 MB 在慢网上一分钟都不止，绝不能占着主线程），
     * 进度通过 progress 事件报给界面；下完再回主线程发安装 intent。
     */
    @PluginMethod
    public void downloadAndInstall(final PluginCall call) {
        final String url = call.getString("url");
        final String fileName = call.getString("fileName", "update.apk");
        if (url == null || url.isEmpty()) {
            call.reject("没有下载地址");
            return;
        }
        final Context ctx = getContext().getApplicationContext();

        new Thread(new Runnable() {
            @Override
            public void run() {
                File dir = updateDir();
                if (dir == null) {
                    call.reject("建不了缓存目录，没法保存安装包");
                    return;
                }
                File out = new File(dir, fileName);
                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setInstanceFollowRedirects(true);
                    conn.setConnectTimeout(15000);
                    conn.setReadTimeout(60000);
                    conn.connect();
                    int code = conn.getResponseCode();
                    if (code < 200 || code >= 300) {
                        call.reject("下载失败：服务器返回 " + code);
                        return;
                    }
                    int total = conn.getContentLength();
                    InputStream in = conn.getInputStream();
                    FileOutputStream fos = new FileOutputStream(out);
                    byte[] buf = new byte[64 * 1024];
                    long got = 0;
                    int lastPct = -1;
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        fos.write(buf, 0, n);
                        got += n;
                        if (total > 0) {
                            int pct = (int) (got * 100 / total);
                            if (pct != lastPct) {
                                lastPct = pct;
                                JSObject p = new JSObject();
                                p.put("percent", pct);
                                p.put("received", got);
                                p.put("total", total);
                                notifyListeners("progress", p);
                            }
                        }
                    }
                    fos.flush();
                    fos.close();
                    in.close();
                } catch (Exception e) {
                    if (out.exists()) {
                        //noinspection ResultOfMethodCallIgnored
                        out.delete();
                    }
                    call.reject("下载失败：" + e.getMessage());
                    return;
                } finally {
                    if (conn != null) conn.disconnect();
                }

                final File apk = out;
                getActivity().runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            Uri uri = FileProvider.getUriForFile(
                                    ctx, ctx.getPackageName() + ".fileprovider", apk);
                            Intent intent = new Intent(Intent.ACTION_VIEW);
                            intent.setDataAndType(uri, "application/vnd.android.package-archive");
                            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            ctx.startActivity(intent);
                            JSObject ret = new JSObject();
                            ret.put("installed", true);
                            ret.put("path", apk.getAbsolutePath());
                            call.resolve(ret);
                        } catch (Exception e) {
                            call.reject("调不起安装器：" + e.getMessage());
                        }
                    }
                });
            }
        }, "app-update-download").start();
    }
}
