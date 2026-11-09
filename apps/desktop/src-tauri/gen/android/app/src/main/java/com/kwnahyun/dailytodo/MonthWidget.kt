package com.kwnahyun.dailytodo

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.util.Calendar

/**
 * 홈 화면 달력 위젯 — 날짜 칸 아래 그날 마감(빨강) · 일정.
 * 내용은 앱이 만들어 둔 filesDir/widget.json (app/widget.ts) — 위젯은 보관함을 직접 읽지 않음.
 * ‹ › 로 달 넘김(위젯마다 기억), 달 이름을 누르면 이번 달, 날짜를 누르면 앱에서 그날 일정.
 */
class MonthWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) render(context, manager, id)
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    val id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    if (id == AppWidgetManager.INVALID_APPWIDGET_ID) return
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val off = prefs.getInt("off_$id", 0)
    val next = when (intent.action) {
      ACTION_PREV -> off - 1
      ACTION_NEXT -> off + 1
      ACTION_TODAY -> 0
      else -> return
    }
    prefs.edit().putInt("off_$id", next).apply()
    render(context, AppWidgetManager.getInstance(context), id)
  }

  override fun onDeleted(context: Context, ids: IntArray) {
    val e = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    for (id in ids) e.remove("off_$id")
    e.apply()
  }

  companion object {
    private const val PREFS = "dt_widget"
    private const val ACTION_PREV = "com.kwnahyun.dailytodo.widget.PREV"
    private const val ACTION_NEXT = "com.kwnahyun.dailytodo.widget.NEXT"
    private const val ACTION_TODAY = "com.kwnahyun.dailytodo.widget.TODAY"

    /** 앱이 새 내용을 넘겼을 때 — 모든 위젯 다시 그림 */
    fun refreshAll(context: Context) {
      val m = AppWidgetManager.getInstance(context)
      for (id in m.getAppWidgetIds(ComponentName(context, MonthWidget::class.java))) render(context, m, id)
    }

    private fun ymd(c: Calendar) = "%04d-%02d-%02d".format(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))

    private fun days(context: Context): JSONObject {
      return try {
        JSONObject(File(context.filesDir, "widget.json").readText()).optJSONObject("days") ?: JSONObject()
      } catch (e: Exception) {
        JSONObject()
      }
    }

    private fun id(context: Context, name: String) = context.resources.getIdentifier(name, "id", context.packageName)

    private fun broadcast(context: Context, widgetId: Int, action: String, code: Int): PendingIntent {
      val i = Intent(context, MonthWidget::class.java).setAction(action).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
      return PendingIntent.getBroadcast(context, widgetId * 10 + code, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun render(context: Context, manager: AppWidgetManager, widgetId: Int) {
      val v = RemoteViews(context.packageName, R.layout.dt_month_widget)
      val off = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("off_$widgetId", 0)
      val today = ymd(Calendar.getInstance())
      val month = Calendar.getInstance().apply { set(Calendar.DAY_OF_MONTH, 1); add(Calendar.MONTH, off) }
      val y = month.get(Calendar.YEAR)
      val m = month.get(Calendar.MONTH)
      v.setTextViewText(R.id.title, "${y}년 ${m + 1}월")
      v.setOnClickPendingIntent(R.id.prev, broadcast(context, widgetId, ACTION_PREV, 1))
      v.setOnClickPendingIntent(R.id.next, broadcast(context, widgetId, ACTION_NEXT, 2))
      v.setOnClickPendingIntent(R.id.title, broadcast(context, widgetId, ACTION_TODAY, 3))

      // 일요일부터 시작하는 칸 (4~6주)
      val start = (month.clone() as Calendar).apply { add(Calendar.DAY_OF_MONTH, -(get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY)) }
      val lastDay = month.getActualMaximum(Calendar.DAY_OF_MONTH)
      val weeks = ((month.get(Calendar.DAY_OF_WEEK) - Calendar.SUNDAY) + lastDay + 6) / 7
      for (r in 0 until 6) v.setViewVisibility(id(context, "r$r"), if (r < weeks) android.view.View.VISIBLE else android.view.View.GONE)

      val data = days(context)
      val c = ContextCompat::getColor
      val text = c(context, R.color.dt_w_text)
      val faint = c(context, R.color.dt_w_faint)
      val sun = c(context, R.color.dt_w_sun)
      val sat = c(context, R.color.dt_w_sat)
      val deadline = c(context, R.color.dt_w_deadline)
      val onAccent = c(context, R.color.dt_w_on_accent)
      val day = start.clone() as Calendar
      for (i in 0 until weeks * 7) {
        val key = ymd(day)
        val inMonth = day.get(Calendar.MONTH) == m
        val dow = day.get(Calendar.DAY_OF_WEEK)
        val dId = id(context, "d$i")
        v.setTextViewText(dId, day.get(Calendar.DAY_OF_MONTH).toString())
        if (key == today) {
          v.setInt(dId, "setBackgroundResource", R.drawable.dt_widget_today)
          v.setTextColor(dId, onAccent)
        } else {
          v.setInt(dId, "setBackgroundResource", 0)
          v.setTextColor(dId, if (!inMonth) faint else if (dow == Calendar.SUNDAY) sun else if (dow == Calendar.SATURDAY) sat else text)
        }
        // 그날 줄: 마감('◆ ')은 빨강 굵게, 다른 달은 흐리게
        val lines = data.optJSONArray(key)
        val sb = SpannableStringBuilder()
        if (lines != null) {
          for (k in 0 until lines.length()) {
            if (sb.isNotEmpty()) sb.append("\n")
            val s = lines.optString(k)
            val at = sb.length
            sb.append(s.removePrefix("◆ "))
            if (s.startsWith("◆ ")) {
              sb.setSpan(ForegroundColorSpan(deadline), at, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
              sb.setSpan(StyleSpan(Typeface.BOLD), at, sb.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            }
          }
        }
        val eId = id(context, "e$i")
        v.setTextViewText(eId, sb)
        v.setFloat(eId, "setAlpha", if (inMonth) 1f else 0.45f)
        // 날짜 칸 누르기 → 앱에서 그날 (칸마다 다른 주소라 PendingIntent 가 겹치지 않음)
        val open = Intent(context, MainActivity::class.java)
          .setAction(Intent.ACTION_VIEW)
          .setData(Uri.parse("dailytodo://day/$key"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        v.setOnClickPendingIntent(id(context, "c$i"),
          PendingIntent.getActivity(context, widgetId * 100 + i, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
        day.add(Calendar.DAY_OF_MONTH, 1)
      }
      manager.updateAppWidget(widgetId, v)
    }
  }
}
