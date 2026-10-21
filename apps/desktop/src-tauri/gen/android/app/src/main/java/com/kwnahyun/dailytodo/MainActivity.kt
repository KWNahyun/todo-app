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

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
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
