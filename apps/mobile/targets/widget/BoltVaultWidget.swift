// BoltVault home-screen widget (master plan §7.13): the account's Field
// signature with its name and tier, the total when the user opted in, and a
// Live Activity for a bridge in flight. Reads the snapshot the app writes to
// the App Group container; never a key, never an address book. Built as a
// WidgetKit extension target by the config plugin (apps/mobile/plugins).
import ActivityKit
import SwiftUI
import WidgetKit

struct Snapshot: Decodable {
    let address: String
    let label: String
    let tier: Int
    let total: Double?
    let change24h: Double?
    let currency: String
    let at: Double
}

let appGroup = "group.io.electroswap.boltvault"

func readSnapshot() -> Snapshot? {
    guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
    let url = dir.appendingPathComponent("widget/widget-snapshot.json")
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(Snapshot.self, from: data)
}

// FNV-1a over the address, as packages/ui/src/hash.ts, so the widget's arcs match the app's seat.
func fieldSeed(_ address: String) -> [Double] {
    var h: UInt32 = 0x811c9dc5
    for b in address.lowercased().utf8 {
        h ^= UInt32(b)
        h = h &* 0x01000193
    }
    var out: [Double] = []
    var x = h
    for _ in 0..<4 {
        x ^= x << 13; x ^= x >> 17; x ^= x << 5
        out.append(Double(x) / Double(UInt32.max))
    }
    return out
}

struct FieldSignature: View {
    let address: String
    var body: some View {
        Canvas { ctx, size in
            let seed = fieldSeed(address)
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let r = min(size.width, size.height) * 0.42
            let colours: [Color] = [Color(red: 0.93, green: 0.97, blue: 1), Color(red: 0.37, green: 0.85, blue: 1), Color(red: 0.65, green: 0.55, blue: 1)]
            for i in 0..<3 {
                var p = Path()
                let a0 = seed[i] * .pi * 2
                let a1 = a0 + 0.9 + seed[(i + 1) % 4] * 1.6
                p.addArc(center: c, radius: r * (1 - Double(i) * 0.22), startAngle: .radians(a0), endAngle: .radians(a1), clockwise: false)
                ctx.stroke(p, with: .color(colours[i].opacity(0.9 - Double(i) * 0.2)), style: StrokeStyle(lineWidth: 3 - Double(i) * 0.6, lineCap: .round))
            }
        }
    }
}

struct Entry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: .now, snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: .now, snapshot: readSnapshot())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let entry = Entry(date: .now, snapshot: readSnapshot())
        completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(15 * 60))))
    }
}

struct BoltVaultWidgetView: View {
    let entry: Entry
    var body: some View {
        ZStack {
            Color(red: 0.024, green: 0.035, blue: 0.075)
            if let s = entry.snapshot {
                HStack(spacing: 12) {
                    FieldSignature(address: s.address).frame(width: 56, height: 56)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(s.label).font(.system(size: 15, weight: .semibold)).foregroundColor(Color(red: 0.86, green: 0.9, blue: 0.96)).lineLimit(1)
                        if let total = s.total {
                            Text(s.currency == "ETN" ? String(format: "%.0f ETN", total) : String(format: "$%.2f", total)).font(.system(size: 22, weight: .semibold, design: .rounded)).monospacedDigit().foregroundColor(.white)
                        }
                        HStack(spacing: 6) {
                            if s.tier > 0 { Text("Tier \(s.tier)").font(.system(size: 11)).foregroundColor(Color(red: 0.94, green: 0.77, blue: 0.42)) }
                            if let ch = s.change24h { Text(String(format: "%+.1f%%", ch * 100)).font(.system(size: 11)).foregroundColor(ch >= 0 ? Color(red: 0.94, green: 0.77, blue: 0.42) : Color(red: 1, green: 0.42, blue: 0.29)) }
                        }
                    }
                    Spacer()
                }.padding(14)
            } else {
                Text("Open BoltVault").foregroundColor(Color(red: 0.52, green: 0.58, blue: 0.68))
            }
        }
        .widgetURL(URL(string: "boltvault://home"))
    }
}

struct BoltVaultWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BoltVaultWidget", provider: Provider()) { entry in
            BoltVaultWidgetView(entry: entry)
        }
        .configurationDisplayName("BoltVault")
        .description("Your account's signature and total.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// A bridge in flight (§7.6 Cable) on the Lock Screen and the Dynamic Island.
struct BridgeAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        var state: String // pending | dispatched | delivered | failed
        var etaMinutes: Int
    }
    var symbol: String
    var fromChain: String
    var toChain: String
    var amount: String
}

struct BridgeActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: BridgeAttributes.self) { context in
            HStack {
                Text("Hyperlane \(context.attributes.symbol)").font(.headline)
                Spacer()
                Text(context.state.state == "delivered" ? "Arrived" : "\(context.attributes.fromChain) → \(context.attributes.toChain) · ~\(context.state.etaMinutes) min").font(.subheadline)
            }.padding()
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { Text(context.attributes.amount) }
                DynamicIslandExpandedRegion(.trailing) { Text(context.state.state) }
            } compactLeading: { Text("⚡︎") } compactTrailing: { Text(context.state.state == "delivered" ? "✓" : "…") } minimal: { Text("⚡︎") }
        }
    }
}

@main
struct BoltVaultWidgets: WidgetBundle {
    var body: some Widget {
        BoltVaultWidget()
        BridgeActivity()
    }
}
