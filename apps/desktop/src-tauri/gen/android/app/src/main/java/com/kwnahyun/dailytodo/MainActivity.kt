package com.kwnahyun.dailytodo

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var web: WebView? = null
  /** 위젯에서 누른 날짜 (화면이 takeLaunchDate 로 한 번 가져감) */
  @Volatile private var launchDate: String? = null

  private fun takeDate(intent: Intent?) {
    val d = intent?.data
    if (d?.scheme == "dailytodo" && d.host == "day") launchDate = d.lastPathSegment
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    takeDate(intent)
    // 이미 떠 있던 화면에도 알림 (보이게 될 때 화면이 가져감)
    web?.post { web?.evaluateJavascript("document.dispatchEvent(new Event('visibilitychange'))", null) }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    takeDate(intent)
    // 뒤로 버튼: 화면에 먼저 물어봄 (열린 시트 닫기 → 오늘 탭으로), 화면이 안 쓰면 앱을 뒤로 (끄지 않고 홈으로)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val w = web
        if (w == null) {
          moveTaskToBack(true)
          return
        }
        w.evaluateJavascript("(window.__dtBack && window.__dtBack()) ? 'y' : 'n'") { r ->
          if (r != "\"y\"") moveTaskToBack(true)
        }
      }
    })
  }

  // 화면(JS)에서 window.DTAndroid.openStorageSettings() — '모든 파일 접근' 설정 화면
  override fun onWebViewCreate(webView: WebView) {
    web = webView
    webView.addJavascriptInterface(Bridge(), "DTAndroid")
  }

  inner class Bridge {
    /** 홈 화면 위젯 내용 (app/widget.ts) → filesDir/widget.json → 위젯 다시 그림 */
    @JavascriptInterface
    fun setWidgetData(json: String) {
      try {
        val f = java.io.File(filesDir, "widget.json")
        val tmp = java.io.File(filesDir, "widget.json.tmp")
        tmp.writeText(json)
        tmp.renameTo(f)
        MonthWidget.refreshAll(this@MainActivity)
      } catch (e: Exception) {
        // 위젯이 못 받아도 앱은 그대로
      }
    }

    /** 위젯에서 누르고 들어온 날짜 ("YYYY-MM-DD", 없으면 null) — 한 번만 */
    @JavascriptInterface
    fun takeLaunchDate(): String? {
      val d = launchDate
      launchDate = null
      return d
    }

    @JavascriptInterface
    fun openStorageSettings() {
      runOnUiThread {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && !Environment.isExternalStorageManager()) {
          try {
            startActivity(Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName")))
          } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
          }
        } else if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
          requestPermissions(arrayOf(android.Manifest.permission.WRITE_EXTERNAL_STORAGE), 1)
        }
      }
    }
  }
}
