package com.sk.game;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;

/**
 * 太空杀 · 三阵营对抗 —— Android WebView 外壳（无第三方依赖，页面全部内置在 assets/www）。
 *
 * 设计要点：
 *  · 单机（人机）完全离线可玩：页面为 file:///android_asset/www/index.html，工程内无任何 fetch/XHR，
 *    全部为普通 <script src>，因此 file:// 下与浏览器表现一致（见 README「单机也可以直接双击 index.html」）。
 *  · DOM Storage 必须开启：游戏用 localStorage 存设置（sk_* 键）与首局引导状态。
 *  · mediaPlaybackRequiresUserGesture(false)：背景音乐与音效无需先点一下才响。
 *  · MIXED_CONTENT_ALWAYS_ALLOW + usesCleartextTraffic：file:// 页面连 ws://局域网IP:8766 联机不被拦。
 */
public class MainActivity extends Activity {
    private WebView web;
    private ProgressBar progress;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.main);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); // 夜间读条时别熄屏

        web = findViewById(R.id.web);
        progress = findViewById(R.id.progress);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        web.setBackgroundColor(0xFF050A14);   // 与游戏 --bg 一致，避免加载瞬间白闪

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) { return false; }
            @Override
            public void onPageFinished(WebView v, String u) { progress.setVisibility(View.GONE); }
        });
        web.setWebChromeClient(new WebChromeClient());
        web.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }
}
