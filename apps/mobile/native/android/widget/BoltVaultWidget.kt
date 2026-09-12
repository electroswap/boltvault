// BoltVault home-screen widget on Android (master plan §7.13), with Glance:
// the account's signature arcs, name, tier and the opted-in total, read from
// the snapshot the app writes. Wired into the app by the config plugin.
package io.electroswap.boltvault.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import org.json.JSONObject
import java.io.File

// `seed` is the FNV-1a hash of the address, not the address (ATT-BV-033): this
// file is plaintext on disk and the widget only ever needed the numbers the
// Field is drawn from.
data class Snapshot(val seed: Long, val label: String, val tier: Int, val total: Double?, val change24h: Double?, val currency: String)

fun readSnapshot(context: Context): Snapshot? {
    val file = File(context.filesDir, "widget/widget-snapshot.json")
    if (!file.exists()) return null
    return runCatching {
        val j = JSONObject(file.readText())
        Snapshot(
            seed = j.getLong("seed"),
            label = j.getString("label"),
            tier = j.optInt("tier", 0),
            total = if (j.isNull("total")) null else j.getDouble("total"),
            change24h = if (j.isNull("change24h")) null else j.getDouble("change24h"),
            currency = j.optString("currency", "USD"),
        )
    }.getOrNull()
}

class BoltVaultWidget : GlanceAppWidget() {
    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val snapshot = readSnapshot(context)
        provideContent { Content(snapshot) }
    }

    @Composable
    private fun Content(s: Snapshot?) {
        val ink = ColorProvider(Color(0xFFDCE5F5))
        val mute = ColorProvider(Color(0xFF8593AD))
        val ember = ColorProvider(Color(0xFFF0C56B))
        Column(
            modifier = GlanceModifier.fillMaxSize().background(Color(0xFF060913)).padding(14.dp).clickable(actionStartActivity<MainActivityAlias>()),
        ) {
            if (s == null) {
                Text("Open BoltVault", style = TextStyle(color = mute))
            } else {
                Text(s.label, style = TextStyle(color = ink, fontSize = 15.sp, fontWeight = FontWeight.Bold), maxLines = 1)
                s.total?.let { total ->
                    val text = if (s.currency == "ETN") String.format("%.0f ETN", total) else String.format("$%.2f", total)
                    Text(text, style = TextStyle(color = ColorProvider(Color.White), fontSize = 22.sp, fontWeight = FontWeight.Bold))
                }
                Row {
                    if (s.tier > 0) Text("Tier ${s.tier}  ", style = TextStyle(color = ember, fontSize = 11.sp))
                    s.change24h?.let { Text(String.format("%+.1f%%", it * 100), style = TextStyle(color = if (it >= 0) ember else ColorProvider(Color(0xFFFF6B4A)), fontSize = 11.sp)) }
                }
            }
        }
    }
}

class BoltVaultWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = BoltVaultWidget()
}

/** The app's launcher activity, referenced by name so the widget module has no import cycle on the app. */
class MainActivityAlias : android.app.Activity()
