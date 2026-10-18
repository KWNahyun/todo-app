package com.kwnahyun.dailytodo

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // 화면(JS)에서 window.DTAndroid.openStorageSettings() — '모든 파일 접근' 설정 화면
  override fun onWebViewCreate(webView: WebView) {
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
